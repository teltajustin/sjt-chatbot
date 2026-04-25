import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// ── OAuth 2.0 토큰 갱신 함수 ──
async function getAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("OAuth 환경 변수(CLIENT_ID, SECRET, REFRESH_TOKEN)가 설정되지 않았습니다.");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ── Google Drive 업로드 (OAuth 방식) ──
async function uploadToGoogleDrive(filename: string, jsonContent: string): Promise<string | null> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  
  try {
    // 1. OAuth Access Token 가져오기
    const accessToken = await getAccessToken();
    const boundary = "sjt_boundary_" + Date.now();

    // 2. 메타데이터 설정 (parents가 있으면 해당 폴더로, 없으면 내 드라이브 루트로)
    const metadata: any = {
      name: filename,
      mimeType: "application/json",
    };
    if (folderId) {
      metadata.parents = [folderId];
    }

    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${jsonContent}\r\n` +
      `--${boundary}--`;

    // 3. 업로드 요청
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error("Google Drive upload error:", res.status, err);
      return null;
    }

    const data = await res.json();
    console.log("Google Drive 저장 완료 (OAuth):", data.id, data.name);
    return data.id;
  } catch (err: any) {
    console.error("Google Drive exception:", err.message);
    return null;
  }
}

// ══════ API Route ══════

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      startedAt, jobId, jobLabel, scenarioId, scenarioTitle,
      provider, personas, messages, evaluation, totalCost, totalTokens,
    } = body;

    const session = {
      meta: {
        startedAt, endedAt: new Date().toISOString(),
        jobId, jobLabel, scenarioId, scenarioTitle, provider, totalCost, totalTokens,
      },
      personas: personas?.map((p: any) => ({
        name: p.name, role: p.role, age: p.age, sex: p.sex,
        occupation: p.occupation, province: p.province, district: p.district,
      })),
      chatLog: messages
        ?.filter((m: any) => m.sender !== "system" && !m.loading)
        .map((m: any) => ({ sender: m.sender, text: m.text })),
      evaluation,
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `sjt-${jobId}-${timestamp}.json`;
    const jsonContent = JSON.stringify(session, null, 2);

    // 1. 로컬 저장 시도 (Vercel 환경 고려)
    let localSaved = false;
    try {
      const sessionsDir = path.join(process.cwd(), "sessions");
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(path.join(sessionsDir, filename), jsonContent, "utf-8");
      localSaved = true;
    } catch (e) {
      // 로컬 쓰기 실패는 Vercel 환경에서 일반적이므로 조용히 넘어감
    }

    // 2. Google Drive 저장 (OAuth 방식 호출)
    const driveFileId = await uploadToGoogleDrive(filename, jsonContent);

    return NextResponse.json({
      saved: true,
      filename,
      local: localSaved,
      googleDrive: driveFileId ? { fileId: driveFileId } : null,
    });
  } catch (error: any) {
    console.error("Session save error:", error);
    return NextResponse.json({ error: error.message || "저장 실패" }, { status: 500 });
  }
}