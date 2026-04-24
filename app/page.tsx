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

/* ── ChatBubble ── */
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
    <div className="msg-enter" style={{ display: "flex", flexDirection: isUser ? "row-reverse" : "row", alignItems: "flex-start", gap: 8, margin: "6px 0", paddingLeft: isUser ? 48 : 0, paddingRight: isUser ? 0 : 48 }}>
      {!isUser && p && (
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, marginTop: 2 }}>{p.avatar}</div>
      )}
      <div style={{ maxWidth: "80%" }}>
        {!isUser && p && <div style={{ fontSize: 11, color: p.color, fontWeight: 700, marginBottom: 3 }}>{p.name} · {p.role}</div>}
        <div style={{
          background: isUser ? "#1e293b" : p?.bgLight || "#f1f5f9", color: isUser ? "#fff" : "#1e293b",
          borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
          padding: "11px 15px", fontSize: 14, lineHeight: 1.7, boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}>
          {msg.loading ? <span className="loading-dots" style={{ color: "#94a3b8" }}><span>●</span> <span>●</span> <span>●</span></span> : msg.text}
        </div>
      </div>
    </div>
  );
}

/* ── Timer display ── */
function Timer({ seconds, warning }: { seconds: number; warning: boolean }) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (
    <div className={warning ? "timer-warning" : ""} style={{
      background: warning ? "#fef2f2" : "#f0fdf4", border: `1px solid ${warning ? "#fca5a5" : "#86efac"}`,
      borderRadius: 8, padding: "4px 12px", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums",
      color: warning ? "#dc2626" : "#16a34a", display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      ⏱ {m}:{s.toString().padStart(2, "0")}
    </div>
  );
}

/* ── Eval Modal ── */
function EvalModal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 20, maxWidth: 640, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 28 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, color: "#1e293b" }}>📊 SJT 평가 결과</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>✕</button>
        </div>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.8, color: "#334155" }}>{text}</div>
      </div>
    </div>
  );
}

/* ── MAIN ── */
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
  const [timeLeft, setTimeLeft] = useState(300); // 5분 = 300초
  const [timerActive, setTimerActive] = useState(false);
  const [personaError, setPersonaError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Load providers
  useEffect(() => {
    fetch("/api/providers").then((r) => r.json()).then((d) => {
      setProviders(d.providers || []);
      if (d.providers?.length > 0) setSelectedProvider(d.providers[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Timer
  useEffect(() => {
    if (timerActive && timeLeft > 0) {
      timerRef.current = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }
    if (timerActive && timeLeft <= 0) {
      setTimerActive(false);
      triggerAutoEvaluation();
    }
  }, [timerActive, timeLeft]);

  // ── Job selection → load personas ──
  const selectJob = useCallback(async (jid: string) => {
    setJobId(jid);
    setPhase("loading_personas");
    setPersonaError("");
    try {
      const res = await fetch(`/api/personas?job=${jid}`);
      const data = await res.json();
      if (data.error) { setPersonaError(data.error); setPhase("job"); return; }
      setPersonas(data.personas);
      setPhase("scenario");
    } catch (e: any) {
      setPersonaError("페르소나 로드 실패. 다시 시도해주세요.");
      setPhase("job");
    }
  }, []);

  // ── Start scenario → start timer ──
  const startScenario = useCallback((sc: Scenario) => {
    setScenario(sc);
    setPhase("chat");
    setTimeLeft(300);
    setTimerActive(true);
    setTotalCost(0);
    setTotalTokens({ input: 0, output: 0 });
    setEvaluation(null);
    const pLabel = providers.find((p) => p.id === selectedProvider)?.label || "";
    const pNames = personas.map((p) => `${p.avatar} ${p.name}(${p.role}, ${p.age}세)`).join("\n");
    setMessages([{
      sender: "system",
      text: `📋 ${sc.title}\n\n${sc.description}\n\n👥 참여 직원:\n${pNames}\n\n🤖 모델: ${pLabel}\n⏱ 5분 타이머가 시작되었습니다. 시간이 끝나면 자동으로 평가됩니다.\n\n대화를 시작하세요!`,
    }]);
  }, [personas, providers, selectedProvider]);

  // ── Send message ──
  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading || !scenario || !timerActive) return;
    const text = input.trim();
    setInput("");
    setLoading(true);
    const userMsg: Msg = { sender: "user", text };
    const updated = [...messages, userMsg];
    setMessages([...updated, { sender: "loading", text: "", loading: true }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario.id, messages: updated, userMessage: text, personas, provider: selectedProvider }),
      });
      const data = await res.json();
      if (data.error) {
        setMessages([...updated, { sender: "system", text: `⚠️ ${data.error}` }]);
      } else {
        setMessages([...updated, ...data.responses]);
        if (data.usage) {
          setTotalCost((c) => c + (data.usage.totalCost || 0));
          setTotalTokens((t) => ({ input: t.input + (data.usage.totalInputTokens || 0), output: t.output + (data.usage.totalOutputTokens || 0) }));
        }
      }
    } catch { setMessages([...updated, { sender: "system", text: "⚠️ 네트워크 오류" }]); }
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [input, loading, messages, scenario, personas, selectedProvider, timerActive]);

  // ── Auto evaluation ──
  const triggerAutoEvaluation = useCallback(async () => {
    if (!scenario) return;
    setPhase("evaluating");
    setMessages((prev) => [...prev, { sender: "system", text: "⏱ 5분이 경과했습니다. 대화 내용을 분석하고 있습니다..." }]);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: scenario.id, messages: messages.filter((m) => !m.loading), personas, provider: selectedProvider }),
      });
      const data = await res.json();
      setEvaluation(data.evaluation || data.error || "평가 실패");
      if (data.usage) {
        setTotalCost((c) => c + (data.usage.cost || 0));
        setTotalTokens((t) => ({ input: t.input + (data.usage.inputTokens || 0), output: t.output + (data.usage.outputTokens || 0) }));
      }
    } catch { setEvaluation("⚠️ 평가 요청 중 오류가 발생했습니다."); }
    setPhase("chat");
  }, [messages, scenario, personas, selectedProvider]);

  const darkBg = "linear-gradient(145deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)";

  /* ══════ Phase: Job Selection ══════ */
  if (phase === "job" || phase === "loading_personas") {
    return (
      <div style={{ minHeight: "100vh", background: darkBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ fontSize: 12, letterSpacing: 4, color: "#64748b", textTransform: "uppercase", marginBottom: 12, fontWeight: 500 }}>Situational Judgement Test</div>
        <h1 style={{ fontSize: 28, color: "#f8fafc", fontWeight: 900, marginBottom: 8, textAlign: "center" }}>AI 기반 상황판단 시뮬레이션</h1>
        <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 12, textAlign: "center", maxWidth: 440, lineHeight: 1.6 }}>
          직무를 선택하면 Nemotron-Personas-Korea 데이터셋에서<br />3명의 가상 직원을 불러옵니다.
        </p>

        {/* Provider selector */}
        {providers.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap", justifyContent: "center" }}>
            {providers.map((p) => (
              <button key={p.id} onClick={() => setSelectedProvider(p.id)} style={{
                background: selectedProvider === p.id ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${selectedProvider === p.id ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 10, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: selectedProvider === p.id ? "#a5b4fc" : "#94a3b8" }}>{p.label}</div>
              </button>
            ))}
          </div>
        )}
        {providers.length === 0 && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 20px", marginBottom: 28, textAlign: "center" }}>
            <div style={{ color: "#fca5a5", fontSize: 13 }}>⚠️ .env.local에 API 키를 추가하세요</div>
          </div>
        )}

        {personaError && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "10px 18px", marginBottom: 20, color: "#fca5a5", fontSize: 13 }}>{personaError}</div>
        )}

        {/* Job cards */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", maxWidth: 720 }}>
          {JOB_CATEGORIES.map((j) => (
            <button key={j.id} onClick={() => selectJob(j.id)} disabled={phase === "loading_personas" || providers.length === 0}
              style={{
                background: phase === "loading_personas" && jobId === j.id ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "20px 18px", width: 140,
                cursor: phase === "loading_personas" ? "wait" : providers.length === 0 ? "not-allowed" : "pointer",
                textAlign: "center", fontFamily: "inherit", transition: "all 0.2s",
                opacity: providers.length === 0 ? 0.4 : 1,
              }}
              onMouseEnter={(e) => { if (providers.length > 0) e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = phase === "loading_personas" && jobId === j.id ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)"; }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>{j.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{j.label}</div>
              {phase === "loading_personas" && jobId === j.id && (
                <div style={{ fontSize: 11, color: "#a5b4fc", marginTop: 6 }}>직원 로딩중...</div>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ══════ Phase: Scenario Selection ══════ */
  if (phase === "scenario") {
    const jobLabel = JOB_CATEGORIES.find((j) => j.id === jobId)?.label || "";
    const scenarios = getScenariosForJob(jobId);
    return (
      <div style={{ minHeight: "100vh", background: darkBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <button onClick={() => setPhase("job")} style={{ position: "absolute", top: 20, left: 20, background: "none", border: "none", color: "#64748b", fontSize: 16, cursor: "pointer" }}>← 직무 다시 선택</button>

        <div style={{ fontSize: 12, letterSpacing: 4, color: "#64748b", textTransform: "uppercase", marginBottom: 8, fontWeight: 500 }}>{jobLabel} 시나리오</div>
        <h2 style={{ fontSize: 24, color: "#f8fafc", fontWeight: 900, marginBottom: 24, textAlign: "center" }}>상황을 선택하세요</h2>

        {/* Personas preview */}
        <div style={{ display: "flex", gap: 14, marginBottom: 32, flexWrap: "wrap", justifyContent: "center" }}>
          {personas.map((p) => (
            <div key={p.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: "14px 18px", maxWidth: 200, border: `1px solid ${p.color}33` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 22 }}>{p.avatar}</span>
                <div>
                  <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>{p.role} · {p.age}세</div>
                </div>
              </div>
              <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4 }}>{p.province} {p.district} · {p.occupation}</div>
            </div>
          ))}
        </div>

        {/* Scenario cards */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center", maxWidth: 760 }}>
          {scenarios.map((sc) => (
            <button key={sc.id} onClick={() => startScenario(sc)} style={{
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16, padding: "22px 20px", width: 340, cursor: "pointer",
              textAlign: "left", fontFamily: "inherit", transition: "all 0.2s",
            }}
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

  /* ══════ Phase: Chat ══════ */
  const timerWarning = timeLeft <= 60 && timeLeft > 0;
  const timerDone = timeLeft <= 0;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#f8fafc" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => { setTimerActive(false); setPhase("scenario"); }} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#64748b", padding: "4px 8px" }}>←</button>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>{scenario?.icon} {scenario?.title}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {providers.find((p) => p.id === selectedProvider)?.label || ""}
              {totalCost > 0 && <span style={{ marginLeft: 6, color: "#f59e0b" }}>💰 ${totalCost.toFixed(4)}</span>}
            </div>
          </div>
        </div>
        <Timer seconds={timeLeft} warning={timerWarning} />
      </div>

      {/* Employee bar */}
      <div style={{ display: "flex", gap: 8, padding: "8px 16px", background: "#fff", borderBottom: "1px solid #f1f5f9", flexShrink: 0, overflowX: "auto" }}>
        {personas.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 5, background: p.bgLight, borderRadius: 20, padding: "4px 12px", border: `1px solid ${p.color}22`, flexShrink: 0 }}>
            <span style={{ fontSize: 14 }}>{p.avatar}</span>
            <span style={{ fontSize: 11, color: p.color, fontWeight: 600 }}>{p.name}</span>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>{p.age}세</span>
          </div>
        ))}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px", display: "flex", flexDirection: "column" }}>
        {messages.map((msg, i) => <ChatBubble key={i} msg={msg} personas={personas} />)}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "12px 16px 24px", background: "#fff", borderTop: "1px solid #e2e8f0", flexShrink: 0 }}>
        {timerDone && !evaluation ? (
          <div style={{ textAlign: "center", padding: "12px", color: "#94a3b8", fontSize: 14 }}>
            {phase === "evaluating" ? "📊 평가 분석 중..." : "⏱ 시간 종료 — 평가 결과를 확인하세요"}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={loading ? "직원들이 응답 중..." : timerDone ? "시간이 종료되었습니다" : "팀원들에게 메시지를 보내세요..."}
              disabled={loading || timerDone}
              style={{ flex: 1, padding: "12px 16px", borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 14, outline: "none", fontFamily: "inherit", background: loading || timerDone ? "#f8fafc" : "#fff" }} />
            <button onClick={sendMessage} disabled={!input.trim() || loading || timerDone}
              style={{
                background: input.trim() && !loading && !timerDone ? "#1e293b" : "#e2e8f0",
                color: input.trim() && !loading && !timerDone ? "#fff" : "#94a3b8",
                border: "none", borderRadius: 12, width: 44, height: 44, fontSize: 18,
                cursor: input.trim() && !loading && !timerDone ? "pointer" : "default",
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              }}>↑</button>
          </div>
        )}
      </div>

      {evaluation && <EvalModal text={evaluation} onClose={() => setEvaluation(null)} />}
    </div>
  );
}
