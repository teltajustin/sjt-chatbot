import { NextRequest, NextResponse } from "next/server";
import { JOB_CATEGORIES, JobCategory } from "@/lib/jobs";
import { buildPersonaFromDataset } from "@/lib/personas";

const HF_API = "https://datasets-server.huggingface.co/rows";
const DATASET = "nvidia/Nemotron-Personas-Korea";
const DEFAULT_FETCH_TIMEOUT_MS = 6500;
const HF_PERSONA_GENERATION_MAX_ATTEMPTS = 3;

type Candidate = { row: any; score: number };

function scoreCandidate(row: any, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if ((row.occupation || "").toLowerCase().includes(kwLower)) score += 3;
    if ((row.professional_persona || "").toLowerCase().includes(kwLower)) score += 2;
    if ((row.skills_and_expertise || "").toLowerCase().includes(kwLower)) score += 2;
    if ((row.skills_and_expertise_list || "").toLowerCase().includes(kwLower)) score += 1;
    if ((row.career_goals_and_ambitions || "").toLowerCase().includes(kwLower)) score += 1;
    if ((row.cultural_background || "").toLowerCase().includes(kwLower)) score += 1;
  }
  return score;
}

function isValidRow(row: any): boolean {
  if (!row || !row.persona) return false;
  const age = Number(row.age || 0);
  if (age < 22 || age > 58) return false;
  const occ = (row.occupation || "").trim();
  if (!occ || occ === "무직" || occ === "없음") return false;
  return true;
}

async function fetchRowsWithTimeout(url: string): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
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

async function attemptFetchCandidates(keywords: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  for (let i = 0; i < 4 && candidates.length < 12; i++) {
    const offset = Math.floor(Math.random() * 6_900_000);
    const url = `${HF_API}?dataset=${encodeURIComponent(DATASET)}&config=default&split=train&offset=${offset}&length=100`;
    const rows = await fetchRowsWithTimeout(url);

    for (const row of rows) {
      if (!isValidRow(row)) continue;
      const score = scoreCandidate(row, keywords);
      if (score >= 1) candidates.push({ row, score });
    }
  }

  return candidates;
}

function selectDiverse(candidates: Candidate[]): any[] {
  candidates.sort((a, b) => b.score - a.score);
  const topPool = candidates.slice(0, Math.min(18, candidates.length));
  const selected: any[] = [];
  const usedKeys = new Set<string>();

  for (const c of topPool) {
    if (selected.length >= 3) break;
    const age = Number(c.row.age || 0);
    const ageGroup = age < 30 ? "20s" : age < 40 ? "30s" : "40s+";
    const key = `${ageGroup}-${c.row.sex || "unknown"}`;
    if (!usedKeys.has(key) || selected.length < 2) {
      selected.push(c.row);
      usedKeys.add(key);
    }
  }

  for (const c of topPool) {
    if (selected.length >= 3) break;
    if (!selected.includes(c.row)) selected.push(c.row);
  }

  return selected;
}

type PersonaBuildResult = {
  personas: ReturnType<typeof buildPersonaFromDataset>[];
  source: "huggingface";
  attempts: number;
  candidateCounts: number[];
};

async function buildPersonas(job: JobCategory): Promise<PersonaBuildResult> {
  const candidateCounts: number[] = [];

  for (let attempt = 1; attempt <= HF_PERSONA_GENERATION_MAX_ATTEMPTS; attempt++) {
    const candidates = await attemptFetchCandidates(job.occupationKeywords);
    candidateCounts.push(candidates.length);

    const selected = selectDiverse(candidates);
    if (selected.length >= 3) {
      const roles = [...job.typicalRoles].sort(() => Math.random() - 0.5);
      return {
        personas: selected.slice(0, 3).map((raw, index) =>
          buildPersonaFromDataset(raw, index, roles[index % roles.length])
        ),
        source: "huggingface",
        attempts: attempt,
        candidateCounts,
      };
    }
  }

  throw new Error(
    `Hugging Face dataset did not return 3 valid personas after ${HF_PERSONA_GENERATION_MAX_ATTEMPTS} attempts.`
  );
}

async function handlePersonaRequest(jobId: string | null) {
  if (!jobId) return NextResponse.json({ error: "jobId parameter required" }, { status: 400 });

  const job = JOB_CATEGORIES.find((item) => item.id === jobId);
  if (!job) return NextResponse.json({ error: "Invalid job category" }, { status: 400 });

  try {
    const result = await buildPersonas(job);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Hugging Face persona generation failed.",
        source: "huggingface",
        attempts: HF_PERSONA_GENERATION_MAX_ATTEMPTS,
      },
      { status: 503 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handlePersonaRequest(req.nextUrl.searchParams.get("job") || req.nextUrl.searchParams.get("jobId"));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return handlePersonaRequest(body?.jobId || body?.job || null);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
