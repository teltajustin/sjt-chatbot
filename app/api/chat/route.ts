import { NextRequest, NextResponse } from "next/server";
import { traceable } from "langsmith/traceable";
import { Persona } from "@/lib/personas";
import { SCENARIOS } from "@/lib/scenarios";
import { buildOrchestratorPrompt, buildEmployeeSystemPrompt, buildTurnPrompt } from "@/lib/prompts";
import { callLLM, getDefaultProvider, LLMProvider } from "@/lib/llm-client";

type SpeakerPlanItem = {
  id: string;
  should_address?: string;
  emotion?: string;
  intent?: string;
  stance?: string;
  thought?: string;
};

type EmployeeResponse = {
  sender: string;
  text: string;
  delayMs?: number;
};

type ConversationPurpose =
  | "정보확인"
  | "의사결정"
  | "지시"
  | "갈등조율"
  | "리스크점검"
  | "감정몰입";

function cleanMessages(messages: any[]): any[] {
  return (messages || []).filter((m: any) => m && m.sender && !m.loading);
}

function buildConversationText(messages: any[], personas: Persona[]): string {
  return cleanMessages(messages)
    .filter((m: any) => m.sender !== "system")
    .map((m: any) => {
      if (m.sender === "user") return `[팀장]: ${m.text}`;
      const p = personas.find((p) => p.id === m.sender);
      return `[${p?.name || m.sender}]: ${m.text}`;
    })
    .join("\n");
}

function getRecentSpeakers(messages: any[], lastN: number): string[] {
  const employeeMsgs = cleanMessages(messages).filter(
    (m: any) => m.sender !== "user" && m.sender !== "system"
  );
  return employeeMsgs.slice(-lastN).map((m: any) => m.sender);
}

function ensureCompleteSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (/[.?!。？！~ㅎㅋㅠ)\"]$/.test(trimmed)) return trimmed;
  const sentenceEnders = /[.?!。？！]\s*/g;
  let lastEnd = -1;
  let match;
  while ((match = sentenceEnders.exec(trimmed)) !== null) {
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd > 0) return trimmed.slice(0, lastEnd).trim();
  return trimmed + ".";
}

function normalizeKo(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[\s.,!?~·ㆍ:;()\[\]{}"'“”‘’\-_/]/g, "");
}

function uniqueById(items: Persona[]): Persona[] {
  const seen = new Set<string>();
  return items.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function classifyPurpose(userMessage: string): ConversationPurpose {
  if (/(화났|불만|억울|힘들|부담|불안|짜증|섭섭|미안|감정|사기|동기)/.test(userMessage)) return "감정몰입";
  if (/(갈등|충돌|반대|이견|책임|누가|조율|설득|합의|논쟁)/.test(userMessage)) return "갈등조율";
  if (/(위험|리스크|문제|품질|법|컴플라이언스|고객 이탈|클레임|CS|민원|실패)/i.test(userMessage)) return "리스크점검";
  if (/(결정|선택|승인|방향|우선순위|예산|배분|어떻게|대안|전략)/.test(userMessage)) return "의사결정";
  if (/(해줘|진행|맡아|준비|작성|수정|마무리|처리|검토해|공유해)/.test(userMessage)) return "지시";
  return "정보확인";
}

function isSimpleOwnershipFollowUp(userMessage: string, ownershipHints: string): boolean {
  if (!ownershipHints) return false;
  return /(언제|결과|확인|공유|마무리|완료|진행|상태|어디까지|가능|일정|자료|검토|분석)/.test(userMessage);
}

function isBroadOrComplexRequest(userMessage: string): boolean {
  return /(다들|모두|각자|전체|의견|아이디어|어떻게|방향|대안|우선순위|예산|KPI|리스크|문제|해결|논의|조율|다른\s*의견|추가로|누가|분담|협의|계획)/i.test(userMessage);
}

function chooseTargetSpeakerCount(
  userMessage: string,
  mentionedPersonas: Persona[],
  rawSpeakers: SpeakerPlanItem[],
  ownershipHints: string,
  purpose: ConversationPurpose
): number {
  if (mentionedPersonas.length >= 2) return Math.min(3, mentionedPersonas.length);
  if (mentionedPersonas.length === 1) return 1;
  if (isSimpleOwnershipFollowUp(userMessage, ownershipHints)) return 1;

  const rawCount = Math.max(1, Math.min(3, rawSpeakers.filter((s) => s?.id).length || 1));
  const broad = isBroadOrComplexRequest(userMessage);
  const complexPurpose = purpose === "의사결정" || purpose === "갈등조율" || purpose === "리스크점검";

  if (!broad && !complexPurpose) return 1;

  // 실제 업무 메신저처럼 매번 같은 2인 구조가 반복되지 않도록 확률적으로 가변화한다.
  // 넓은 질문도 대개 1~2명이 반응하고, 3명은 드물게만 나온다.
  const roll = Math.random();
  const desired = roll < 0.45 ? 1 : roll < 0.86 ? 2 : 3;
  return Math.max(1, Math.min(rawCount, desired));
}

function addResponseDelays(responses: EmployeeResponse[]): EmployeeResponse[] {
  return responses.map((r, index) => ({
    ...r,
    // 클라이언트는 이 값을 메시지 간 시차로 누적 적용한다. 각 직원 말풍선 간 최대 15초.
    delayMs: index === 0 ? randomInt(1200, 4500) : randomInt(1800, 15000),
  }));
}

function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+\n/g, "\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const sentences: string[] = [];
  for (const p of paragraphs) {
    const parts = p.match(/[^.!?。？！]+[.!?。？！]+|[^.!?。？！]+$/g) || [p];
    for (const part of parts) {
      const cleaned = part.trim();
      if (cleaned) sentences.push(cleaned);
    }
  }
  return sentences;
}

function limitSentences(text: string, maxSentences = 5): string {
  const parts = splitIntoSentences(text);
  if (parts.length === 0) return ensureCompleteSentence(text);
  return ensureCompleteSentence(parts.slice(0, maxSentences).join(" "));
}

function splitLongMessage(text: string): string[] {
  const clean = ensureCompleteSentence(limitSentences(text, 5));
  const sentences = splitIntoSentences(clean);

  if (sentences.length <= 2 && clean.length <= 150) return [clean];

  const targetBubbleCount = clean.length > 280 || sentences.length >= 5 ? 3 : 2;
  const bubbles: string[] = [];
  let current = "";
  const perBubble = Math.ceil(sentences.length / targetBubbleCount);

  for (const sentence of sentences) {
    const shouldBreak =
      current &&
      (splitIntoSentences(current).length >= perBubble || current.length + sentence.length > 155) &&
      bubbles.length < targetBubbleCount - 1;

    if (shouldBreak) {
      bubbles.push(ensureCompleteSentence(current));
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current.trim()) bubbles.push(ensureCompleteSentence(current));
  return bubbles.slice(0, 3).filter(Boolean);
}

function flattenAndSplitResponses(responses: EmployeeResponse[]): EmployeeResponse[] {
  const flat: EmployeeResponse[] = [];
  for (const response of responses) {
    const bubbles = splitLongMessage(response.text);
    for (const bubble of bubbles) {
      flat.push({ sender: response.sender, text: bubble });
    }
  }
  return flat;
}

// 이름/호칭 직접 호출 감지: "현지와 예슬이", "김현지 님", "현지한테" 등
function detectMentionedPersonas(userMessage: string, personas: Persona[]): Persona[] {
  const normalized = normalizeKo(userMessage);
  const mentioned: Persona[] = [];

  for (const p of personas) {
    const fullName = p.name || "";
    const givenName = fullName.length >= 2 ? fullName.slice(1) : fullName;
    const aliases = [
      fullName,
      `${fullName}님`, `${fullName}씨`, `${fullName}이`, `${fullName}에게`, `${fullName}한테`, `${fullName}는`, `${fullName}은`,
      givenName,
      `${givenName}님`, `${givenName}씨`, `${givenName}아`, `${givenName}야`, `${givenName}이`,
      `${givenName}이는`, `${givenName}이가`, `${givenName}에게`, `${givenName}한테`, `${givenName}는`, `${givenName}은`,
      p.role,
    ]
      .filter(Boolean)
      .map(normalizeKo)
      .filter((a) => a.length >= 2);

    if (aliases.some((alias) => normalized.includes(alias))) mentioned.push(p);
  }

  return uniqueById(mentioned);
}

function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    "언제", "까지", "확인", "할수", "있어", "있나요", "있습니까", "결과", "검토", "마무리",
    "해주세요", "해줘", "알려줘", "공유", "자료", "보고", "님", "씨", "팀장", "그", "이", "저",
    "가능", "일정", "진행", "상태", "어디", "무엇", "어떻게",
  ]);
  const normalized = normalizeKo(text);
  const chunks = normalized.match(/[가-힣a-z0-9]{2,}/g) || [];
  return chunks.filter((w) => !stopwords.has(w)).slice(0, 14);
}

// 사용자가 이름을 부르지 않고 "그 분석 결과", "검토 결과"처럼 이전 발언의 업무를 묻는 경우를 위한 힌트 생성
function buildOwnershipHints(messages: any[], personas: Persona[], userMessage: string): string {
  const keywords = extractKeywords(userMessage);
  const employeeMessages = cleanMessages(messages)
    .filter((m: any) => m.sender !== "user" && m.sender !== "system")
    .slice(-18);

  const actionTerms = /(분석|검토|자료|보고서|스케줄|일정|마진|원가|협상|패키지|확인|공유|시안|카피|예산|소스|테스트|성과|대시보드|완료|초안|최종|담당|제가|저는|제가\s*맡|제가\s*정리)/;

  const scored = employeeMessages
    .map((m: any, index: number) => {
      const p = personas.find((pp) => pp.id === m.sender);
      const text = m.text || "";
      const nText = normalizeKo(text);
      let score = 0;
      for (const kw of keywords) {
        if (nText.includes(kw)) score += kw.length >= 4 ? 3 : 1;
      }
      if (actionTerms.test(text)) score += 2;
      if (/(오늘|내일|오전|오후|까지|중으로|공유|보고|드리겠습니다|하겠습니다|맡겠습니다|정리하겠습니다)/.test(text)) score += 2;
      return { p, text, score, index };
    })
    .filter((x) => x.p && x.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 6);

  if (scored.length === 0) return "";

  return scored
    .map((x) => `- ${x.p!.id} ${x.p!.name}: "${x.text.slice(0, 220)}"`)
    .join("\n");
}

function buildStateMemory(messages: any[], personas: Persona[], userMessage: string, purpose: ConversationPurpose, ownershipHints: string): string {
  const cleaned = cleanMessages(messages).filter((m: any) => m.sender !== "system");
  const recent = cleaned.slice(-8).map((m: any) => {
    if (m.sender === "user") return `팀장: ${m.text}`;
    const p = personas.find((pp) => pp.id === m.sender);
    return `${p?.name || m.sender}: ${m.text}`;
  }).join("\n");

  const openTasks = cleanMessages(messages)
    .filter((m: any) => m.sender !== "user" && m.sender !== "system")
    .slice(-12)
    .filter((m: any) => /(오늘|내일|오전|오후|까지|중으로|공유|보고|정리|검토|분석|초안|최종|시안|예산|테스트|확인)/.test(m.text || ""))
    .map((m: any) => {
      const p = personas.find((pp) => pp.id === m.sender);
      return `- ${p?.name || m.sender}: ${(m.text || "").slice(0, 130)}`;
    })
    .slice(-6)
    .join("\n");

  const riskSignals = [
    /(무리|어렵|불가능|부족|지연|리스크|위험|품질|고객|이탈|컴플라이언스|CS|민원|예산|일정)/.test(userMessage) ? "현재 사용자 메시지에 일정·품질·고객·예산 리스크가 포함되어 있습니다." : "",
    /(그냥|일단|빨리|무조건|대충|낮춰|줄여|감수|상관없)/.test(userMessage) ? "사용자 지시에 성급한 실행 또는 품질 저하 가능성이 있습니다. 직원은 현실적 결과를 경고할 수 있습니다." : "",
  ].filter(Boolean).join("\n");

  return [
    `현재 대화 목적: ${purpose}`,
    ownershipHints ? `[업무 소유자 후보]\n${ownershipHints}` : "[업무 소유자 후보]\n아직 뚜렷한 소유자 힌트가 없습니다.",
    openTasks ? `[열려 있는 업무/일정]\n${openTasks}` : "[열려 있는 업무/일정]\n아직 명확한 후속 업무가 적습니다.",
    riskSignals ? `[주의 신호]\n${riskSignals}` : "[주의 신호]\n큰 위험 신호는 아직 없습니다.",
    `[최근 대화]\n${recent || "대화 시작 전입니다."}`,
  ].join("\n\n");
}

function parseRouterJson(text: string): { purpose?: ConversationPurpose; speakers: SpeakerPlanItem[] } {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  const target = jsonStart >= 0 && jsonEnd >= jsonStart ? cleaned.slice(jsonStart, jsonEnd + 1) : cleaned;
  const parsed = JSON.parse(target);
  return {
    purpose: parsed.conversation_purpose,
    speakers: Array.isArray(parsed.speakers) ? parsed.speakers : [],
  };
}

function normalizeSpeakerPlan(
  rawSpeakers: SpeakerPlanItem[],
  personas: Persona[],
  mentionedPersonas: Persona[],
  recentSpeakers: string[],
  userMessage: string,
  ownershipHints: string,
  purpose: ConversationPurpose
): SpeakerPlanItem[] {
  const validIds = new Set(personas.map((p) => p.id));
  const plan: SpeakerPlanItem[] = [];
  const seen = new Set<string>();

  // 직접 호출된 직원은 무조건 포함한다.
  for (const p of mentionedPersonas) {
    plan.push({
      id: p.id,
      should_address: "manager",
      emotion: purpose === "리스크점검" ? "조심스러움" : "집중",
      intent: purpose === "정보확인" ? "정보제공" : "제안",
      stance: "협조",
      thought: "팀장님이 나를 직접 불렀으므로 내 담당 범위와 일정 기준으로 답한다.",
    });
    seen.add(p.id);
  }

  for (const s of rawSpeakers) {
    if (!s?.id || !validIds.has(s.id) || seen.has(s.id)) continue;
    const address = s.should_address && (s.should_address === "manager" || validIds.has(s.should_address))
      ? s.should_address
      : "manager";
    plan.push({
      id: s.id,
      should_address: address,
      emotion: s.emotion || "보통",
      intent: s.intent || "의견 제시",
      stance: s.stance || "협조",
      thought: s.thought || "현재 맥락에서 내 담당 관점으로 기여한다.",
    });
    seen.add(s.id);
  }

  if (plan.length > 0) {
    const targetCount = chooseTargetSpeakerCount(userMessage, mentionedPersonas, plan, ownershipHints, purpose);
    return plan.slice(0, targetCount);
  }

  // 라우터 실패 시 최근 2회 발언자를 피해서 1명 선택
  const recentSet = new Set(recentSpeakers.slice(-2));
  const fallback = personas.find((p) => !recentSet.has(p.id)) || personas[0];
  return fallback
    ? [{ id: fallback.id, should_address: "manager", emotion: "보통", intent: "의견 제시", stance: "확인필요", thought: "응답 공백을 막기 위해 관련 의견을 제시한다." }]
    : [];
}

const decideSpeakers = traceable(
  async function decideSpeakers(
    convText: string,
    scenario: any,
    personas: Persona[],
    recentSpeakers: string[],
    mentionedPersonas: Persona[],
    userMessage: string,
    ownershipHints: string,
    conversationState: string,
    heuristicPurpose: ConversationPurpose,
    provider: LLMProvider
  ) {
    const sys = buildOrchestratorPrompt(personas, scenario);
    const recentInfo = recentSpeakers.length > 0
      ? `\n\n[최근 직원 발언 이력]\n${recentSpeakers.map((id) => {
          const p = personas.find((pp) => pp.id === id);
          return p?.name || id;
        }).join(" → ")}`
      : "";
    const mentionedInfo = mentionedPersonas.length > 0
      ? `\n\n[사용자가 직접 부른 직원]\n${mentionedPersonas.map((p) => `${p.id} ${p.name}`).join(", ")}\n직접 부른 직원은 반드시 speakers에 포함하세요.`
      : "";
    const ownershipInfo = ownershipHints
      ? `\n\n[이전 발언 기반 업무/주제 소유자 후보]\n${ownershipHints}\n사용자가 특정 자료·검토·분석·일정을 물으면, 해당 내용을 앞서 말한 직원을 우선 선택하세요.`
      : "";

    const routerUserPrompt = `
[대화 기록]
${convText}

[현재 사용자 메시지]
${userMessage}

[휴리스틱 대화 목적]
${heuristicPurpose}

[대화 상태 메모]
${conversationState}
${recentInfo}${mentionedInfo}${ownershipInfo}

위 정보를 기준으로 이번 턴에 답해야 할 직원을 결정하세요.

[라우팅 원칙]
- 기본은 직원 1명만 반응합니다.
- 사용자 질문이 여러 직원에게 직접 향했거나, 실제로 상호보완·이견·업무 분담이 필요한 경우에만 2명을 선택합니다.
- 3명은 사용자가 모두/각자/다들 의견을 요구했거나, 갈등·긴급 의사결정처럼 여러 관점이 꼭 필요한 경우에만 선택합니다.
- 이전 발언에서 특정 분석, 검토, 자료, 일정, 실행안을 맡겠다고 말한 직원이 있으면 그 직원을 우선 선택합니다.
- 잘못된 결정이나 무리한 지시가 포함되어 있으면 협조만 하는 직원이 아니라 우려 또는 질문을 하는 직원도 선택하세요.
- 매 턴 기계적으로 2명을 선택하지 마세요. 한 명의 답으로 충분하면 한 명만 선택하세요.
JSON만 출력하세요.`;

    const result = await callLLM(provider, sys, routerUserPrompt, 600);
    try {
      const parsed = parseRouterJson(result.text);
      const purpose = parsed.purpose || heuristicPurpose;
      return {
        purpose,
        speakers: normalizeSpeakerPlan(parsed.speakers, personas, mentionedPersonas, recentSpeakers, userMessage, ownershipHints, purpose),
        cost: result.estimatedCost,
        usage: result.usage,
      };
    } catch {
      return {
        purpose: heuristicPurpose,
        speakers: normalizeSpeakerPlan([], personas, mentionedPersonas, recentSpeakers, userMessage, ownershipHints, heuristicPurpose),
        cost: result.estimatedCost,
        usage: result.usage,
      };
    }
  },
  { name: "SJT-Orchestrator", run_type: "chain" }
);

const handleChatTurn = traceable(
  async function handleChatTurn(scenarioId: string, messages: any[], userMessage: string, personas: Persona[], provider: LLMProvider) {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) throw new Error("Invalid scenario");

    // 클라이언트가 이미 userMessage를 messages에 포함해서 보내도 중복으로 넣지 않는다.
    const baseMessages = cleanMessages(messages);
    const lastMessage = baseMessages[baseMessages.length - 1];
    const alreadyIncluded = lastMessage?.sender === "user" && (lastMessage?.text || "").trim() === userMessage.trim();
    const allMessages = alreadyIncluded ? baseMessages : [...baseMessages, { sender: "user", text: userMessage }];

    const convText = buildConversationText(allMessages, personas);
    const recentSpeakers = getRecentSpeakers(allMessages, 5);
    const mentionedPersonas = detectMentionedPersonas(userMessage, personas);
    const ownershipHints = buildOwnershipHints(allMessages, personas, userMessage);
    const heuristicPurpose = classifyPurpose(userMessage);
    const conversationState = buildStateMemory(allMessages, personas, userMessage, heuristicPurpose, ownershipHints);

    const orchResult = await decideSpeakers(
      convText,
      scenario,
      personas,
      recentSpeakers,
      mentionedPersonas,
      userMessage,
      ownershipHints,
      conversationState,
      heuristicPurpose,
      provider
    );
    const speakerPlan = orchResult.speakers;

    const responses: EmployeeResponse[] = [];
    let totalCost = orchResult.cost;
    let totalIn = orchResult.usage.input_tokens;
    let totalOut = orchResult.usage.output_tokens;

    for (const speaker of speakerPlan) {
      const persona = personas.find((p) => p.id === speaker.id);
      if (!persona) continue;

      const sys = buildEmployeeSystemPrompt(persona, scenario, personas);
      const prompt = buildTurnPrompt(
        persona,
        convText,
        speaker.should_address || "manager",
        speaker.emotion || "보통",
        speaker.intent || "의견 제시",
        speaker.thought || "현재 맥락에서 내 담당 관점으로 기여한다.",
        personas,
        userMessage,
        speakerPlan.map((s) => s.id),
        conversationState,
        speaker.stance || ""
      );
      const result = await callLLM(provider, sys, prompt, 700);
      totalCost += result.estimatedCost;
      totalIn += result.usage.input_tokens;
      totalOut += result.usage.output_tokens;

      const text = limitSentences(ensureCompleteSentence(result.text), 5);
      if (text) responses.push({ sender: persona.id, text });
    }

    const splitResponses = flattenAndSplitResponses(responses);

    return {
      responses: addResponseDelays(splitResponses),
      usage: { totalCost, totalInputTokens: totalIn, totalOutputTokens: totalOut },
      routing: {
        purpose: orchResult.purpose,
        speakers: speakerPlan.map((s) => ({ id: s.id, intent: s.intent, stance: s.stance })),
      },
    };
  },
  { name: "SJT-ChatTurn", run_type: "chain" }
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const provider = getDefaultProvider(body?.provider);
    const result = await handleChatTurn(body.scenarioId, body.messages || [], body.userMessage || "", body.personas || [], provider);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "chat error" }, { status: 500 });
  }
}
