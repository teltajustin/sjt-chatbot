import { NextRequest, NextResponse } from "next/server";
import { traceable } from "langsmith/traceable";
import { Persona } from "@/lib/personas";
import { SCENARIOS } from "@/lib/scenarios";
import { buildEvaluationPrompt } from "@/lib/prompts";
import { callLLM, getDefaultProvider, LLMProvider } from "@/lib/llm-client";

const handleEvaluation = traceable(
  async function handleEvaluation(
    scenarioId: string,
    messages: any[],
    personas: Persona[],
    provider: LLMProvider
  ) {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) throw new Error("Invalid scenario");

    const transcript = messages
      .filter((m: any) => m.sender !== "system" && !m.loading)
      .map((m: any) => {
        if (m.sender === "user") return `[관리자(평가대상)]: ${m.text}`;
        const p = personas.find((p) => p.id === m.sender);
        return `[${p?.name}(${p?.role})]: ${m.text}`;
      })
      .join("\n\n");

    const evalPrompt = buildEvaluationPrompt(scenario.title, scenario.systemContext, transcript, personas);
    const result = await callLLM(provider, "", evalPrompt, 2500);

    return {
      evaluation: result.text,
      usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens, cost: result.estimatedCost },
    };
  },
  { name: "SJT-Evaluation", run_type: "chain" }
);

export async function POST(req: NextRequest) {
  try {
    const { scenarioId, messages, personas, provider: rp } = await req.json();
    let provider: LLMProvider;
    try { provider = rp || getDefaultProvider(); } catch {
      return NextResponse.json({ error: "API 키가 설정되지 않았습니다." }, { status: 500 });
    }
    const result = await handleEvaluation(scenarioId, messages, personas || [], provider);
    return NextResponse.json({ evaluation: result.evaluation, provider, usage: result.usage });
  } catch (error: any) {
    console.error("Evaluate API error:", error);
    return NextResponse.json({ error: error.message || "평가 실패" }, { status: 500 });
  }
}
