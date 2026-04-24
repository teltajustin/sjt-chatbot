import { NextRequest, NextResponse } from "next/server";
import { JOB_CATEGORIES } from "@/lib/jobs";
import { buildPersonaFromDataset } from "@/lib/personas";

const HF_API = "https://datasets-server.huggingface.co/rows";
const DATASET = "nvidia/Nemotron-Personas-Korea";

// 6개 필드를 모두 사용하여 직무 적합도 점수 계산
function scoreCandidate(row: any, keywords: string[]): number {
  const fields = [
    row.occupation || "",
    row.skills_and_expertise || "",
    row.skills_and_expertise_list || "",
    row.career_goals_and_ambitions || "",
    row.professional_persona || "",
    row.cultural_background || "",
  ];
  const combined = fields.join(" ").toLowerCase();

  let score = 0;
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    // 각 필드별로 매칭 시 가중치 부여
    if ((row.occupation || "").toLowerCase().includes(kwLower)) score += 3; // occupation 매칭 최우선
    if ((row.professional_persona || "").toLowerCase().includes(kwLower)) score += 2;
    if ((row.skills_and_expertise || "").toLowerCase().includes(kwLower)) score += 2;
    if ((row.skills_and_expertise_list || "").toLowerCase().includes(kwLower)) score += 1;
    if ((row.career_goals_and_ambitions || "").toLowerCase().includes(kwLower)) score += 1;
    if ((row.cultural_background || "").toLowerCase().includes(kwLower)) score += 1;
  }
  return score;
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job");
  if (!jobId) return NextResponse.json({ error: "job parameter required" }, { status: 400 });

  const job = JOB_CATEGORIES.find((j) => j.id === jobId);
  if (!job) return NextResponse.json({ error: "Invalid job category" }, { status: 400 });

  try {
    const scoredCandidates: { row: any; score: number }[] = [];
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts && scoredCandidates.length < 10; attempt++) {
      const offset = Math.floor(Math.random() * 6_999_900);
      const url = `${HF_API}?dataset=${DATASET}&config=default&split=train&offset=${offset}&length=100`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;

      const data = await res.json();
      for (const row of (data.rows || [])) {
        const r = row.row;
        if (!r || !r.occupation || !r.persona) continue;
        if (r.age < 22 || r.age > 58) continue;

        const score = scoreCandidate(r, job.occupationKeywords);
        if (score >= 2) {
          scoredCandidates.push({ row: r, score });
        }
      }
    }

    // 점수 부족 시 fallback
    if (scoredCandidates.length < 3) {
      const offset = Math.floor(Math.random() * 6_999_900);
      const url = `${HF_API}?dataset=${DATASET}&config=default&split=train&offset=${offset}&length=80`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        for (const row of (data.rows || [])) {
          const r = row.row;
          if (r && r.persona && r.age >= 22 && r.age <= 58) {
            const score = scoreCandidate(r, job.occupationKeywords);
            scoredCandidates.push({ row: r, score: Math.max(score, 1) });
          }
        }
      }
    }

    // 점수 높은 순 정렬 후, 상위 후보 중에서 다양성 확보하여 3명 선택
    scoredCandidates.sort((a, b) => b.score - a.score);
    const topPool = scoredCandidates.slice(0, Math.min(15, scoredCandidates.length));

    // 나이대와 성별이 겹치지 않도록 시도
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

    // 부족하면 나머지에서 채우기
    for (const c of topPool) {
      if (selected.length >= 3) break;
      if (!selected.includes(c.row)) selected.push(c.row);
    }

    if (selected.length < 3) {
      return NextResponse.json({ error: "데이터셋에서 충분한 페르소나를 찾지 못했습니다. 다시 시도해주세요." }, { status: 500 });
    }

    const roles = [...job.typicalRoles].sort(() => Math.random() - 0.5);
    const personas = selected.map((raw, i) => buildPersonaFromDataset(raw, i, roles[i % roles.length]));

    return NextResponse.json({ personas });
  } catch (error: any) {
    console.error("Persona fetch error:", error);
    return NextResponse.json({ error: `페르소나 로드 실패: ${error.message}` }, { status: 500 });
  }
}
