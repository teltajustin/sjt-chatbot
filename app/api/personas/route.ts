import { NextRequest, NextResponse } from "next/server";
import { JOB_CATEGORIES, JobCategory } from "@/lib/jobs";
import { buildPersonaFromDataset } from "@/lib/personas";

const HF_ROWS_API = "https://datasets-server.huggingface.co/rows";
const HF_SPLITS_API = "https://datasets-server.huggingface.co/splits";
const DATASET = "nvidia/Nemotron-Personas-Korea";
const DEFAULT_FETCH_TIMEOUT_MS = 8000;
const HF_PERSONA_GENERATION_MAX_ATTEMPTS = 3;
const PAGES_PER_ATTEMPT = 10;
const EMERGENCY_BROAD_PAGES = 30;
const ROWS_PER_PAGE = 100;
const FALLBACK_DATASET_ROW_COUNT = 1_000_000;

const USER_FRIENDLY_RETRY_MESSAGE =
  "선택한 직무에 맞는 팀원 정보를 충분히 불러오지 못했습니다. 다시 시도해 주세요.";

type Candidate = { row: any; score: number; matched: boolean };

type PersonaBuildResult = {
  personas: ReturnType<typeof buildPersonaFromDataset>[];
  source: "huggingface";
  attempts: number;
  candidateCounts: number[];
  matchedCandidateCounts: number[];
  usedBroadHuggingFacePool?: boolean;
};

let cachedDatasetRowCount: number | null = null;

function normalizeText(value: unknown): string {
  return String(value || "").toLowerCase();
}

function extractName(row: any): string {
  const match = String(row?.persona || "").match(/^([가-힣]{2,4})\s*씨/);
  return match?.[1] || "";
}

function buildSearchKeywords(job: JobCategory): string[] {
  const roleTokens = job.typicalRoles.flatMap((role) =>
    role
      .replace(/팀|사원|대리|과장|선임|담당|기획자|분석가/g, " ")
      .split(/[\s/·,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  );

  return Array.from(new Set([job.label, ...job.occupationKeywords, ...job.typicalRoles, ...roleTokens]));
}

function scoreCandidate(row: any, keywords: string[]): number {
  const occupation = normalizeText(row.occupation);
  const professional = normalizeText(row.professional_persona);
  const skills = normalizeText(row.skills_and_expertise);
  const skillsList = normalizeText(row.skills_and_expertise_list);
  const goals = normalizeText(row.career_goals_and_ambitions);
  const cultural = normalizeText(row.cultural_background);

  let score = 0;
  for (const kw of keywords) {
    const keyword = normalizeText(kw).trim();
    if (!keyword) continue;
    if (occupation.includes(keyword)) score += 4;
    if (professional.includes(keyword)) score += 2;
    if (skills.includes(keyword)) score += 2;
    if (skillsList.includes(keyword)) score += 1;
    if (goals.includes(keyword)) score += 1;
    if (cultural.includes(keyword)) score += 1;
  }
  return score;
}

function isValidRow(row: any): boolean {
  if (!row || !row.persona) return false;
  if (!extractName(row)) return false;

  const age = Number(row.age || 0);
  if (age < 22 || age > 58) return false;

  const occupation = String(row.occupation || "").trim();
  if (!occupation || occupation === "무직" || occupation === "없음") return false;

  const skills = String(row.skills_and_expertise || row.skills_and_expertise_list || "").trim();
  if (!skills) return false;

  return true;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function buildOffset(nonce: string, attempt: number, page: number, rowCount: number): number {
  const safeMaxOffset = Math.max(0, rowCount - ROWS_PER_PAGE);
  if (safeMaxOffset <= 0) return 0;

  const seed = stableHash(`${nonce}-${attempt}-${page}-${Date.now()}-${Math.random()}`);
  return seed % safeMaxOffset;
}

async function fetchJsonWithTimeout(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
      },
      signal: controller.signal,
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getDatasetRowCount(): Promise<number> {
  if (cachedDatasetRowCount && cachedDatasetRowCount > ROWS_PER_PAGE) return cachedDatasetRowCount;

  const url = `${HF_SPLITS_API}?dataset=${encodeURIComponent(DATASET)}`;
  const data = await fetchJsonWithTimeout(url);
  const splits = Array.isArray(data?.splits) ? data.splits : [];
  const train = splits.find((item: any) => item?.config === "default" && item?.split === "train") || splits[0];
  const rowCount = Number(train?.num_rows || train?.num_examples || train?.numRows || 0);

  if (Number.isFinite(rowCount) && rowCount > ROWS_PER_PAGE) {
    cachedDatasetRowCount = rowCount;
    return rowCount;
  }

  return FALLBACK_DATASET_ROW_COUNT;
}

async function fetchRowsWithOffset(offset: number, nonce: string): Promise<any[]> {
  const url =
    `${HF_ROWS_API}?dataset=${encodeURIComponent(DATASET)}` +
    `&config=default&split=train&offset=${offset}&length=${ROWS_PER_PAGE}` +
    `&retry=${encodeURIComponent(nonce)}`;

  const data = await fetchJsonWithTimeout(url);
  return (data?.rows || []).map((item: any) => item.row).filter(Boolean);
}

function appendRowsAsCandidates(rows: any[], keywords: string[], candidates: Candidate[], seenNames: Set<string>) {
  for (const row of rows) {
    if (!isValidRow(row)) continue;

    const name = extractName(row);
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    const score = scoreCandidate(row, keywords);
    candidates.push({ row, score, matched: score >= 1 });
  }
}

async function attemptFetchCandidates(
  job: JobCategory,
  attempt: number,
  nonce: string,
  rowCount: number,
  seenNames: Set<string>
): Promise<Candidate[]> {
  const keywords = buildSearchKeywords(job);
  const candidates: Candidate[] = [];

  for (let page = 0; page < PAGES_PER_ATTEMPT; page++) {
    const offset = buildOffset(nonce, attempt, page, rowCount);
    const rows = await fetchRowsWithOffset(offset, `${nonce}-${attempt}-${page}`);
    appendRowsAsCandidates(rows, keywords, candidates, seenNames);

    const matchedCount = candidates.filter((item) => item.matched).length;
    if (matchedCount >= 8 && candidates.length >= 12) break;
  }

  return candidates;
}

async function fetchBroadCandidates(
  job: JobCategory,
  nonce: string,
  rowCount: number,
  seenNames: Set<string>
): Promise<Candidate[]> {
  const keywords = buildSearchKeywords(job);
  const candidates: Candidate[] = [];
  const fixedOffsets = [0, ROWS_PER_PAGE, 1_000, 5_000, 10_000, 50_000].filter((offset) => offset < rowCount);

  for (const offset of fixedOffsets) {
    const rows = await fetchRowsWithOffset(offset, `${nonce}-fixed-${offset}`);
    appendRowsAsCandidates(rows, keywords, candidates, seenNames);
    if (candidates.length >= 6) return candidates;
  }

  for (let page = 0; page < EMERGENCY_BROAD_PAGES; page++) {
    const offset = buildOffset(nonce, 99, page, rowCount);
    const rows = await fetchRowsWithOffset(offset, `${nonce}-broad-${page}`);
    appendRowsAsCandidates(rows, keywords, candidates, seenNames);
    if (candidates.length >= 6) break;
  }

  return candidates;
}

function selectDiverse(candidates: Candidate[], allowBroadHuggingFacePool: boolean): any[] {
  const pool = candidates
    .filter((item) => allowBroadHuggingFacePool || item.matched)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(36, candidates.length));

  const selected: any[] = [];
  const usedNames = new Set<string>();
  const usedKeys = new Set<string>();

  for (const candidate of pool) {
    if (selected.length >= 3) break;

    const row = candidate.row;
    const name = extractName(row);
    if (usedNames.has(name)) continue;

    const age = Number(row.age || 0);
    const ageGroup = age < 30 ? "20s" : age < 40 ? "30s" : "40s+";
    const key = `${ageGroup}-${row.sex || "unknown"}`;

    if (!usedKeys.has(key) || selected.length < 2) {
      selected.push(row);
      usedNames.add(name);
      usedKeys.add(key);
    }
  }

  for (const candidate of pool) {
    if (selected.length >= 3) break;

    const name = extractName(candidate.row);
    if (!usedNames.has(name)) {
      selected.push(candidate.row);
      usedNames.add(name);
    }
  }

  return selected;
}

function buildResult(
  selectedRows: any[],
  job: JobCategory,
  attempts: number,
  candidateCounts: number[],
  matchedCandidateCounts: number[],
  usedBroadHuggingFacePool?: boolean
): PersonaBuildResult {
  const roles = [...job.typicalRoles].sort(() => Math.random() - 0.5);
  return {
    personas: selectedRows.slice(0, 3).map((raw, index) =>
      buildPersonaFromDataset(raw, index, roles[index % roles.length])
    ),
    source: "huggingface",
    attempts,
    candidateCounts,
    matchedCandidateCounts,
    usedBroadHuggingFacePool,
  };
}

async function buildPersonas(job: JobCategory, nonce: string): Promise<PersonaBuildResult> {
  const candidateCounts: number[] = [];
  const matchedCandidateCounts: number[] = [];
  const allCandidates: Candidate[] = [];
  const seenNames = new Set<string>();
  const rowCount = await getDatasetRowCount();

  for (let attempt = 1; attempt <= HF_PERSONA_GENERATION_MAX_ATTEMPTS; attempt++) {
    const candidates = await attemptFetchCandidates(job, attempt, nonce, rowCount, seenNames);
    allCandidates.push(...candidates);

    candidateCounts.push(candidates.length);
    matchedCandidateCounts.push(candidates.filter((item) => item.matched).length);

    const selected = selectDiverse(allCandidates, false);
    if (selected.length >= 3) {
      return buildResult(selected, job, attempt, candidateCounts, matchedCandidateCounts);
    }
  }

  // 직무 키워드와 정확히 맞는 후보가 부족하면, 같은 Hugging Face 데이터셋의 다른 범위에서
  // 유효한 인물 3명을 다시 뽑아 진행한다. 로컬 기본 페르소나 fallback은 사용하지 않는다.
  const broadCandidates = await fetchBroadCandidates(job, nonce, rowCount, seenNames);
  allCandidates.push(...broadCandidates);
  candidateCounts.push(broadCandidates.length);
  matchedCandidateCounts.push(broadCandidates.filter((item) => item.matched).length);

  const broadSelected = selectDiverse(allCandidates, true);
  if (broadSelected.length >= 3) {
    return buildResult(
      broadSelected,
      job,
      HF_PERSONA_GENERATION_MAX_ATTEMPTS,
      candidateCounts,
      matchedCandidateCounts,
      true
    );
  }

  throw new Error(USER_FRIENDLY_RETRY_MESSAGE);
}

async function handlePersonaRequest(req: NextRequest, jobId: string | null, bodyNonce?: string) {
  if (!jobId) return NextResponse.json({ error: "jobId parameter required" }, { status: 400 });

  const job = JOB_CATEGORIES.find((item) => item.id === jobId);
  if (!job) return NextResponse.json({ error: "Invalid job category" }, { status: 400 });

  const nonce =
    bodyNonce ||
    req.nextUrl.searchParams.get("retry") ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const result = await buildPersonas(job, nonce);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: USER_FRIENDLY_RETRY_MESSAGE,
        source: "huggingface",
        attempts: HF_PERSONA_GENERATION_MAX_ATTEMPTS,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  }
}

export async function GET(req: NextRequest) {
  return handlePersonaRequest(
    req,
    req.nextUrl.searchParams.get("job") || req.nextUrl.searchParams.get("jobId")
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return handlePersonaRequest(req, body?.jobId || body?.job || null, body?.nonce);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
