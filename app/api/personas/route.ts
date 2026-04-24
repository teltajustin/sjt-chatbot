import { NextRequest, NextResponse } from "next/server";
import { JOB_CATEGORIES } from "@/lib/jobs";
import { buildPersonaFromDataset } from "@/lib/personas";

// HuggingFace Datasets API (SQL query)
const HF_API = "https://datasets-server.huggingface.co/rows";
const DATASET = "nvidia/Nemotron-Personas-Korea";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job");
  if (!jobId) {
    return NextResponse.json({ error: "job parameter required" }, { status: 400 });
  }

  const job = JOB_CATEGORIES.find((j) => j.id === jobId);
  if (!job) {
    return NextResponse.json({ error: "Invalid job category" }, { status: 400 });
  }

  try {
    // HuggingFace rows API를 사용하여 랜덤 오프셋으로 데이터 가져오기
    // 전체 약 700만 건 중 랜덤 위치에서 50건을 가져와 필터링
    const candidates = [];
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts && candidates.length < 3; attempt++) {
      // 랜덤 오프셋 (0~6,999,900)
      const offset = Math.floor(Math.random() * 6_999_900);
      const length = 100; // 한 번에 가져올 행 수

      const url = `${HF_API}?dataset=${DATASET}&config=default&split=train&offset=${offset}&length=${length}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        console.error(`HF API error: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const rows = data.rows || [];

      // occupation 키워드로 필터링 + 19~65세 근로 연령
      for (const row of rows) {
        const r = row.row;
        if (!r || !r.occupation || !r.persona) continue;
        if (r.age < 22 || r.age > 60) continue;

        const occLower = (r.occupation || "").toLowerCase();
        const profLower = (r.professional_persona || "").toLowerCase();
        const combined = occLower + " " + profLower;

        const matches = job.occupationKeywords.some(
          (kw) => combined.includes(kw.toLowerCase())
        );

        if (matches && candidates.length < 10) {
          candidates.push(r);
        }
      }
    }

    if (candidates.length < 3) {
      // 키워드 매칭이 부족하면 마지막으로 가져온 데이터에서 연령 필터만 적용
      const offset = Math.floor(Math.random() * 6_999_900);
      const url = `${HF_API}?dataset=${DATASET}&config=default&split=train&offset=${offset}&length=50`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        for (const row of (data.rows || [])) {
          const r = row.row;
          if (r && r.persona && r.age >= 22 && r.age <= 60 && candidates.length < 10) {
            candidates.push(r);
          }
        }
      }
    }

    // 랜덤으로 3명 선택 (나이/성별 다양성 확보 시도)
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 3);

    if (selected.length < 3) {
      return NextResponse.json(
        { error: "데이터셋에서 충분한 페르소나를 찾지 못했습니다. 다시 시도해주세요." },
        { status: 500 }
      );
    }

    // 직무에 맞는 역할 할당
    const roles = [...job.typicalRoles].sort(() => Math.random() - 0.5);
    const personas = selected.map((raw, i) =>
      buildPersonaFromDataset(raw, i, roles[i % roles.length])
    );

    return NextResponse.json({ personas });
  } catch (error: any) {
    console.error("Persona fetch error:", error);
    return NextResponse.json(
      { error: `페르소나 로드 실패: ${error.message}` },
      { status: 500 }
    );
  }
}
