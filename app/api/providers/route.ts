import { NextResponse } from "next/server";
import { getAvailableProviders, LLM_CONFIGS } from "@/lib/llm-client";

export async function GET() {
  const available = getAvailableProviders();
  const providers = available.map((id) => ({
    id,
    label: LLM_CONFIGS[id].label,
    model: LLM_CONFIGS[id].model,
  }));
  return NextResponse.json({ providers });
}
