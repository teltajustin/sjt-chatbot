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
  thought?: string;
};

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

// 이름/호칭 직접 호출 감지: "현지와 예슬이", "김현지 님", "현지한테" 등
function detectMentionedPersonas(userMessage: string, personas: Persona[]): Persona[] {
  const normalized = normalizeKo(userMessage);
  const mentioned: Persona[] = [];

  for (const p of personas) {
    const fullName = p.name || "";
    const givenName = fullName.length >= 2 ? fullName.slice(1) : fullName;
    const aliases = [
      fullName,
      `${fullName}님`, `${fullName}씨`, `${fullName}이`, `${fullName}에게`, `${fullName}한테`,
      givenName,
      `${givenName}님`, `${givenName}씨`, `${givenName}아`, `${givenName}야`, `${givenName}이`,
      `${givenName}이는`, `${givenName}이가`, `${givenName}에게`, `${givenName}한테`,
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
  ]);
  const normalized = normalizeKo(text);
  const chunks = normalized.match(/[가-힣a-z0-9]{2,}/g) || [];
  return chunks.filter((w) => !stopwords.has(w)).slice(0, 12);
}

// 사용자가 이름을 부르지 않고 "그 분석 결과", "검토 결과"처럼 이전 발언의 업무를 묻는 경우를 위한 힌트 생성
function buildOwnershipHints(messages: any[], personas: Persona[], userMessage: string): string {
  const keywords = extractKeywords(userMessage);
  const employeeMessages = cleanMessages(messages)
    .filter((m: any) => m.sender !== "user" && m.sender !== "system")
    .slice(-10);

  const scored = employeeMessages
    .map((m: any, index: number) => {
      const p = personas.find((pp) => pp.id === m.sender);
      const text = m.text || "";
      const nText = normalizeKo(text);
      let score = 0;
      for (const kw of keywords) {
        if (nText.includes(kw)) score += kw.length >= 4 ? 2 : 1;
      }
      if (/(분석|검토|자료|보고서|스케줄|일정|마진|원가|협상|패키지|확인|공유)/.test(text)) score += 1;
      return { p, text, score, index };
    })
    .filter((x) => x.p && x.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 5);

  if (scored.length === 0) return "";

  return scored
    .map((x) => `- ${x.p!.id} ${x.p!.name}: "${x.text.slice(0, 180)}"`)
    .join("\n");
}

function parseRouterJson(text: string): SpeakerPlanItem[] {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  const target = jsonStart >= 0 && jsonEnd >= jsonStart ? cleaned.slice(jsonStart, jsonEnd + 1) : cleaned;
  const parsed = JSON.parse(target);
  return Array.isArray(parsed.speakers) ? parsed.speakers : [];
}

function normalizeSpeakerPlan(
  rawSpeakers: SpeakerPlanItem[],
  personas: Persona[],
  mentionedPersonas: Persona[],
  recentSpeakers: string[]
): SpeakerPlanItem[] {
  const validIds = new Set(personas.map((p) => p.id));
  const plan: SpeakerPlanItem[] = [];
  const seen = new Set<string>();

  // 직접 호출된 직원은 무조건 포함한다.
  for (const p of mentionedPersonas) {
    plan.push({
      id: p.id,
      should_address: "manager",
      emotion: "집중",
      intent: "정보제공",
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
      thought: s.thought || "현재 맥락에서 내 담당 관점으로 기여한다.",
    });
    seen.add(s.id);
  }

  if (plan.length > 0) return plan.slice(0, 3);

  // 라우터 실패 시 최근 2회 발언자를 피해서 1명 선택
  const recentSet = new Set(recentSpeakers.slice(-2));
  const fallback = personas.find((p) => !recentSet.has(p.id)) || personas[0];
  return fallback ? [{ id: fallback.id, should_address: "manager", emotion: "보통", intent: "의견 제시", thought: "응답 공백을 막기 위해 관련 의견을 제시한다." }] : [];
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
${recentInfo}${mentionedInfo}${ownershipInfo}

위 정보를 기준으로 이번 턴에 답해야 할 직원을 결정하세요. JSON만 출력하세요.`;

    const result = await callLLM(provider, sys, routerUserPrompt, 500);
    try {
      const parsedSpeakers = parseRouterJson(result.text);
      return {
        speakers: normalizeSpeakerPlan(parsedSpeakers, personas, mentionedPersonas, recentSpeakers),
        cost: result.estimatedCost,
        usage: result.usage,
      };
    } catch {
      return {
        speakers: normalizeSpeakerPlan([], personas, mentionedPersonas, recentSpeakers),
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

    let convText = buildConversationText(allMessages, personas);
    const recentSpeakers = getRecentSpeakers(allMessages, 4);
    const mentionedPersonas = detectMentionedPersonas(userMessage, personas);
    const ownershipHints = buildOwnershipHints(allMessages, personas, userMessage);

    const orchResult = await decideSpeakers(
      convText,
      scenario,
      personas,
      recentSpeakers,
      mentionedPersonas,
      userMessage,
      ownershipHints,
      provider
    );
    const speakerPlan = orchResult.speakers;

    const responses = [];
    let totalCost = orchResult.cost;
    let totalIn = orchResult.usage.input_tokens;
    let totalOut = orchResult.usage.output_tokens;

    for (const speaker of speakerPlan) {
      const persona = personas.find((p) => p.id === speaker.id);
      if (!persona) continue;

      const sys = buildEmployeeSystemPrompt(persona, scenario, personas);
      const turn = buildTurnPrompt(
        persona,
        convText,
        speaker.should_address || "manager",
        speaker.emotion || "보통",
        speaker.intent || "의견 제시",
        speaker.thought || "",
        personas,
        userMessage,
        speakerPlan.map((s) => s.id)
      );

      const result = await callLLM(provider, sys, turn, 450);
      if (!result.text || result.text.trim().length < 3) continue;

      const completedText = ensureCompleteSentence(result.text.trim());
      responses.push({ sender: persona.id, text: completedText });
      convText += `\n[${persona.name}]: ${completedText}`;

      totalCost += result.estimatedCost;
      totalIn += result.usage.input_tokens;
      totalOut += result.usage.output_tokens;
    }

    if (responses.length === 0 && personas.length > 0) {
      const recentSet = new Set(recentSpeakers.slice(-2));
      const fb = personas.find((p) => !recentSet.has(p.id)) || personas[0];
      const sys = buildEmployeeSystemPrompt(fb, scenario, personas);
      const turn = buildTurnPrompt(fb, convText, "manager", "보통", "의견 제시", "", personas, userMessage, [fb.id]);
      const r = await callLLM(provider, sys, turn, 450);
      responses.push({ sender: fb.id, text: ensureCompleteSentence(r.text.trim()) || "네, 확인해서 말씀드리겠습니다." });
      totalCost += r.estimatedCost;
      totalIn += r.usage.input_tokens;
      totalOut += r.usage.output_tokens;
    }

    return { responses, usage: { totalInputTokens: totalIn, totalOutputTokens: totalOut, totalCost, respondCount: responses.length } };
  },
  { name: "SJT-Chat-Turn", run_type: "chain" }
);

export async function POST(req: NextRequest) {
  try {
    const { scenarioId, messages, userMessage, personas, provider: rp } = await req.json();
    let provider: LLMProvider;
    try {
      provider = rp || getDefaultProvider();
    } catch {
      return NextResponse.json({ error: "API 키가 설정되지 않았습니다." }, { status: 500 });
    }
    const result = await handleChatTurn(scenarioId, messages || [], userMessage || "", personas || [], provider);
    return NextResponse.json({ responses: result.responses, provider, usage: result.usage });
  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: error.message || "API 호출 실패" }, { status: 500 });
  }
}
