import { NextRequest, NextResponse } from "next/server";
import { traceable } from "langsmith/traceable";
import { Persona } from "@/lib/personas";
import { SCENARIOS } from "@/lib/scenarios";
import { buildOrchestratorPrompt, buildEmployeeSystemPrompt, buildTurnPrompt } from "@/lib/prompts";
import { callLLM, getDefaultProvider, LLMProvider } from "@/lib/llm-client";

function buildConversationText(messages: any[], personas: Persona[]): string {
  return messages
    .filter((m: any) => m.sender !== "system" && !m.loading)
    .map((m: any) => {
      if (m.sender === "user") return `[팀장]: ${m.text}`;
      const p = personas.find((p) => p.id === m.sender);
      return `[${p?.name || "직원"}]: ${m.text}`;
    })
    .join("\n");
}

function getRecentSpeakers(messages: any[], lastN: number): string[] {
  const employeeMsgs = messages.filter((m: any) => m.sender !== "user" && m.sender !== "system" && !m.loading);
  return employeeMsgs.slice(-lastN).map((m: any) => m.sender);
}

function ensureCompleteSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (/[.?!。？！~ㅎㅋㅠ)"]$/.test(trimmed)) return trimmed;
  const sentenceEnders = /[.?!。？！]\s*/g;
  let lastEnd = -1;
  let match;
  while ((match = sentenceEnders.exec(trimmed)) !== null) {
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd > 0) return trimmed.slice(0, lastEnd).trim();
  return trimmed + ".";
}

// ── 복수 이름 호출 감지: "현지와 예슬이" → [현지, 예슬] 모두 반환 ──
function detectMentionedPersonas(userMessage: string, personas: Persona[]): Persona[] {
  const mentioned: Persona[] = [];
  for (const p of personas) {
    const fullName = p.name;
    const firstName = fullName.length >= 2 ? fullName.slice(1) : fullName;
    const patterns = [
      fullName,
      firstName,
      firstName + "아",
      firstName + "야",
      firstName + "씨",
      firstName + "님",
      firstName + "이",   // "예슬이", "현지이" → 한국어 호칭
      firstName + "이는",
      firstName + "이가",
      firstName + "이한테",
      firstName + "한테",
      firstName + "에게",
      fullName + "씨",
      fullName + "님",
    ];
    for (const pat of patterns) {
      if (userMessage.includes(pat)) {
        mentioned.push(p);
        break; // 한 사람당 한 번만
      }
    }
  }
  return mentioned;
}

const decideSpeakers = traceable(
  async function decideSpeakers(
    convText: string, scenario: any, personas: Persona[],
    recentSpeakers: string[], mentionedPersonas: Persona[], provider: LLMProvider
  ) {
    // 이름이 호출된 경우 → 호출된 모든 직원이 응답
    if (mentionedPersonas.length > 0) {
      return {
        speakers: mentionedPersonas.map(p => ({
          id: p.id,
          should_address: "manager",
          emotion: "집중",
          intent: "답변",
          thought: "팀장님이 나를 직접 부르셨다. 내 담당 업무 기준으로 답해야 한다.",
        })),
        cost: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    }

    // 이름 호출 없으면 오케스트레이터가 판단
    const sys = buildOrchestratorPrompt(personas, scenario);
    const recentInfo = recentSpeakers.length > 0
      ? `\n\n[최근 발언 이력] 최근 직원 발언 순서: ${recentSpeakers.map(id => {
          const p = personas.find(pp => pp.id === id);
          return p?.name || id;
        }).join(" → ")}\n위 직원 중 연속 2회 이상 발언한 사람은 이번에 제외하세요.`
      : "";

    const result = await callLLM(provider, sys,
      `대화:\n${convText}${recentInfo}\n\n다음 발언자를 JSON으로.`, 400);
    try {
      const cleaned = result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return { speakers: parsed.speakers || [], cost: result.estimatedCost, usage: result.usage };
    } catch {
      const recentSet = new Set(recentSpeakers.slice(-2));
      const quiet = personas.filter(p => !recentSet.has(p.id));
      const pick = quiet.length > 0 ? quiet : personas;
      const shuffled = [...pick].sort(() => Math.random() - 0.5);
      return {
        speakers: shuffled.slice(0, Math.random() > 0.5 ? 2 : 1).map((p) => ({
          id: p.id, should_address: "manager", emotion: "보통", intent: "의견 제시", thought: "",
        })),
        cost: result.estimatedCost, usage: result.usage,
      };
    }
  },
  { name: "SJT-Orchestrator", run_type: "chain" }
);

const handleChatTurn = traceable(
  async function handleChatTurn(scenarioId: string, messages: any[], userMessage: string, personas: Persona[], provider: LLMProvider) {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) throw new Error("Invalid scenario");

    const allMessages = [...messages, { sender: "user", text: userMessage }];
    let convText = buildConversationText(allMessages, personas);
    const recentSpeakers = getRecentSpeakers(allMessages, 4);

    // 복수 이름 감지
    const mentionedPersonas = detectMentionedPersonas(userMessage, personas);

    const orchResult = await decideSpeakers(convText, scenario, personas, recentSpeakers, mentionedPersonas, provider);
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
        persona, convText, speaker.should_address || "manager",
        speaker.emotion || "보통", speaker.intent || "의견 제시",
        speaker.thought || "", personas
      );

      const result = await callLLM(provider, sys, turn, 400);
      if (!result.text || result.text.trim().length < 3) continue;

      const completedText = ensureCompleteSentence(result.text.trim());
      responses.push({ sender: persona.id, text: completedText });
      convText += `\n[${persona.name}]: ${completedText}`;

      totalCost += result.estimatedCost;
      totalIn += result.usage.input_tokens;
      totalOut += result.usage.output_tokens;
    }

    if (responses.length === 0) {
      const recentSet = new Set(recentSpeakers.slice(-2));
      const fb = personas.find(p => !recentSet.has(p.id)) || personas[0];
      const sys = buildEmployeeSystemPrompt(fb, scenario, personas);
      const turn = buildTurnPrompt(fb, convText, "manager", "보통", "의견 제시", "", personas);
      const r = await callLLM(provider, sys, turn, 400);
      responses.push({ sender: fb.id, text: ensureCompleteSentence(r.text.trim()) || "네, 알겠습니다." });
      totalCost += r.estimatedCost; totalIn += r.usage.input_tokens; totalOut += r.usage.output_tokens;
    }

    return { responses, usage: { totalInputTokens: totalIn, totalOutputTokens: totalOut, totalCost, respondCount: responses.length } };
  },
  { name: "SJT-Chat-Turn", run_type: "chain" }
);

export async function POST(req: NextRequest) {
  try {
    const { scenarioId, messages, userMessage, personas, provider: rp } = await req.json();
    let provider: LLMProvider;
    try { provider = rp || getDefaultProvider(); } catch {
      return NextResponse.json({ error: "API 키가 설정되지 않았습니다." }, { status: 500 });
    }
    const result = await handleChatTurn(scenarioId, messages, userMessage, personas || [], provider);
    return NextResponse.json({ responses: result.responses, provider, usage: result.usage });
  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: error.message || "API 호출 실패" }, { status: 500 });
  }
}
