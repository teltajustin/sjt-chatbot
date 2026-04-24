import { NextRequest, NextResponse } from "next/server";
import { traceable } from "langsmith/traceable";
import { Persona } from "@/lib/personas";
import { SCENARIOS } from "@/lib/scenarios";
import {
  buildOrchestratorPrompt,
  buildEmployeeSystemPrompt,
  buildTurnPrompt,
} from "@/lib/prompts";
import { callLLM, getDefaultProvider, LLMProvider } from "@/lib/llm-client";

function buildConversationText(messages: any[], personas: Persona[]): string {
  return messages
    .filter((m: any) => m.sender !== "system" && !m.loading)
    .map((m: any) => {
      if (m.sender === "user") return `[관리자]: ${m.text}`;
      const p = personas.find((p) => p.id === m.sender);
      return `[${p?.name || "직원"}(${p?.role || ""})]: ${m.text}`;
    })
    .join("\n\n");
}

const decideSpeakers = traceable(
  async function decideSpeakers(
    conversationText: string,
    scenario: any,
    personas: Persona[],
    provider: LLMProvider
  ) {
    const orchestratorSystem = buildOrchestratorPrompt(personas, scenario);
    const result = await callLLM(
      provider,
      orchestratorSystem,
      `현재까지의 대화:\n\n${conversationText}\n\n위 대화를 보고, 다음에 누가 발언해야 할지 JSON으로 답하세요.`,
      500
    );
    try {
      const cleaned = result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return parsed.speakers || [];
    } catch {
      const shuffled = [...personas].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, Math.random() > 0.5 ? 2 : 1).map((p) => ({
        id: p.id,
        should_address: "manager",
        emotion: "보통",
        intent: "의견 제시",
      }));
    }
  },
  { name: "SJT-Orchestrator", run_type: "chain" }
);

const handleChatTurn = traceable(
  async function handleChatTurn(
    scenarioId: string,
    messages: any[],
    userMessage: string,
    personas: Persona[],
    provider: LLMProvider
  ) {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) throw new Error("Invalid scenario");

    const allMessages = [...messages, { sender: "user", text: userMessage }];
    let conversationText = buildConversationText(allMessages, personas);

    const speakerPlan = await decideSpeakers(conversationText, scenario, personas, provider);

    const responses = [];
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const speaker of speakerPlan) {
      const persona = personas.find((p) => p.id === speaker.id);
      if (!persona) continue;

      const systemPrompt = buildEmployeeSystemPrompt(persona, scenario, personas);
      const turnPrompt = buildTurnPrompt(
        persona,
        conversationText,
        speaker.should_address || "manager",
        speaker.emotion || "보통",
        speaker.intent || "의견 제시",
        personas
      );

      // max_tokens를 넉넉히 설정하여 잘림 방지
      const result = await callLLM(provider, systemPrompt, turnPrompt, 1000);

      if (!result.text || result.text.trim().length < 5) continue;

      responses.push({ sender: persona.id, text: result.text.trim() });
      conversationText += `\n\n[${persona.name}(${persona.role})]: ${result.text.trim()}`;

      totalCost += result.estimatedCost;
      totalInputTokens += result.usage.input_tokens;
      totalOutputTokens += result.usage.output_tokens;
    }

    if (responses.length === 0) {
      const fb = personas[0];
      const sys = buildEmployeeSystemPrompt(fb, scenario, personas);
      const tp = buildTurnPrompt(fb, conversationText, "manager", "보통", "의견 제시", personas);
      const r = await callLLM(provider, sys, tp, 1000);
      responses.push({ sender: fb.id, text: r.text.trim() || "(응답 생성 실패)" });
      totalCost += r.estimatedCost;
      totalInputTokens += r.usage.input_tokens;
      totalOutputTokens += r.usage.output_tokens;
    }

    return { responses, usage: { totalInputTokens, totalOutputTokens, totalCost, respondCount: responses.length } };
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
