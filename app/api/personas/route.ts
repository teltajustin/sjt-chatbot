import { NextRequest, NextResponse } from "next/server";
import { JOB_CATEGORIES, JobCategory } from "@/lib/jobs";
import { buildPersonaFromDataset } from "@/lib/personas";

const HF_API = "https://datasets-server.huggingface.co/rows";
const DATASET = "nvidia/Nemotron-Personas-Korea";
const DEFAULT_FETCH_TIMEOUT_MS = 8000;
const HF_PERSONA_GENERATION_MAX_ATTEMPTS = 3;
const PAGES_PER_ATTEMPT = 8;
const ROWS_PER_PAGE = 100;
const MAX_DATASET_OFFSET = 6_900_000;

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

async function fetchRowsWithTimeout(url: string): Promise<any[]> {
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
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.rows || []).map((item: any) => item.row).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function attemptFetchCandidates(job: JobCategory, attempt: number, nonce: string): Promise<Candidate[]> {
  const keywords = buildSearchKeywords(job);
  const candidates: Candidate[] = [];
  const seenNames = new Set<string>();

  for (let page = 0; page < PAGES_PER_ATTEMPT; page++) {
    const offset = Math.floor(Math.random() * MAX_DATASET_OFFSET);
    const url =
      `${HF_API}?dataset=${encodeURIComponent(DATASET)}` +
      `&config=default&split=train&offset=${offset}&length=${ROWS_PER_PAGE}` +
      `&nonce=${encodeURIComponent(`${nonce}-${attempt}-${page}-${Date.now()}`)}`;

    const rows = await fetchRowsWithTimeout(url);

    for (const row of rows) {
      if (!isValidRow(row)) continue;

      const name = extractName(row);
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      const score = scoreCandidate(row, keywords);
      candidates.push({ row, score, matched: score >= 1 });
    }

    const matchedCount = candidates.filter((item) => item.matched).length;
    if (matchedCount >= 8 && candidates.length >= 12) break;
  }

  return candidates;
}

function selectDiverse(candidates: Candidate[], allowBroadHuggingFacePool: boolean): any[] {
  const pool = candidates
    .filter((item) => allowBroadHuggingFacePool || item.matched)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(24, candidates.length));

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

async function buildPersonas(job: JobCategory, nonce: string): Promise<PersonaBuildResult> {
  const candidateCounts: number[] = [];
  const matchedCandidateCounts: number[] = [];
  const allCandidates: Candidate[] = [];

  for (let attempt = 1; attempt <= HF_PERSONA_GENERATION_MAX_ATTEMPTS; attempt++) {
    const candidates = await attemptFetchCandidates(job, attempt, nonce);
    allCandidates.push(...candidates);

    candidateCounts.push(candidates.length);
    matchedCandidateCounts.push(candidates.filter((item) => item.matched).length);

    const selected = selectDiverse(allCandidates, false);
    if (selected.length >= 3) {
      const roles = [...job.typicalRoles].sort(() => Math.random() - 0.5);
      return {
        personas: selected.slice(0, 3).map((raw, index) =>
          buildPersonaFromDataset(raw, index, roles[index % roles.length])
        ),
        source: "huggingface",
        attempts: attempt,
        candidateCounts,
        matchedCandidateCounts,
      };
    }
  }

  const broadSelected = selectDiverse(allCandidates, true);
  if (broadSelected.length >= 3) {
    const roles = [...job.typicalRoles].sort(() => Math.random() - 0.5);
    return {
      personas: broadSelected.slice(0, 3).map((raw, index) =>
        buildPersonaFromDataset(raw, index, roles[index % roles.length])
      ),
      source: "huggingface",
      attempts: HF_PERSONA_GENERATION_MAX_ATTEMPTS,
      candidateCounts,
      matchedCandidateCounts,
      usedBroadHuggingFacePool: true,
    };
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
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || USER_FRIENDLY_RETRY_MESSAGE,
        source: "huggingface",
        attempts: HF_PERSONA_GENERATION_MAX_ATTEMPTS,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
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
