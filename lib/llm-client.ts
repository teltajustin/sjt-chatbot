// lib/llm-client.ts
import { traceable } from "langsmith/traceable";

export type LLMProvider = "anthropic" | "openai" | "gemini";

interface LLMConfig {
  provider: LLMProvider;
  model: string;
  label: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
}

export const LLM_CONFIGS: Record<LLMProvider, LLMConfig> = {
  anthropic: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    inputCostPer1M: 3,
    outputCostPer1M: 15,
  },
  openai: {
    provider: "openai",
    model: "gpt-5",
    label: "GPT-5",
    inputCostPer1M: 2,
    outputCostPer1M: 8,
  },
  gemini: {
    provider: "gemini",
    model: "gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash-Lite",
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
  },
};

export function getAvailableProviders(): LLMProvider[] {
  const available: LLMProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) available.push("anthropic");
  if (process.env.OPENAI_API_KEY) available.push("openai");
  if (process.env.GEMINI_API_KEY) available.push("gemini");
  return available;
}

export function getDefaultProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  throw new Error("API 키가 설정되지 않았습니다.");
}

async function callAnthropicRaw(sys: string, user: string, max: number) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: LLM_CONFIGS.anthropic.model, max_tokens: max, system: sys, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    text: data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || "",
    usage: { input_tokens: data.usage?.input_tokens || 0, output_tokens: data.usage?.output_tokens || 0 },
  };
}

// GPT-5는 max_completion_tokens 사용 (max_tokens 미지원)
async function callOpenAIRaw(sys: string, user: string, max: number) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY!}` },
    body: JSON.stringify({
      model: LLM_CONFIGS.openai.model,
      max_completion_tokens: max,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 },
  };
}

async function callGeminiRaw(sys: string, user: string, max: number) {
  const model = LLM_CONFIGS.gemini.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY!}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: sys }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: max },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
    usage: { input_tokens: data.usageMetadata?.promptTokenCount || 0, output_tokens: data.usageMetadata?.candidatesTokenCount || 0 },
  };
}

export const callLLM = traceable(
  async function callLLM(provider: LLMProvider, sys: string, user: string, max: number = 400) {
    const config = LLM_CONFIGS[provider];
    let result;
    switch (provider) {
      case "anthropic": result = await callAnthropicRaw(sys, user, max); break;
      case "openai": result = await callOpenAIRaw(sys, user, max); break;
      case "gemini": result = await callGeminiRaw(sys, user, max); break;
      default: throw new Error(`Unknown provider: ${provider}`);
    }
    const cost = (result.usage.input_tokens / 1e6) * config.inputCostPer1M + (result.usage.output_tokens / 1e6) * config.outputCostPer1M;
    return { text: result.text, provider, model: config.model, usage: result.usage, estimatedCost: Math.round(cost * 1e6) / 1e6 };
  },
  { name: "SJT-LLM-Call", run_type: "llm", metadata: { app: "sjt-chatbot" } }
);
