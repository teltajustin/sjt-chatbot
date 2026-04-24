"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { JOB_CATEGORIES } from "@/lib/jobs";
import { getScenariosForJob, Scenario } from "@/lib/scenarios";

interface Persona {
  id: string; name: string; role: string; age: number; sex: string;
  avatar: string; color: string; bgLight: string;
  persona: string; professional_persona: string; cultural_background: string;
  skills_and_expertise: string; career_goals_and_ambitions: string;
  family_persona: string; occupation: string; district: string; province: string;
  education_level: string; marital_status: string;
  personality_traits: string; speech_style: string;
}
interface Msg { sender: string; text: string; loading?: boolean; }
interface ProviderInfo { id: string; label: string; model: string; }

function ChatBubble({ msg, personas }: { msg: Msg; personas: Persona[] }) {
  const isUser = msg.sender === "user";
  const isSystem = msg.sender === "system";
  const p = !isUser && !isSystem ? personas.find((x) => x.id === msg.sender) : null;
  if (isSystem) return (
    <div className="msg-enter" style={{ display: "flex", justifyContent: "center", margin: "14px 0" }}>
      <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 14, padding: "11px 18px", maxWidth: "90%", fontSize: 13, color: "#92400e", lineHeight: 1.6 }}>{msg.text}</div>
    </div>
  );
  return (
    <div className="msg-enter" style={{ display: "flex", flexDirection: isUser ? "row-reverse" : "row", alignItems: "flex-end", gap: 6, margin: "4px 0", paddingLeft: isUser ? 60 : 0, paddingRight: isUser ? 0 : 60 }}>
      {!isUser && p && <div style={{ width: 32, height: 32, borderRadius: "50%", background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{p.avatar}</div>}
      <div style={{ maxWidth: "78%" }}>
        {!isUser && p && <div style={{ fontSize: 11, color: p.color, fontWeight: 600, marginBottom: 2 }}>{p.name}</div>}
        <div style={{ background: isUser ? "#1e293b" : p?.bgLight || "#f1f5f9", color: isUser ? "#fff" : "#1e293b", borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px", padding: "9px 13px", fontSize: 14, lineHeight: 1.6 }}>
          {msg.loading ? <span className="loading-dots" style={{ color: "#94a3b8" }}><span>●</span> <span>●</span> <span>●</span></span> : msg.text}
        </div>
      </div>
    </div>
  );
}

function Timer({ seconds, warning }: { seconds: number; warning: boolean }) {
  const m = Math.floor(seconds / 60); const s = seconds % 60;
  return (
    <div className={warning ? "timer-warning" : ""} style={{
      background: warning ? "#fef2f2" : "#f0fdf4", border: `1px solid ${warning ? "#fca5a5" : "#86efac"}`,
      borderRadius: 8, padding: "4px 12px", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums",
      color: warning ? "#dc2626" : "#16a34a",
    }}>{m}:{s.toString().padStart(2, "0")}</div>
  );
}

function EvalModal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 20, maxWidth: 640, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 28 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, color: "#1e293b" }}>SJT 평가 결과</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.8, color: "#334155" }}>{text}</div>
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <button onClick={onClose} style={{ background: "#1e293b", color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>확인 후 처음으로 돌아가기</button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  type Phase = "job" | "loading_personas" | "scenario" | "chat" | "evaluating";
  const [phase, setPhase] = useState<Phase>("job");
  const [jobId, setJobId] = useState("");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [evaluation, setEvaluation] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [totalTokens, setTotalTokens] = useState({ input: 0, output: 0 });
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [timeLeft, setTimeLeft] = useState(300);
  const [timerActive, setTimerActive] = useState(false);
  const [personaError, setPersonaError] = useState("");
  const [sessionStartedAt, setSessionStartedAt] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const evalTriggered = useRef(false);

  useEffect(() => {
    fetch("/api/providers").then((r) => r.json()).then((d) => {
      setProviders(d.providers || []);
      if (d.providers?.length > 0) setSelectedProvider(d.providers[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (timerActive && timeLeft > 0) {
      timerRef.current = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }
    if (timerActive && timeLeft <= 0 && !evalTriggered.current) {
      evalTriggered.current = true;
      setTimerActive(false);
      triggerAutoEvaluation();
    }
  }, [timerActive, timeLeft]);

  const saveSession = useCallback(async (evalText: string) => {
    try {
      const jobLabel = JOB_CATEGORIES.find((j) => j.id === jobId)?.label || "";
      await fetch("/api/sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startedAt: sessionStartedAt, jobId, jobLabel, scenarioId: scenario?.id, scenarioTitle: scenario?.title, provider: selectedProvider, personas, messages: messages.filter((m) => !m.loading), evaluation: evalText, totalCost, totalTokens }),
      });
    } catch (e) { console.error("Session save failed:", e); }
  }, [sessionStartedAt, jobId, scenario, selectedProvider, personas, messages, totalCost, totalTokens]);

  const closeEvalAndReset = useCallback(() => {
    setEvaluation(null); setPhase("job"); setJobId(""); setPersonas([]); setScenario(null);
    setMessages([]); setTotalCost(0); setTotalTokens({ input: 0, output: 0 }); setTimeLeft(300);
    evalTriggered.current = false;
  }, []);

  const selectJob = useCallback(async (jid: string) => {
    setJobId(jid); setPhase("loading_personas"); setPersonaError("");
    try {
      const res = await fetch(`/api/personas?job=${jid}`);
      const data = await res.json();
      if (data.error) { setPersonaError(data.error); setPhase("job"); return; }
      setPersonas(data.personas); setPhase("scenario");
    } catch { setPersonaError("페르소나 로드 실패. 다시 시도해주세요."); setPhase("job"); }
  }, []);

  const startScenario = useCallback((sc: Scenario) => {
    setScenario(sc); setPhase("chat"); setTimeLeft(300); setTimerActive(true);
    evalTriggered.current = false; setTotalCost(0); setTotalTokens({ input: 0, output: 0 });
    setEvaluation(null); setSessionStartedAt(new Date().toISOString());
    const briefing = `[상황 브리핑]\n\n${sc.description}\n\n당신은 이 팀의 팀장입니다. 지금부터 5분간 팀원들과 사내 메신저에서 이 문제에 대해 논의합니다.\n\n당신의 역할:\n- 팀원들의 의견을 듣고 상황을 파악하세요.\n- 각자의 전문성을 활용해 해결 방향을 도출하세요.\n- 의견이 충돌하면 근거를 바탕으로 조율하세요.\n- 5분 안에 구체적인 다음 액션을 정하세요.\n\n대화를 시작해주세요.`;
    setMessages([{ sender: "system", text: briefing }]);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading || !scenario || !timerActive) return;
    const text = input.trim(); setInput(""); setLoading(true);
    const userMsg: Msg = { sender: "user", text };
    const updated = [...messages, userMsg];
    setMessages([...updated, { sender: "loading", text: "", loading: true }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario.id, messages: updated, userMessage: text, personas, provider: selectedProvider }),
      });
      const data = await res.json();
      if (data.error) { setMessages([...updated, { sender: "system", text: `오류: ${data.error}` }]); }
      else {
        setMessages([...updated, ...data.responses]);
        if (data.usage) {
          setTotalCost((c) => c + (data.usage.totalCost || 0));
          setTotalTokens((t) => ({ input: t.input + (data.usage.totalInputTokens || 0), output: t.output + (data.usage.totalOutputTokens || 0) }));
        }
      }
    } catch { setMessages([...updated, { sender: "system", text: "네트워크 오류가 발생했습니다." }]); }
    setLoading(false); setTimeout(() => inputRef.current?.focus(), 100);
  }, [input, loading, messages, scenario, personas, selectedProvider, timerActive]);

  const triggerAutoEvaluation = useCallback(async () => {
    if (!scenario) return;
    setPhase("evaluating");
    setMessages((prev) => [...prev, { sender: "system", text: "5분이 경과했습니다. 대화 내용을 분석 중입니다..." }]);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario.id, messages: messages.filter((m) => !m.loading), personas, provider: selectedProvider }),
      });
      const data = await res.json();
      const evalText = data.evaluation || data.error || "평가에 실패했습니다.";
      setEvaluation(evalText);
      if (data.usage) {
        setTotalCost((c) => c + (data.usage.cost || 0));
        setTotalTokens((t) => ({ input: t.input + (data.usage.inputTokens || 0), output: t.output + (data.usage.outputTokens || 0) }));
      }
      await saveSession(evalText);
    } catch { setEvaluation("평가 요청 중 오류가 발생했습니다."); }
    setPhase("chat");
  }, [messages, scenario, personas, selectedProvider, saveSession]);

  const darkBg = "linear-gradient(145deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)";

  // ══════ Job Selection ══════
  if (phase === "job" || phase === "loading_personas") {
    return (
      <div style={{ minHeight: "100vh", background: darkBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ fontSize: 12, letterSpacing: 4, color: "#64748b", textTransform: "uppercase", marginBottom: 12, fontWeight: 500 }}>Situational Judgement Test</div>
        <h1 style={{ fontSize: 28, color: "#f8fafc", fontWeight: 900, marginBottom: 8, textAlign: "center" }}>상황판단 시뮬레이션</h1>
        <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 12, textAlign: "center", maxWidth: 440, lineHeight: 1.6 }}>직무를 선택하면 해당 분야의 가상 팀원 3명이 배정됩니다.<br/>5분간 실제 업무 상황에서 의사결정을 내려보세요.</p>
        {providers.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap", justifyContent: "center" }}>
            {providers.map((p) => (
              <button key={p.id} onClick={() => setSelectedProvider(p.id)} style={{
                background: selectedProvider === p.id ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${selectedProvider === p.id ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 10, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit",
              }}><div style={{ fontSize: 13, fontWeight: 600, color: selectedProvider === p.id ? "#a5b4fc" : "#94a3b8" }}>{p.label}</div></button>
            ))}
          </div>
        )}
        {providers.length === 0 && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 20px", marginBottom: 28, textAlign: "center" }}><div style={{ color: "#fca5a5", fontSize: 13 }}>API 키가 설정되지 않았습니다.</div></div>}
        {personaError && <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "10px 18px", marginBottom: 20, color: "#fca5a5", fontSize: 13 }}>{personaError}</div>}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", maxWidth: 720 }}>
          {JOB_CATEGORIES.map((j) => (
            <button key={j.id} onClick={() => selectJob(j.id)} disabled={phase === "loading_personas" || providers.length === 0}
              style={{ background: phase === "loading_personas" && jobId === j.id ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "20px 18px", width: 140, cursor: phase === "loading_personas" ? "wait" : providers.length === 0 ? "not-allowed" : "pointer", textAlign: "center", fontFamily: "inherit", transition: "all 0.2s", opacity: providers.length === 0 ? 0.4 : 1 }}
              onMouseEnter={(e) => { if (providers.length > 0) e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = phase === "loading_personas" && jobId === j.id ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)"; }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>{j.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{j.label}</div>
              {phase === "loading_personas" && jobId === j.id && <div style={{ fontSize: 11, color: "#a5b4fc", marginTop: 6 }}>팀원 배정중...</div>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ══════ Scenario Selection — skills_and_expertise 표시 ══════
  if (phase === "scenario") {
    const jobLabel = JOB_CATEGORIES.find((j) => j.id === jobId)?.label || "";
    const scenarios = getScenariosForJob(jobId);
    return (
      <div style={{ minHeight: "100vh", background: darkBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <button onClick={() => setPhase("job")} style={{ position: "absolute", top: 20, left: 20, background: "none", border: "none", color: "#64748b", fontSize: 16, cursor: "pointer" }}>← 직무 다시 선택</button>
        <div style={{ fontSize: 12, letterSpacing: 4, color: "#64748b", textTransform: "uppercase", marginBottom: 8, fontWeight: 500 }}>{jobLabel}</div>
        <h2 style={{ fontSize: 24, color: "#f8fafc", fontWeight: 900, marginBottom: 24, textAlign: "center" }}>상황을 선택하세요</h2>
        <div style={{ display: "flex", gap: 14, marginBottom: 32, flexWrap: "wrap", justifyContent: "center" }}>
          {personas.map((p) => (
            <div key={p.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: "14px 16px", maxWidth: 220, border: `1px solid ${p.color}33` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>{p.avatar}</span>
                <div>
                  <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>{p.role} · {p.age}세</div>
                </div>
              </div>
              {/* ★ 주소 대신 skills_and_expertise 표시 (최대 250자) */}
              <div style={{ color: "#94a3b8", fontSize: 10, lineHeight: 1.5 }}>
                {(p.skills_and_expertise || "").length > 250
                  ? (p.skills_and_expertise || "").slice(0, 250) + "..."
                  : p.skills_and_expertise}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center", maxWidth: 760 }}>
          {scenarios.map((sc) => (
            <button key={sc.id} onClick={() => startScenario(sc)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "22px 20px", width: 340, cursor: "pointer", textAlign: "left", fontFamily: "inherit", transition: "all 0.2s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.transform = "translateY(0)"; }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{sc.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", marginBottom: 6 }}>{sc.title}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{sc.description}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ══════ Chat ══════
  const timerWarning = timeLeft <= 60 && timeLeft > 0;
  const timerDone = timeLeft <= 0;
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#f8fafc" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => { setTimerActive(false); setPhase("scenario"); }} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b", padding: "4px 8px" }}>←</button>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>{scenario?.title}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {personas.map((p) => p.name).join(", ")}
              {totalCost > 0 && <span style={{ marginLeft: 6, color: "#f59e0b" }}>${totalCost.toFixed(4)}</span>}
            </div>
          </div>
        </div>
        <Timer seconds={timeLeft} warning={timerWarning} />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "10px 14px", display: "flex", flexDirection: "column" }}>
        {messages.map((msg, i) => <ChatBubble key={i} msg={msg} personas={personas} />)}
        <div ref={chatEndRef} />
      </div>
      <div style={{ padding: "10px 14px 22px", background: "#fff", borderTop: "1px solid #e2e8f0", flexShrink: 0 }}>
        {timerDone && !evaluation ? (
          <div style={{ textAlign: "center", padding: "10px", color: "#94a3b8", fontSize: 14 }}>
            {phase === "evaluating" ? "평가 분석 중..." : "시간 종료 — 평가 결과를 확인하세요."}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={loading ? "응답 대기중..." : timerDone ? "시간이 종료되었습니다" : "메시지를 입력하세요"}
              disabled={loading || timerDone}
              style={{ flex: 1, padding: "10px 14px", borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 14, outline: "none", fontFamily: "inherit", background: loading || timerDone ? "#f8fafc" : "#fff" }} />
            <button onClick={sendMessage} disabled={!input.trim() || loading || timerDone}
              style={{ background: input.trim() && !loading && !timerDone ? "#1e293b" : "#e2e8f0", color: input.trim() && !loading && !timerDone ? "#fff" : "#94a3b8", border: "none", borderRadius: 12, width: 42, height: 42, fontSize: 16, cursor: input.trim() && !loading && !timerDone ? "pointer" : "default", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>↑</button>
          </div>
        )}
      </div>
      {evaluation && <EvalModal text={evaluation} onClose={closeEvalAndReset} />}
    </div>
  );
}
