// lib/personas.ts
// 동적으로 로드되는 페르소나 인터페이스

export interface Persona {
  id: string;
  name: string;
  role: string; // 직무에 맞게 동적 할당
  age: number;
  sex: string;
  avatar: string;
  color: string;
  bgLight: string;

  // Nemotron-Personas-Korea 원본 필드
  persona: string;
  professional_persona: string;
  cultural_background: string;
  skills_and_expertise: string;
  career_goals_and_ambitions: string;
  family_persona: string;
  occupation: string;
  district: string;
  province: string;
  education_level: string;
  marital_status: string;

  // 파생 필드 (LLM이 페르소나 기반으로 생성)
  personality_traits: string; // 대화 스타일 요약
  speech_style: string; // 말투 특성
}

// 아바타 색상 팔레트
const COLORS = [
  { color: "#2563eb", bgLight: "#eff6ff" },
  { color: "#9333ea", bgLight: "#faf5ff" },
  { color: "#059669", bgLight: "#ecfdf5" },
];

const AVATARS_MALE = ["🧑‍💼", "👨‍💻", "👷", "🧑‍🔧", "👨‍🏫"];
const AVATARS_FEMALE = ["👩‍💼", "👩‍💻", "👩‍🏫", "👩‍🔧", "🧑‍💼"];

export function buildPersonaFromDataset(
  raw: any,
  index: number,
  assignedRole: string
): Persona {
  const isFemale = raw.sex === "여자";
  const avatars = isFemale ? AVATARS_FEMALE : AVATARS_MALE;
  const colorSet = COLORS[index % COLORS.length];

  // 이름 추출 (persona 필드 첫 부분에서)
  const nameMatch = raw.persona?.match(/^([가-힣]{2,4})\s*씨/);
  const name = nameMatch ? nameMatch[1] : `직원${index + 1}`;

  return {
    id: `emp_${index}`,
    name,
    role: assignedRole,
    age: raw.age,
    sex: raw.sex,
    avatar: avatars[index % avatars.length],
    ...colorSet,

    persona: raw.persona || "",
    professional_persona: raw.professional_persona || "",
    cultural_background: raw.cultural_background || "",
    skills_and_expertise: raw.skills_and_expertise || "",
    career_goals_and_ambitions: raw.career_goals_and_ambitions || "",
    family_persona: raw.family_persona || "",
    occupation: raw.occupation || "",
    district: raw.district || "",
    province: raw.province || "",
    education_level: raw.education_level || "",
    marital_status: raw.marital_status || "",

    personality_traits: "", // API에서 후처리
    speech_style: "", // API에서 후처리
  };
}
