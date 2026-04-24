// lib/jobs.ts
// 직무 카테고리 및 Nemotron-Personas-Korea 매핑

export interface JobCategory {
  id: string;
  label: string;
  icon: string;
  // HuggingFace SQL에서 필터할 occupation 키워드들
  occupationKeywords: string[];
  // 이 직무에서 자연스러운 직급/호칭
  typicalRoles: string[];
}

export const JOB_CATEGORIES: JobCategory[] = [
  {
    id: "marketing",
    label: "마케팅",
    icon: "📣",
    occupationKeywords: [
      "마케팅", "광고", "홍보", "브랜드", "콘텐츠", "기획",
      "디자이너", "카피라이터", "SNS", "미디어",
    ],
    typicalRoles: ["마케팅팀 사원", "마케팅팀 대리", "마케팅팀 선임", "브랜드 기획자", "콘텐츠 마케터"],
  },
  {
    id: "sales",
    label: "영업",
    icon: "🤝",
    occupationKeywords: [
      "영업", "판매", "세일즈", "거래", "고객", "상담",
      "보험", "부동산", "중개", "무역",
    ],
    typicalRoles: ["영업팀 사원", "영업팀 대리", "영업팀 과장", "거래처 담당", "고객 상담원"],
  },
  {
    id: "hr",
    label: "인사",
    icon: "👥",
    occupationKeywords: [
      "인사", "채용", "교육", "노무", "총무", "복지",
      "조직", "평가", "급여", "행정",
    ],
    typicalRoles: ["인사팀 사원", "인사팀 대리", "채용 담당", "교육 담당", "노무 담당"],
  },
  {
    id: "accounting",
    label: "회계",
    icon: "📊",
    occupationKeywords: [
      "회계", "경리", "세무", "장부", "재무제표", "결산",
      "감사", "부기", "세금", "원가",
    ],
    typicalRoles: ["회계팀 사원", "회계팀 대리", "경리 담당", "세무 담당", "결산 담당"],
  },
  {
    id: "finance",
    label: "재무",
    icon: "💰",
    occupationKeywords: [
      "재무", "투자", "자산", "금융", "증권", "펀드",
      "보험", "은행", "대출", "리스크",
    ],
    typicalRoles: ["재무팀 사원", "재무팀 대리", "자금 담당", "투자 분석가", "재무 기획"],
  },
  {
    id: "dev",
    label: "개발",
    icon: "💻",
    occupationKeywords: [
      "개발", "프로그래머", "엔지니어", "소프트웨어", "시스템",
      "웹", "앱", "데이터", "서버", "IT", "정보",
    ],
    typicalRoles: ["개발팀 사원", "개발팀 대리", "백엔드 개발자", "프론트엔드 개발자", "시스템 엔지니어"],
  },
];
