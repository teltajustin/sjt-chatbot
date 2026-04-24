import { NextRequest, NextResponse } from "next/server";
import { JOB_CATEGORIES } from "@/lib/jobs";
import { buildPersonaFromDataset } from "@/lib/personas";

const HF_API = "https://datasets-server.huggingface.co/rows";
const DATASET = "nvidia/Nemotron-Personas-Korea";

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

// 한 번의 시도: 랜덤 오프셋에서 후보 수집
async function attemptFetchCandidates(keywords: string[]): Promise<{ row: any; score: number }[]> {
  const candidates: { row: any; score: number }[] = [];
  const fetchAttempts = 5;

  for (let i = 0; i < fetchAttempts && candidates.length < 10; i++) {
    const offset = Math.floor(Math.random() * 6_999_900);
    const url = `${HF_API}?dataset=${DATASET}&config=default&split=train&offset=${offset}&length=100`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const data = await res.json();
      for (const row of (data.rows || [])) {
        const r = row.row;
        if (!r || !r.occupation || !r.persona) continue;
        if (r.age < 22 || r.age > 58) continue;

        // ★ 무직 제외
        const occ = (r.occupation || "").trim();
        if (occ === "무직" || occ === "없음" || occ === "") continue;

        const score = scoreCandidate(r, keywords);
        if (score >= 2) candidates.push({ row: r, score });
      }
    } catch { continue; }
  }

  // 부족하면 fallback (점수 1이라도 허용)
  if (candidates.length < 3) {
    const offset = Math.floor(Math.random() * 6_999_900);
    const url = `${HF_API}?dataset=${DATASET}&config=default&split=train&offset=${offset}&length=80`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        for (const row of (data.rows || [])) {
          const r = row.row;
          if (!r || !r.persona || r.age < 22 || r.age > 58) continue;
          const occ = (r.occupation || "").trim();
          if (occ === "무직" || occ === "없음" || occ === "") continue;
          const score = scoreCandidate(r, keywords);
          candidates.push({ row: r, score: Math.max(score, 1) });
        }
      }
    } catch {}
  }

  return candidates;
}

function selectDiverse(candidates: { row: any; score: number }[]): any[] {
  candidates.sort((a, b) => b.score - a.score);
  const topPool = candidates.slice(0, Math.min(15, candidates.length));

  const selected: any[] = [];
  const usedAgeGroup = new Set<string>();

  for (const c of topPool) {
    if (selected.length >= 3) break;
    const ageGroup = c.row.age < 30 ? "20s" : c.row.age < 40 ? "30s" : "40s+";
    const key = `${ageGroup}-${c.row.sex}`;
    if (!usedAgeGroup.has(key) || selected.length < 2) {
      selected.push(c.row);
      usedAgeGroup.add(key);
    }
  }
  for (const c of topPool) {
    if (selected.length >= 3) break;
    if (!selected.includes(c.row)) selected.push(c.row);
  }
  return selected;
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job");
  if (!jobId) return NextResponse.json({ error: "job parameter required" }, { status: 400 });

  const job = JOB_CATEGORIES.find((j) => j.id === jobId);
  if (!job) return NextResponse.json({ error: "Invalid job category" }, { status: 400 });

  // ★ 3회 시도 후 실패
  for (let round = 1; round <= 3; round++) {
    try {
      const candidates = await attemptFetchCandidates(job.occupationKeywords);
      const selected = selectDiverse(candidates);

      if (selected.length >= 3) {
        const roles = [...job.typicalRoles].sort(() => Math.random() - 0.5);
        const personas = selected.map((raw, i) => buildPersonaFromDataset(raw, i, roles[i % roles.length]));
        return NextResponse.json({ personas });
      }
    } catch (error: any) {
      console.error(`Persona fetch round ${round} error:`, error);
    }
  }

  return NextResponse.json(
    { error: "데이터셋에서 충분한 페르소나를 찾지 못했습니다. 다시 시도해주세요." },
    { status: 500 }
  );
}
