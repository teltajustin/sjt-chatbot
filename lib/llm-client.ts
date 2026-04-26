// lib/llm-client.ts
// v12: GPT-5.x / Gemini 3.x 호환성 보강
// - OpenAI 최신 모델은 max_tokens 대신 max_completion_tokens 사용
// - Gemini Pro 계열의 중간 끊김 방지를 위해 최소 출력 토큰 상향 및 MAX_TOKENS 재시도
// - Gemini 응답 parts 전체 병합 및 finishReason 기반 오류/재시도 처리
// - sampling 파라미터는 모델 호환성을 위해 계속 제거

import { traceable } from "langsmith/traceable";

export type LLMProvider = "anthropic" | "openai" | "gemini";

interface LLMConfig {
  provider: LLMProvider;
  model: string;
  label: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
}

type LLMRawResult = {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  finishReason?: string;
};

export const LLM_CONFIGS: Record<LLMProvider, LLMConfig> = {
  gemini: {
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    inputCostPer1M: 2.0,
    outputCostPer1M: 12.0,
  },
  openai: {
    provider: "openai",
    model: "gpt-5.4",
    label: "GPT-5.4",
    inputCostPer1M: 2.5,
    outputCostPer1M: 15.0,
  },
  anthropic: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    inputCostPer1M: 3,
    outputCostPer1M: 15,
  },
};

export function getAvailableProviders(): LLMProvider[] {
  const available: LLMProvider[] = [];
  if (process.env.GEMINI_API_KEY) available.push("gemini");
  if (process.env.OPENAI_API_KEY) available.push("openai");
  if (process.env.ANTHROPIC_API_KEY) available.push("anthropic");
  return available;
}

function hasProviderKey(provider: LLMProvider): boolean {
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  return false;
}

export function isLLMProvider(value: unknown): value is LLMProvider {
  return value === "gemini" || value === "openai" || value === "anthropic";
}

export function getDefaultProvider(preferredProvider?: unknown): LLMProvider {
  if (isLLMProvider(preferredProvider) && hasProviderKey(preferredProvider)) {
    return preferredProvider;
  }
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  throw new Error("API 키가 설정되지 않았습니다.");
}

function getEffectiveMaxTokens(provider: LLMProvider, requestedMax: number): number {
  const safeRequestedMax = Math.max(1, Math.floor(requestedMax || 400));

  // Gemini Pro/Thinking 계열은 짧은 maxOutputTokens에서 한국어 문장이 중간에 끊기는 경우가 있어
  // SJT 메시지/JSON 생성에는 최소 4096 토큰을 보장한다.
  if (provider === "gemini") return Math.max(safeRequestedMax, 4096);

  // GPT-5.x 계열은 max_completion_tokens가 reasoning token까지 포함하므로
  // 기존 400~700 설정을 그대로 쓰면 실제 표시 문장이 짧아질 수 있다.
  if (provider === "openai") return Math.max(safeRequestedMax, 2200);

  return safeRequestedMax;
}

function buildCompletionGuard(provider: LLMProvider): string {
  if (provider !== "gemini") return "";
  return [
    "",
    "[응답 완성 규칙]",
    "- 모든 한국어 문장은 반드시 완성된 문장으로 끝내세요.",
    "- 문장을 조사/명사구/중간 표현에서 끊지 마세요. 예: '것이.', '핵심 인재.', '1차 희.'처럼 끝내면 안 됩니다.",
    "- 답변이 길어질 것 같으면 문장 수를 줄이되, 마지막 문장까지 자연스럽게 완결하세요.",
  ].join("\n");
}

function appendCompletionGuard(sys: string, provider: LLMProvider): string {
  return `${sys || ""}${buildCompletionGuard(provider)}`;
}

function isOpenAINewCompletionTokenModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.startsWith("gpt-5") || normalized.startsWith("o1") || normalized.startsWith("o3") || normalized.startsWith("o4");
}

function extractErrorText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const anyData = data as any;
  return anyData.error?.message || anyData.message || JSON.stringify(anyData);
}

async function readResponseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchJson(url: string, init: RequestInit, providerLabel: string): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(url, init);
    const data = await readResponseBody(res);
    return { ok: res.ok, status: res.status, data };
  } catch (error: any) {
    throw new Error(`${providerLabel} 호출에 실패했습니다. API 키, 모델명, Vercel 환경변수, 네트워크 상태를 확인해 주세요. (${error?.message || error})`);
  }
}

function looksClearlyTruncated(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;

  // JSON 응답이 필요한 호출에서 닫힘 기호가 없는 경우 재시도한다.
  if ((t.startsWith("{") && !t.endsWith("}")) || (t.startsWith("[") && !t.endsWith("]"))) return true;

  // 한국어 문장이 조사/중간 명사구로 잘린 전형적인 케이스를 감지한다.
  const lastLine = t.split(/\n/).filter(Boolean).pop() || t;
  const suspiciousEndings = [
    /[가-힣]+(이|가|을|를|은|는|도|만|의|와|과|로|으로|에|에서|에게|께서)[.!?]?$/,
    /(것이|것으로|수 있도록|해야 할|필요가|우려가|가능성이|핵심 인재|희)[.!?]?$/,
  ];
  return suspiciousEndings.some((pattern) => pattern.test(lastLine.trim()));
}

async function callAnthropicRaw(sys: string, user: string, max: number): Promise<LLMRawResult> {
  const effectiveMax = getEffectiveMaxTokens("anthropic", max);
  const { ok, status, data } = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: LLM_CONFIGS.anthropic.model,
      max_tokens: effectiveMax,
      system: sys,
      messages: [{ role: "user", content: user }],
    }),
  }, "Anthropic");

  if (!ok) throw new Error(`Anthropic error: ${status} ${extractErrorText(data)}`);

  return {
    text: data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim() || "",
    usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    },
    finishReason: data.stop_reason,
  };
}

async function callOpenAIRaw(sys: string, user: string, max: number): Promise<LLMRawResult> {
  const model = LLM_CONFIGS.openai.model;
  const effectiveMax = getEffectiveMaxTokens("openai", max);
  const usesMaxCompletionTokens = isOpenAINewCompletionTokenModel(model);

  const baseBody: any = {
    model,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  };

  if (usesMaxCompletionTokens) {
    baseBody.max_completion_tokens = effectiveMax;
  } else {
    baseBody.max_tokens = effectiveMax;
  }

  let response = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
    },
    body: JSON.stringify(baseBody),
  }, "OpenAI");

  // 일부 호환 엔드포인트/프록시가 max_completion_tokens를 아직 지원하지 않는 경우를 대비한 1회 재시도.
  if (!response.ok && usesMaxCompletionTokens && /max_completion_tokens/i.test(extractErrorText(response.data))) {
    const fallbackBody = { ...baseBody };
    delete fallbackBody.max_completion_tokens;
    fallbackBody.max_tokens = effectiveMax;

    response = await fetchJson("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      },
      body: JSON.stringify(fallbackBody),
    }, "OpenAI");
  }

  if (!response.ok) throw new Error(`OpenAI error: ${response.status} ${extractErrorText(response.data)}`);

  const data = response.data;
  return {
    text: data.choices?.[0]?.message?.content?.trim() || "",
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
    finishReason: data.choices?.[0]?.finish_reason,
  };
}

async function callGeminiRaw(sys: string, user: string, max: number): Promise<LLMRawResult> {
  const model = LLM_CONFIGS.gemini.model;
  const effectiveMax = getEffectiveMaxTokens("gemini", max);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY!}`;

  const { ok, status, data } = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: sys }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: effectiveMax,
      },
    }),
  }, "Gemini");

  if (!ok) throw new Error(`Gemini error: ${status} ${extractErrorText(data)}`);

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim() || "";

  return {
    text,
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount || 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
    },
    finishReason: candidate?.finishReason,
  };
}

async function callRawWithRetry(provider: LLMProvider, sys: string, user: string, max: number): Promise<LLMRawResult> {
  const guardedSys = appendCompletionGuard(sys, provider);

  const invoke = async (retryMax: number, retryUser: string): Promise<LLMRawResult> => {
    switch (provider) {
      case "anthropic":
        return callAnthropicRaw(guardedSys, retryUser, retryMax);
      case "openai":
        return callOpenAIRaw(guardedSys, retryUser, retryMax);
      case "gemini":
        return callGeminiRaw(guardedSys, retryUser, retryMax);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  };

  const first = await invoke(max, user);

  // Gemini Pro 계열에서 finishReason=MAX_TOKENS 또는 명백한 중간 끊김이 발생하면 1회 재생성한다.
  if (provider === "gemini" && (first.finishReason === "MAX_TOKENS" || looksClearlyTruncated(first.text))) {
    const retryUser = [
      user,
      "",
      "[재생성 지시]",
      "직전 응답은 문장이 중간에 끊겼거나 JSON이 완성되지 않았습니다.",
      "같은 요구사항을 처음부터 다시 수행하되, 문장 수를 줄여도 좋으니 모든 메시지와 JSON을 반드시 완성된 형태로 출력하세요.",
    ].join("\n");
    const retried = await invoke(Math.max(max, 8192), retryUser);
    if (retried.text) return retried;
  }

  return first;
}

export const callLLM = traceable(
  async function callLLM(provider: LLMProvider, sys: string, user: string, max: number = 400) {
    const config = LLM_CONFIGS[provider];
    const result = await callRawWithRetry(provider, sys, user, max);

    if (!result.text) {
      throw new Error(`${config.label} 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요.`);
    }

    const cost =
      (result.usage.input_tokens / 1e6) * config.inputCostPer1M +
      (result.usage.output_tokens / 1e6) * config.outputCostPer1M;

    return {
      text: result.text,
      provider,
      model: config.model,
      usage: result.usage,
      estimatedCost: Math.round(cost * 1e6) / 1e6,
    };
  },
  { name: "SJT-LLM-Call", run_type: "llm", metadata: { app: "sjt-chatbot" } }
);
