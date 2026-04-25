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

function fallbackRowsForJob(job: JobCategory): any[] {
  const baseByJob: Record<string, any[]> = {
    marketing: [
      { name: "이준형", age: 34, sex: "남자", occupation: "브랜드 마케팅 담당자", professional_persona: "성과 지표와 고객 반응 데이터를 함께 보는 브랜드 마케터입니다. 캠페인 일정과 예산 통제에 민감합니다.", skills_and_expertise: "브랜드 캠페인, GA4, SNS 광고, 고객 세그먼트 분석, 예산 관리", career_goals_and_ambitions: "브랜드 성장과 전환율 개선을 동시에 달성하는 마케팅 리더가 되고자 합니다." },
      { name: "박서연", age: 29, sex: "여자", occupation: "콘텐츠 마케터", professional_persona: "고객 반응과 콘텐츠 완성도를 중시합니다. 무리한 일정에는 품질 저하 우려를 제기합니다.", skills_and_expertise: "콘텐츠 기획, 카피라이팅, SNS 운영, 고객 VOC 해석", career_goals_and_ambitions: "고객에게 설득력 있게 전달되는 콘텐츠 전략을 만들고 싶어 합니다." },
      { name: "최민재", age: 41, sex: "남자", occupation: "퍼포먼스 마케팅 매니저", professional_persona: "숫자와 실험 설계를 중시합니다. 근거 없는 의사결정에는 신중한 태도를 보입니다.", skills_and_expertise: "매체 운영, A/B 테스트, CAC/LTV 분석, 대시보드 구축", career_goals_and_ambitions: "데이터 기반으로 마케팅 효율을 개선하는 조직을 만들고자 합니다." },
    ],
    sales: [
      { name: "김도윤", age: 36, sex: "남자", occupation: "B2B 영업 담당자", professional_persona: "거래처 관계와 매출 마감 일정을 중시합니다. 고객 반응을 빠르게 공유합니다.", skills_and_expertise: "법인 영업, 제안서 작성, 고객 협상, 매출 파이프라인 관리", career_goals_and_ambitions: "주요 고객사를 안정적으로 확대하는 영업 리더가 되고자 합니다." },
      { name: "정하린", age: 31, sex: "여자", occupation: "고객 상담 및 세일즈 운영 담당자", professional_persona: "고객 문의와 내부 운영 절차 사이의 균형을 중시하며 꼼꼼하게 확인합니다.", skills_and_expertise: "고객 상담, CRM 관리, 견적 검토, 계약 지원", career_goals_and_ambitions: "고객 만족과 영업 효율을 함께 높이고자 합니다." },
      { name: "오세훈", age: 44, sex: "남자", occupation: "영업팀 과장", professional_persona: "분기 목표와 리스크 관리를 함께 봅니다. 무리한 할인이나 약속에는 제동을 겁니다.", skills_and_expertise: "목표 관리, 거래처 협상, 영업 전략, 리스크 관리", career_goals_and_ambitions: "팀의 매출 안정성과 고객 신뢰를 높이고자 합니다." },
    ],
    hr: [
      { name: "문지현", age: 33, sex: "여자", occupation: "채용 담당자", professional_persona: "지원자 경험과 채용 일정 준수를 중시합니다. 커뮤니케이션 리스크에 민감합니다.", skills_and_expertise: "채용 운영, 면접 일정 조율, 지원자 커뮤니케이션, ATS 관리", career_goals_and_ambitions: "공정하고 효율적인 채용 프로세스를 만들고자 합니다." },
      { name: "장우진", age: 38, sex: "남자", occupation: "인사기획 담당자", professional_persona: "제도 일관성과 내부 수용성을 함께 봅니다. 성급한 변경에는 신중합니다.", skills_and_expertise: "인사제도, 평가, 보상, 조직문화, 데이터 분석", career_goals_and_ambitions: "데이터와 구성원 경험을 연결하는 HR 기획자가 되고자 합니다." },
      { name: "한예슬", age: 27, sex: "여자", occupation: "교육 운영 담당자", professional_persona: "교육 참여율과 현장 피드백을 중시합니다. 운영 디테일을 꼼꼼하게 챙깁니다.", skills_and_expertise: "교육 운영, 만족도 조사, 출결 관리, 사내 커뮤니케이션", career_goals_and_ambitions: "직원 성장에 실질적으로 기여하는 교육 체계를 만들고자 합니다." },
    ],
    accounting: [
      { name: "윤태경", age: 39, sex: "남자", occupation: "회계팀 대리", professional_persona: "증빙과 마감 일정을 엄격히 챙깁니다. 회계 리스크에는 보수적으로 반응합니다.", skills_and_expertise: "전표 처리, 월마감, 세금계산서, 결산 지원", career_goals_and_ambitions: "정확한 회계 관리로 조직의 의사결정을 지원하고자 합니다." },
      { name: "신유나", age: 30, sex: "여자", occupation: "경리 담당자", professional_persona: "실무 처리 속도와 누락 방지를 중시합니다. 필요한 자료를 명확히 요청합니다.", skills_and_expertise: "입출금 관리, 증빙 확인, 비용 정산, 엑셀 관리", career_goals_and_ambitions: "실수 없는 회계 운영 체계를 만들고 싶어 합니다." },
      { name: "배성민", age: 46, sex: "남자", occupation: "세무 담당자", professional_persona: "세무 규정과 감사 대응 관점에서 판단합니다. 위험한 처리는 분명히 거절합니다.", skills_and_expertise: "세무 신고, 원천세, 부가세, 감사 대응, 내부통제", career_goals_and_ambitions: "세무 리스크를 사전에 낮추는 관리 체계를 구축하고자 합니다." },
    ],
    finance: [
      { name: "강민석", age: 37, sex: "남자", occupation: "재무기획 담당자", professional_persona: "예산과 현금흐름을 중심으로 판단합니다. 비용 집행 근거를 중요하게 봅니다.", skills_and_expertise: "예산 수립, 손익 분석, 현금흐름 관리, 투자 검토", career_goals_and_ambitions: "사업 의사결정을 뒷받침하는 재무 파트너가 되고자 합니다." },
      { name: "서나영", age: 32, sex: "여자", occupation: "자금 담당자", professional_persona: "지급 일정과 자금 안정성을 중시합니다. 갑작스러운 변경에는 확인을 요구합니다.", skills_and_expertise: "자금 집행, 은행 업무, 지급 관리, 리스크 점검", career_goals_and_ambitions: "안정적인 자금 운영으로 사업 실행을 지원하고자 합니다." },
      { name: "류정훈", age: 45, sex: "남자", occupation: "투자 분석가", professional_persona: "수익성과 리스크를 함께 검토합니다. 낙관적인 전망에는 반론을 제기합니다.", skills_and_expertise: "투자 검토, 리스크 분석, 재무 모델링, 시장 조사", career_goals_and_ambitions: "근거 있는 투자 판단 체계를 만들고자 합니다." },
    ],
    dev: [
      { name: "정민수", age: 35, sex: "남자", occupation: "백엔드 개발자", professional_persona: "안정성과 장애 리스크를 중시합니다. 무리한 배포 일정에는 신중한 입장을 보입니다.", skills_and_expertise: "API 개발, 데이터베이스, 서버 운영, 장애 대응", career_goals_and_ambitions: "확장성 있고 안정적인 서비스를 만드는 개발자가 되고자 합니다." },
      { name: "임가은", age: 28, sex: "여자", occupation: "프론트엔드 개발자", professional_persona: "사용자 경험과 구현 품질을 중시합니다. 요구사항이 모호하면 먼저 질문합니다.", skills_and_expertise: "React, TypeScript, UI 구현, 접근성, 사용자 테스트", career_goals_and_ambitions: "사용자가 편하게 쓰는 제품 경험을 구현하고자 합니다." },
      { name: "노현우", age: 42, sex: "남자", occupation: "시스템 엔지니어", professional_persona: "운영 안정성과 보안을 우선합니다. 임시 조치의 후속 리스크를 반드시 확인합니다.", skills_and_expertise: "인프라 운영, 보안 점검, 배포 자동화, 모니터링", career_goals_and_ambitions: "장애에 강한 운영 환경을 구축하고자 합니다." },
    ],
  };

  const rows = baseByJob[job.id] || baseByJob.marketing;
  return rows.map((row) => ({
    ...row,
    persona: `${row.name} 씨는 ${row.age}세의 ${row.occupation}입니다. ${row.professional_persona}`,
    cultural_background: "국내 중견기업의 실무 조직에서 협업 경험이 많고, 메신저 기반 업무 커뮤니케이션에 익숙합니다.",
    family_persona: "업무 외 개인정보는 대화에 드러내지 않습니다.",
    district: "강남구",
    province: "서울특별시",
    education_level: "대졸",
    marital_status: "비공개",
  }));
}

function buildFallbackPersonas(job: JobCategory) {
  const roles = [...job.typicalRoles].sort(() => Math.random() - 0.5);
  return fallbackRowsForJob(job).map((raw, index) => buildPersonaFromDataset(raw, index, roles[index % roles.length]));
}

type PersonaBuildSource = "huggingface" | "fallback";

type PersonaBuildResult = {
  personas: ReturnType<typeof buildPersonaFromDataset>[];
  source: PersonaBuildSource;
  attempts: number;
  candidateCounts: number[];
  fallbackReason?: string;
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

  return {
    personas: buildFallbackPersonas(job),
    source: "fallback",
    attempts: HF_PERSONA_GENERATION_MAX_ATTEMPTS,
    candidateCounts,
    fallbackReason: `Hugging Face dataset did not return 3 valid personas after ${HF_PERSONA_GENERATION_MAX_ATTEMPTS} attempts.`,
  };
}

async function handlePersonaRequest(jobId: string | null) {
  if (!jobId) return NextResponse.json({ error: "jobId parameter required" }, { status: 400 });

  const job = JOB_CATEGORIES.find((item) => item.id === jobId);
  if (!job) return NextResponse.json({ error: "Invalid job category" }, { status: 400 });

  const result = await buildPersonas(job);
  return NextResponse.json(result);
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
