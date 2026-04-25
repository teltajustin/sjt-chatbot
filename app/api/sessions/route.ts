import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import crypto from "crypto";

// ══════════════════════════════════════════════
// Google Service Account → Drive 업로드
// Access Token 만료 문제 없음 (JWT로 자동 발급)
// ══════════════════════════════════════════════

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

// Base64URL 인코딩
function base64url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Service Account로 Access Token 발급 (JWT 방식)
async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
    })
  );

  const signInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = base64url(sign.sign(sa.private_key));

  const jwt = `${signInput}.${signature}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token request failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

// Service Account 키 로드 (환경변수 또는 파일)
function getServiceAccountKey(): ServiceAccountKey | null {
  // 방법 1: 환경변수에 JSON 문자열로 저장
  const envKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (envKey) {
    try {
      return JSON.parse(envKey);
    } catch {
      console.error("GOOGLE_SERVICE_ACCOUNT_KEY JSON 파싱 실패");
      return null;
    }
  }

  // 방법 2: 환경변수에 개별 필드로 저장
  const email = process.env.GOOGLE_SA_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (email && privateKey) {
    return {
      client_email: email,
      private_key: privateKey,
      token_uri: "https://oauth2.googleapis.com/token",
    };
  }

  return null;
}

// Google Drive 업로드
async function uploadToGoogleDrive(
  filename: string,
  jsonContent: string
): Promise<string | null> {
  const sa = getServiceAccountKey();
  if (!sa) {
    console.log("Google Drive: Service Account 미설정, 스킵");
    return null;
  }

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  try {
    const accessToken = await getAccessToken(sa);

    const boundary = "sjt_boundary_" + Date.now();
    const metadata = JSON.stringify({
      name: filename,
      mimeType: "application/json",
      ...(folderId ? { parents: [folderId] } : {}),
    });

    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${jsonContent}\r\n` +
      `--${boundary}--`;

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
    console.log("Google Drive 저장 완료:", data.id);
    return data.id;
  } catch (err: any) {
    console.error("Google Drive upload exception:", err.message);
    return null;
  }
}

// ══════════════════════════════════════════════

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      startedAt, jobId, jobLabel, scenarioId, scenarioTitle,
      provider, personas, messages, evaluation, totalCost, totalTokens,
    } = body;

    const session = {
      meta: {
        startedAt,
        endedAt: new Date().toISOString(),
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

    // 1. 로컬 저장
    let localSaved = false;
    try {
      const sessionsDir = path.join(process.cwd(), "sessions");
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(path.join(sessionsDir, filename), jsonContent, "utf-8");
      localSaved = true;
    } catch (localErr: any) {
      console.error("로컬 저장 실패:", localErr.message);
    }

    // 2. Google Drive 저장 (Service Account)
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
