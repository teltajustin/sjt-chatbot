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

// 문장 완성 보장: 마지막 완전한 문장까지만 반환
function ensureCompleteSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  // 이미 문장부호로 끝나면 OK
  if (/[.?!。？！~ㅎㅋ]$/.test(trimmed)) return trimmed;

  // 마지막 완전한 문장을 찾기
  const sentenceEnders = /[.?!。？！]\s*/g;
  let lastEnd = -1;
  let match;
  while ((match = sentenceEnders.exec(trimmed)) !== null) {
    lastEnd = match.index + match[0].length;
  }

  if (lastEnd > 0) {
    return trimmed.slice(0, lastEnd).trim();
  }

  // 문장부호가 하나도 없으면 마침표 추가
  return trimmed + ".";
}

const decideSpeakers = traceable(
  async function decideSpeakers(convText: string, scenario: any, personas: Persona[], provider: LLMProvider) {
    const sys = buildOrchestratorPrompt(personas, scenario);
    const result = await callLLM(provider, sys, `대화:\n${convText}\n\n다음 발언자를 JSON으로 답하세요.`, 300);
    try {
      const cleaned = result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return parsed.speakers || [];
    } catch {
      const shuffled = [...personas].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, Math.random() > 0.5 ? 2 : 1).map((p) => ({
        id: p.id, should_address: "manager", emotion: "보통", intent: "의견 제시",
      }));
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

    const speakerPlan = await decideSpeakers(convText, scenario, personas, provider);

    const responses = [];
    let totalCost = 0, totalIn = 0, totalOut = 0;

    for (const speaker of speakerPlan) {
      const persona = personas.find((p) => p.id === speaker.id);
      if (!persona) continue;

      const sys = buildEmployeeSystemPrompt(persona, scenario, personas);
      const turn = buildTurnPrompt(persona, convText, speaker.should_address || "manager", speaker.emotion || "보통", speaker.intent || "의견 제시", personas);

      // 짧은 메신저 메시지 = max 400 tokens → 빠른 응답
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
      const fb = personas[0];
      const sys = buildEmployeeSystemPrompt(fb, scenario, personas);
      const turn = buildTurnPrompt(fb, convText, "manager", "보통", "의견 제시", personas);
      const r = await callLLM(provider, sys, turn, 400);
      const text = ensureCompleteSentence(r.text.trim()) || "네, 알겠습니다.";
      responses.push({ sender: fb.id, text });
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
