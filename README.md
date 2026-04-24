# SJT 시뮬레이션 챗봇

AI 기반 Situational Judgement Test — 가상 직원 3명과 대화하며 리더십 역량을 측정합니다.

지원 모델: **Claude** (Anthropic) / **GPT-4o** (OpenAI) / **Gemini** (Google)

---

## 🍎 Mac 초보자를 위한 설치 가이드

### Step 1: 터미널 열기

`Command(⌘) + Space` → "터미널" 입력 → Enter

터미널이 열리면 아래 명령어들을 한 줄씩 복사해서 붙여넣기(⌘+V) 하세요.

### Step 2: Node.js 설치

```bash
# Homebrew 설치 (Mac 패키지 관리자)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js 설치
brew install node

# 설치 확인 (v18 이상이면 OK)
node --version
```

> 이미 Node.js가 설치되어 있다면 이 단계는 건너뛰세요.

### Step 3: 프로젝트 다운로드 & 설정

```bash
# 다운로드한 zip을 풀었다면, 해당 폴더로 이동
# 예: 다운로드 폴더에 압축을 풀었다면
cd ~/Downloads/sjt-chatbot

# 패키지 설치 (1-2분 소요)
npm install
```

### Step 4: API 키 설정

```bash
# 환경변수 파일 생성
cp .env.local.example .env.local

# 파일 편집 열기
open -e .env.local
```

TextEdit이 열리면, 사용할 API의 키를 입력합니다.
**3개 중 1개만 있어도 됩니다.** 여러 개 입력하면 화면에서 선택 가능합니다.

```
# 예시: Gemini만 사용할 경우
GEMINI_API_KEY=AIzaSy여기에_실제_키_입력
```

저장(⌘+S) 후 TextEdit을 닫습니다.

#### API 키 발급 방법

| 서비스 | 발급 페이지 | 무료 여부 |
|--------|------------|-----------|
| **Gemini** | https://aistudio.google.com/apikey | ✅ 무료 크레딧 넉넉 |
| **OpenAI** | https://platform.openai.com/api-keys | 💰 종량제 (최소 $5 충전) |
| **Anthropic** | https://console.anthropic.com/ | 💰 종량제 (최소 $5 충전) |

> 💡 **추천**: 처음이라면 **Gemini**가 무료 크레딧이 넉넉해서 테스트하기 좋습니다.

### Step 5: 실행!

```bash
npm run dev
```

아래와 같은 메시지가 나타나면 성공입니다:

```
▲ Next.js 14.x.x
- Local:   http://localhost:3000
```

**브라우저에서 http://localhost:3000 접속**하면 SJT 시뮬레이션을 시작할 수 있습니다.

> 종료하려면 터미널에서 `Ctrl + C`를 누르세요.

---

## 🌐 다른 사람에게 공유하기 (Vercel 배포)

### Step 1: GitHub 계정 & 저장소 만들기

1. https://github.com 에서 계정 생성 (이미 있다면 로그인)
2. 우측 상단 `+` → **New repository** 클릭
3. 이름: `sjt-chatbot`, Public 선택 → **Create repository**

### Step 2: 코드 올리기

```bash
cd ~/Downloads/sjt-chatbot   # 프로젝트 폴더로 이동

git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/내아이디/sjt-chatbot.git
git push -u origin main
```

> `내아이디` 부분을 실제 GitHub 아이디로 바꿔주세요.
> Git이 없다면 `brew install git` 으로 먼저 설치하세요.

### Step 3: Vercel에 배포

1. https://vercel.com → **GitHub로 로그인**
2. **"Add New Project"** 클릭
3. `sjt-chatbot` 저장소 선택 → **Import**
4. **Environment Variables** 섹션에서 API 키 추가:

   | Name | Value |
   |------|-------|
   | `GEMINI_API_KEY` | 발급받은 키 |
   | `OPENAI_API_KEY` | (선택) 발급받은 키 |
   | `ANTHROPIC_API_KEY` | (선택) 발급받은 키 |

5. **Deploy** 클릭 → 1-2분 후 완료

배포 후 받는 URL (예: `https://sjt-chatbot-xxxx.vercel.app`)을
**다른 사람에게 공유하면 바로 테스트** 할 수 있습니다.

---

## 📁 프로젝트 구조

```
sjt-chatbot/
├── app/
│   ├── layout.tsx              # HTML 레이아웃
│   ├── page.tsx                # 메인 UI
│   ├── globals.css             # 스타일
│   └── api/
│       ├── chat/route.ts       # 직원 응답 API
│       ├── evaluate/route.ts   # 평가 분석 API
│       └── providers/route.ts  # 사용 가능 모델 목록 API
├── lib/
│   ├── personas.ts             # 직원 페르소나 데이터
│   ├── scenarios.ts            # 시나리오 데이터
│   ├── prompts.ts              # LLM 프롬프트 빌더
│   └── llm-client.ts           # 멀티 프로바이더 LLM 클라이언트
├── .env.local.example          # 환경변수 예시
├── package.json
└── README.md
```

## 아키텍처

```
[브라우저]                    [Next.js 서버]              [LLM API]
    │                             │                         │
    ├── GET /api/providers ──────►│ 환경변수 확인 ──────────►│
    │◄── 사용 가능 모델 목록 ─────┤                         │
    │                             │                         │
    ├── POST /api/chat ──────────►│ 선택된 프로바이더로 ────►│ Claude / GPT / Gemini
    │◄── 직원 1~3명 응답 ─────────┤◄── 응답 ────────────────┤
    │                             │                         │
    ├── POST /api/evaluate ──────►│ 대화 전문 분석 요청 ───►│
    │◄── 5개 역량 점수 ───────────┤◄── 평가 결과 ───────────┤
```

- API 키는 서버에서만 사용 → 브라우저에 노출되지 않음
- .env.local에 설정된 키에 따라 사용 가능한 모델이 자동으로 화면에 표시

---

## 🔧 커스터마이징

### 페르소나 변경

`lib/personas.ts`를 수정하여 Nemotron-Personas-Korea에서 다른 인물 사용 가능:

```python
from datasets import load_dataset
ds = load_dataset("nvidia/Nemotron-Personas-Korea")
filtered = ds["train"].filter(lambda x: x["province"] == "서울" and 30 <= x["age"] <= 39)
print(filtered[0])  # → personas.ts에 복사
```

### 시나리오 추가

`lib/scenarios.ts`에 새 시나리오 객체를 추가하면 됩니다.

### 평가 기준 수정

`lib/prompts.ts`의 `buildEvaluationPrompt`에서 역량 항목과 배점 변경 가능.

---

## 💰 비용 참고

| 항목 | Claude Sonnet | GPT-4o | Gemini 2.5 Flash |
|------|--------------|--------|----------------|
| 입력 | $3/1M 토큰 | $2.5/1M 토큰 | 무료 티어 넉넉 |
| 출력 | $15/1M 토큰 | $10/1M 토큰 | 무료 티어 넉넉 |
| 1턴 (직원 3명) | ~$0.02 | ~$0.015 | ~무료 |
| 1회 평가 | ~$0.03 | ~$0.025 | ~무료 |
| 1세션 (10턴+평가) | ~$0.25 | ~$0.18 | ~무료 |

---

## 자주 묻는 질문

**Q: `npm: command not found` 오류가 나요**
→ Node.js가 설치되지 않은 것. Step 2의 `brew install node` 실행.

**Q: `brew: command not found` 오류가 나요**
→ Homebrew가 설치되지 않은 것. Step 2의 첫 번째 명령어 실행.

**Q: API 키를 넣었는데 모델이 안 뜨어요**
→ `.env.local` 파일이 프로젝트 루트 폴더에 있는지 확인. 서버 재시작(`Ctrl+C` 후 `npm run dev`).

**Q: 포트 3000이 이미 사용 중이래요**
→ `npm run dev -- -p 3001` 으로 다른 포트 사용.

---

## 라이선스

- 코드: MIT
- 페르소나 데이터: [CC-BY-4.0 (NVIDIA)](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea)
