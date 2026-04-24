import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      startedAt,
      jobId,
      jobLabel,
      scenarioId,
      scenarioTitle,
      provider,
      personas,
      messages,
      evaluation,
      totalCost,
      totalTokens,
    } = body;

    const session = {
      meta: {
        startedAt,
        endedAt: new Date().toISOString(),
        jobId,
        jobLabel,
        scenarioId,
        scenarioTitle,
        provider,
        totalCost,
        totalTokens,
      },
      personas: personas?.map((p: any) => ({
        name: p.name,
        role: p.role,
        age: p.age,
        sex: p.sex,
        occupation: p.occupation,
        province: p.province,
        district: p.district,
      })),
      chatLog: messages
        ?.filter((m: any) => m.sender !== "system" && !m.loading)
        .map((m: any) => ({
          sender: m.sender,
          text: m.text,
        })),
      evaluation,
    };

    // 저장 경로: 프로젝트 루트 /sessions/
    const sessionsDir = path.join(process.cwd(), "sessions");
    await mkdir(sessionsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `sjt-${jobId}-${timestamp}.json`;
    const filepath = path.join(sessionsDir, filename);

    await writeFile(filepath, JSON.stringify(session, null, 2), "utf-8");

    return NextResponse.json({ saved: true, filename });
  } catch (error: any) {
    console.error("Session save error:", error);
    return NextResponse.json({ error: error.message || "저장 실패" }, { status: 500 });
  }
}
