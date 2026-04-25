"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { JOB_CATEGORIES } from "@/lib/jobs";
import { getScenariosForJob, Scenario } from "@/lib/scenarios";

interface Persona { id: string; name: string; role: string; age: number; sex: string; avatar: string; color: string; bgLight: string; persona: string; professional_persona: string; cultural_background: string; skills_and_expertise: string; career_goals_and_ambitions: string; family_persona: string; occupation: string; district: string; province: string; education_level: string; marital_status: string; personality_traits: string; speech_style: string; }
interface Msg { sender: string; text: string; loading?: boolean; ts?: string; }
interface ProviderInfo { id: string; label: string; model: string; }

const AVATAR_COLORS = ["#007a5a","#4a154b","#1264a3","#e01e5a","#ecb22e"];
function getAvatarBg(name: string) { let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; }
function timeNow() { return new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false}); }

/* ── Slack-style message ── */
function SlackMessage({ msg, personas, isConsecutive }: { msg: Msg; personas: Persona[]; isConsecutive: boolean }) {
  const isUser = msg.sender === "user";
  const isSystem = msg.sender === "system";
  const p = !isUser && !isSystem ? personas.find(x => x.id === msg.sender) : null;
  const name = isUser ? "나 (팀장)" : p?.name || "시스템";
  const color = isUser ? "#1264a3" : p ? getAvatarBg(p.name) : "#999";
  const initial = isUser ? "팀" : name.charAt(0);

  if (isSystem) return (
    <div className="slide-up" style={{ padding: "4px 20px", margin: "4px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
        <div style={{ height: 1, flex: 1, background: "#e8e8e8" }}/>
        <span style={{ fontSize: "0.75rem", color: "#616061", whiteSpace: "nowrap", fontWeight: 500 }}>{msg.text.length > 60 ? "📋 시나리오 안내" : msg.text}</span>
        <div style={{ height: 1, flex: 1, background: "#e8e8e8" }}/>
      </div>
      {msg.text.length > 60 && <div style={{ background: "#fff9e6", border: "1px solid #f0e4c4", borderRadius: 8, padding: "12px 16px", fontSize: "0.8125rem", color: "#1d1c1d", lineHeight: 1.6, whiteSpace: "pre-wrap", marginTop: 4 }}>{msg.text}</div>}
    </div>
  );

  if (msg.loading) return (
    <div style={{ padding: "6px 20px", display: "flex", gap: 10 }}>
      <div style={{ width: 36, height: 36 }}/>
      <div className="dots" style={{ paddingTop: 8, color: "#999" }}><span>·</span><span>·</span><span>·</span></div>
    </div>
  );

  return (
    <div className="slide-up" style={{ padding: isConsecutive ? "1px 20px" : "8px 20px 1px", display: "flex", gap: 10, cursor: "default" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#f8f8f8")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
      {!isConsecutive ? (
        <div style={{ width: 36, height: 36, borderRadius: 6, background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.875rem", fontWeight: 700, flexShrink: 0 }}>{initial}</div>
      ) : <div style={{ width: 36, flexShrink: 0 }}/>}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!isConsecutive && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#1d1c1d" }}>{name}</span>
            {p && <span style={{ fontSize: "0.6875rem", color: "#616061" }}>{p.role}</span>}
            <span style={{ fontSize: "0.6875rem", color: "#999" }}>{msg.ts || timeNow()}</span>
          </div>
        )}
        <div style={{ fontSize: "0.9375rem", color: "#1d1c1d", lineHeight: 1.6, wordBreak: "break-word" }}>{msg.text}</div>
      </div>
    </div>
  );
}

function Timer({ seconds }: { seconds: number }) {
  const m = Math.floor(seconds / 60); const s = seconds % 60;
  const warn = seconds <= 60 && seconds > 0;
  return (
    <div className={warn ? "timer-blink" : ""} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8125rem", fontWeight: 500, color: warn ? "#e01e5a" : "#1d1c1d", background: warn ? "#fce4ec" : "#f0f0f0", padding: "4px 10px", borderRadius: 6 }}>
      {m}:{s.toString().padStart(2,"0")}
    </div>
  );
}

function EvalModal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="fade-in" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "clamp(12px, 3vw, 24px)" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, maxWidth: 640, width: "100%", maxHeight: "85vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e8e8e8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "#1d1c1d" }}>역량 평가 결과</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#999", padding: 4 }}>✕</button>
        </div>
        <div style={{ padding: "20px 24px", whiteSpace: "pre-wrap", fontSize: "0.875rem", lineHeight: 1.8, color: "#1d1c1d" }}>{text}</div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid #e8e8e8", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "#007a5a", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>확인</button>
        </div>
      </div>
    </div>
  );
}

/* ══════ MAIN ══════ */
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
  const [totalTokens, setTotalTokens] = useState({input:0,output:0});
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [timeLeft, setTimeLeft] = useState(300);
  const [timerActive, setTimerActive] = useState(false);
  const [personaError, setPersonaError] = useState("");
  const [sessionStartedAt, setSessionStartedAt] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout|null>(null);
  const evalTriggered = useRef(false);

  useEffect(() => { fetch("/api/providers").then(r=>r.json()).then(d=>{ setProviders(d.providers||[]); if(d.providers?.length>0)setSelectedProvider(d.providers[0].id); }).catch(()=>{}); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages]);
  useEffect(() => {
    if(timerActive&&timeLeft>0){ timerRef.current=setTimeout(()=>setTimeLeft(t=>t-1),1000); return()=>{if(timerRef.current)clearTimeout(timerRef.current);}; }
    if(timerActive&&timeLeft<=0&&!evalTriggered.current){ evalTriggered.current=true; setTimerActive(false); triggerAutoEvaluation(); }
  }, [timerActive,timeLeft]);

  const saveSession = useCallback(async(evalText:string)=>{try{const jl=JOB_CATEGORIES.find(j=>j.id===jobId)?.label||"";await fetch("/api/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({startedAt:sessionStartedAt,jobId,jobLabel:jl,scenarioId:scenario?.id,scenarioTitle:scenario?.title,provider:selectedProvider,personas,messages:messages.filter(m=>!m.loading),evaluation:evalText,totalCost,totalTokens})});}catch(e){console.error("Session save:",e);}}, [sessionStartedAt,jobId,scenario,selectedProvider,personas,messages,totalCost,totalTokens]);

  const closeEvalAndReset = useCallback(()=>{ setEvaluation(null);setPhase("job");setJobId("");setPersonas([]);setScenario(null);setMessages([]);setTotalCost(0);setTotalTokens({input:0,output:0});setTimeLeft(300);evalTriggered.current=false; },[]);
  const selectJob = useCallback(async(jid:string)=>{ setJobId(jid);setPhase("loading_personas");setPersonaError(""); try{const r=await fetch(`/api/personas?job=${jid}`);const d=await r.json();if(d.error){setPersonaError(d.error);setPhase("job");return;}setPersonas(d.personas);setPhase("scenario");}catch{setPersonaError("팀원 배정에 실패했습니다. 다시 시도해주세요.");setPhase("job");} },[]);

  const startScenario = useCallback((sc:Scenario)=>{
    setScenario(sc);setPhase("chat");setTimeLeft(300);setTimerActive(true);evalTriggered.current=false;setTotalCost(0);setTotalTokens({input:0,output:0});setEvaluation(null);setSessionStartedAt(new Date().toISOString());
    setMessages([{sender:"system",text:`[상황 브리핑]\n\n${sc.description}\n\n당신은 이 팀의 팀장입니다. 지금부터 5분간 팀원들과 이 문제에 대해 논의합니다.\n\n• 팀원들의 의견을 듣고 상황을 파악하세요.\n• 각자의 전문성을 활용해 해결 방향을 도출하세요.\n• 의견이 충돌하면 근거를 바탕으로 조율하세요.\n• 5분 안에 구체적인 다음 액션을 정하세요.`,ts:timeNow()}]);
  },[]);

  const sendMessage = useCallback(async()=>{
    if(!input.trim()||loading||!scenario||!timerActive)return;const text=input.trim();setInput("");setLoading(true);
    const userMsg:Msg={sender:"user",text,ts:timeNow()};const updated=[...messages,userMsg];
    setMessages([...updated,{sender:"loading",text:"",loading:true}]);
    try{const res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scenarioId:scenario.id,messages:updated,userMessage:text,personas,provider:selectedProvider})});
    const data=await res.json();
    if(data.error){setMessages([...updated,{sender:"system",text:data.error,ts:timeNow()}]);}
    else{const withTs=data.responses.map((r:any)=>({...r,ts:timeNow()}));setMessages([...updated,...withTs]);if(data.usage){setTotalCost(c=>c+(data.usage.totalCost||0));setTotalTokens(t=>({input:t.input+(data.usage.totalInputTokens||0),output:t.output+(data.usage.totalOutputTokens||0)}));}}
    }catch{setMessages([...updated,{sender:"system",text:"네트워크 오류",ts:timeNow()}]);}
    setLoading(false);setTimeout(()=>inputRef.current?.focus(),100);
  },[input,loading,messages,scenario,personas,selectedProvider,timerActive]);

  const triggerAutoEvaluation = useCallback(async()=>{
    if(!scenario)return;setPhase("evaluating");setMessages(p=>[...p,{sender:"system",text:"시간이 종료되었습니다. 대화 내용을 분석하고 있습니다.",ts:timeNow()}]);
    try{const res=await fetch("/api/evaluate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scenarioId:scenario.id,messages:messages.filter(m=>!m.loading),personas,provider:selectedProvider})});
    const data=await res.json();const evalText=data.evaluation||data.error||"평가 실패";setEvaluation(evalText);
    if(data.usage){setTotalCost(c=>c+(data.usage.cost||0));setTotalTokens(t=>({input:t.input+(data.usage.inputTokens||0),output:t.output+(data.usage.outputTokens||0)}));}
    await saveSession(evalText);}catch{setEvaluation("평가 요청 중 오류가 발생했습니다.");}setPhase("chat");
  },[messages,scenario,personas,selectedProvider,saveSession]);

  /* ══════ JOB SELECTION ══════ */
  if (phase==="job"||phase==="loading_personas") {
    return (
      <div style={{minHeight:"100vh",background:"#fff",display:"flex",flexDirection:"column"}}>
        {/* Nav */}
        <nav style={{borderBottom:"1px solid #e8e8e8",padding:"0 clamp(16px,4vw,48px)",height:56,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:28,height:28,borderRadius:6,background:"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700}}>S</div>
            <span style={{fontSize:"0.9375rem",fontWeight:700,color:"#1d1c1d"}}>SJT 시뮬레이션</span>
          </div>
          {providers.length>0&&(
            <div style={{display:"flex",gap:4}}>
              {providers.map(p=>(
                <button key={p.id} onClick={()=>setSelectedProvider(p.id)} style={{padding:"5px 12px",borderRadius:6,border:"1px solid "+(selectedProvider===p.id?"var(--blue)":"#e8e8e8"),background:selectedProvider===p.id?"#e8f0fe":"#fff",color:selectedProvider===p.id?"var(--blue)":"#616061",fontSize:"0.75rem",fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>{p.label}</button>
              ))}
            </div>
          )}
        </nav>
        {/* Content */}
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"clamp(20px,5vw,60px) clamp(16px,4vw,48px)"}}>
          <div style={{maxWidth:640,width:"100%",textAlign:"center"}}>
            <div style={{fontSize:"0.75rem",fontWeight:600,color:"var(--green)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Situational Judgement Test</div>
            <h1 style={{fontSize:"clamp(1.5rem,3.5vw,2.25rem)",fontWeight:800,color:"#1d1c1d",lineHeight:1.3,marginBottom:8}}>직무를 선택하세요</h1>
            <p style={{fontSize:"clamp(0.875rem,1.5vw,1rem)",color:"#616061",lineHeight:1.6,marginBottom:40}}>선택한 직무에 맞는 가상 팀원 3명이 배정됩니다.<br/>5분간 실제 업무 상황에서 의사결정 역량을 진단합니다.</p>
          </div>
          {personaError&&<div style={{background:"#fce4ec",border:"1px solid #f5c6cb",borderRadius:8,padding:"10px 16px",marginBottom:20,color:"var(--red)",fontSize:"0.8125rem",maxWidth:500}}>{personaError}</div>}
          {providers.length===0&&<div style={{background:"#fff3e0",border:"1px solid #ffe0b2",borderRadius:8,padding:"10px 16px",marginBottom:20,color:"#e65100",fontSize:"0.8125rem",maxWidth:500}}>API 키가 설정되지 않았습니다. .env.local 파일을 확인하세요.</div>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:12,maxWidth:560,width:"100%"}}>
            {JOB_CATEGORIES.map(j=>(
              <button key={j.id} onClick={()=>selectJob(j.id)} disabled={phase==="loading_personas"||providers.length===0}
                style={{padding:"20px 16px",borderRadius:10,border:"1px solid #e8e8e8",background:phase==="loading_personas"&&jobId===j.id?"#f0f0f0":"#fff",cursor:phase==="loading_personas"?"wait":providers.length===0?"not-allowed":"pointer",textAlign:"center",fontFamily:"inherit",transition:"all 0.15s",opacity:providers.length===0?0.5:1}}
                onMouseEnter={e=>{if(providers.length>0){e.currentTarget.style.borderColor="#1264a3";e.currentTarget.style.boxShadow="0 0 0 1px #1264a3";}}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#e8e8e8";e.currentTarget.style.boxShadow="none";}}>
                <div style={{fontSize:28,marginBottom:8}}>{j.icon}</div>
                <div style={{fontSize:"0.875rem",fontWeight:700,color:"#1d1c1d"}}>{j.label}</div>
                {phase==="loading_personas"&&jobId===j.id&&<div style={{fontSize:"0.6875rem",color:"var(--blue)",marginTop:6}}>팀원 배정중...</div>}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ══════ SCENARIO SELECTION ══════ */
  if (phase==="scenario") {
    const jobLabel=JOB_CATEGORIES.find(j=>j.id===jobId)?.label||"";
    const scenarios=getScenariosForJob(jobId);
    return (
      <div style={{minHeight:"100vh",background:"#fff",display:"flex",flexDirection:"column"}}>
        <nav style={{borderBottom:"1px solid #e8e8e8",padding:"0 clamp(16px,4vw,48px)",height:56,display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>setPhase("job")} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:"#616061"}}>←</button>
          <div style={{width:28,height:28,borderRadius:6,background:"var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700}}>S</div>
          <span style={{fontSize:"0.9375rem",fontWeight:700,color:"#1d1c1d"}}>SJT 시뮬레이션</span>
          <span style={{fontSize:"0.75rem",color:"#616061",background:"#f0f0f0",padding:"2px 8px",borderRadius:4}}>{jobLabel}</span>
        </nav>
        <div style={{flex:1,padding:"clamp(20px,4vw,48px) clamp(16px,4vw,48px)",maxWidth:960,margin:"0 auto",width:"100%"}}>
          {/* Team */}
          <div style={{marginBottom:32}}>
            <h3 style={{fontSize:"0.8125rem",fontWeight:600,color:"#616061",marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>배정된 팀원</h3>
            <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {personas.map(p=>(
                <div key={p.id} style={{flex:"1 1 240px",maxWidth:320,border:"1px solid #e8e8e8",borderRadius:10,padding:16}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                    <div style={{width:36,height:36,borderRadius:6,background:getAvatarBg(p.name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:"0.875rem",fontWeight:700}}>{p.name.charAt(0)}</div>
                    <div>
                      <div style={{fontSize:"0.9375rem",fontWeight:700,color:"#1d1c1d"}}>{p.name}</div>
                      <div style={{fontSize:"0.75rem",color:"#616061"}}>{p.role} · {p.age}세</div>
                    </div>
                  </div>
                  <div style={{fontSize:"0.75rem",color:"#616061",lineHeight:1.5}}>{(p.skills_and_expertise||"").slice(0,250)}{(p.skills_and_expertise||"").length>250?"...":""}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Scenarios */}
          <h3 style={{fontSize:"0.8125rem",fontWeight:600,color:"#616061",marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>시나리오 선택</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))",gap:12}}>
            {scenarios.map(sc=>(
              <button key={sc.id} onClick={()=>startScenario(sc)} style={{padding:20,borderRadius:10,border:"1px solid #e8e8e8",background:"#fff",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all 0.15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="#1264a3";e.currentTarget.style.boxShadow="0 0 0 1px #1264a3";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#e8e8e8";e.currentTarget.style.boxShadow="none";}}>
                <div style={{fontSize:24,marginBottom:8}}>{sc.icon}</div>
                <div style={{fontSize:"0.9375rem",fontWeight:700,color:"#1d1c1d",marginBottom:6}}>{sc.title}</div>
                <div style={{fontSize:"0.8125rem",color:"#616061",lineHeight:1.5}}>{sc.description}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ══════ CHAT — Slack Layout ══════ */
  const timerDone=timeLeft<=0;
  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"#fff"}}>
      {/* Slack-style header */}
      <div style={{borderBottom:"1px solid #e8e8e8",padding:"0 20px",height:50,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={()=>{setTimerActive(false);setPhase("scenario");}} style={{background:"none",border:"none",fontSize:16,cursor:"pointer",color:"#616061"}}>←</button>
          <div>
            <div style={{fontSize:"0.9375rem",fontWeight:700,color:"#1d1c1d",display:"flex",alignItems:"center",gap:6}}>
              <span style={{color:"#616061",fontWeight:400}}>#</span> {scenario?.title}
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {/* Members */}
          <div style={{display:"flex",marginRight:4}}>
            {personas.map((p,i)=>(
              <div key={p.id} title={p.name} style={{width:24,height:24,borderRadius:5,background:getAvatarBg(p.name),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:10,fontWeight:700,marginLeft:i>0?-6:0,border:"2px solid #fff",position:"relative",zIndex:3-i}}>{p.name.charAt(0)}</div>
            ))}
          </div>
          <span style={{fontSize:"0.75rem",color:"#999"}}>{personas.length+1}</span>
          <div style={{width:1,height:20,background:"#e8e8e8"}}/>
          <Timer seconds={timeLeft}/>
          {totalCost>0&&<span style={{fontSize:"0.6875rem",color:"#999",fontFamily:"'JetBrains Mono',monospace"}}>${totalCost.toFixed(4)}</span>}
        </div>
      </div>

      {/* Scenario banner */}
      <div style={{borderBottom:"1px solid #e8e8e8",padding:"10px 20px",background:"#fafbfc",flexShrink:0}}>
        <div style={{fontSize:"0.75rem",color:"#616061",lineHeight:1.5}}>
          <strong>{scenario?.icon} {scenario?.title}</strong> — {scenario?.description?.slice(0,120)}{(scenario?.description?.length||0)>120?"...":""}
        </div>
      </div>

      {/* Messages */}
      <div style={{flex:1,overflow:"auto",paddingTop:8,paddingBottom:8}}>
        {messages.map((msg,i)=>{
          const prev=i>0?messages[i-1]:null;
          const isConsecutive=!!prev&&prev.sender===msg.sender&&!prev.loading&&prev.sender!=="system";
          return <SlackMessage key={i} msg={msg} personas={personas} isConsecutive={isConsecutive}/>;
        })}
        <div ref={chatEndRef}/>
      </div>

      {/* Input — Slack style */}
      <div style={{padding:"0 20px 16px",flexShrink:0}}>
        {timerDone&&!evaluation ? (
          <div style={{textAlign:"center",padding:12,color:"#616061",fontSize:"0.875rem",background:"#f8f8f8",borderRadius:8}}>
            {phase==="evaluating"?"분석 중...":"시간 종료 — 잠시 후 평가 결과가 표시됩니다."}
          </div>
        ) : (
          <div style={{border:"1px solid #ccc",borderRadius:8,overflow:"hidden",background:"#fff",transition:"border-color 0.15s"}}
            onFocus={e=>e.currentTarget.style.borderColor="#1264a3"}
            onBlur={e=>e.currentTarget.style.borderColor="#ccc"}>
            <div style={{display:"flex",alignItems:"center"}}>
              <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}}
                placeholder={loading?"팀원들이 응답 중...":timerDone?"시간 종료":"# "+( scenario?.title||"")+"에 메시지 보내기"}
                disabled={loading||timerDone}
                style={{flex:1,padding:"10px 14px",border:"none",outline:"none",fontSize:"0.875rem",fontFamily:"inherit",background:"transparent"}}/>
              <button onClick={sendMessage} disabled={!input.trim()||loading||timerDone}
                style={{margin:"4px 6px",padding:"6px 14px",borderRadius:6,border:"none",background:input.trim()&&!loading&&!timerDone?"#007a5a":"#e8e8e8",color:input.trim()&&!loading&&!timerDone?"#fff":"#999",fontSize:"0.8125rem",fontWeight:600,cursor:input.trim()&&!loading&&!timerDone?"pointer":"default",fontFamily:"inherit",transition:"background 0.15s"}}>전송</button>
            </div>
          </div>
        )}
      </div>

      {evaluation&&<EvalModal text={evaluation} onClose={closeEvalAndReset}/>}
    </div>
  );
}
