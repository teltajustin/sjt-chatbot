"use client";
import { useState, useRef, useEffect, useCallback, type ChangeEvent } from "react";
import { JOB_CATEGORIES } from "@/lib/jobs";
import { getScenariosForJob, Scenario } from "@/lib/scenarios";

interface Persona { id:string;name:string;role:string;age:number;sex:string;avatar:string;color:string;bgLight:string;persona:string;professional_persona:string;cultural_background:string;skills_and_expertise:string;career_goals_and_ambitions:string;family_persona:string;occupation:string;district:string;province:string;education_level:string;marital_status:string;personality_traits:string;speech_style:string; }
interface Msg { sender:string;text:string;loading?:boolean;ts?:string;typingName?:string; }
interface ProviderInfo { id:string;label:string;model:string; }

const AVATAR_COLORS=["#007a5a","#4a154b","#1264a3","#e01e5a","#ecb22e"];
const CHAT_DURATION_SECONDS=600;
function getAvatarBg(n:string){let h=0;for(let i=0;i<n.length;i++)h=n.charCodeAt(i)+((h<<5)-h);return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length];}
function timeNow(){return new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false});}
function getPersona(personas:Persona[],id:string){return personas.find(x=>x.id===id)||null;}
function getTypingName(personas:Persona[],id:string){return getPersona(personas,id)?.name||"담당 직원";}
function normalizeMention(text:string){return (text||"").toLowerCase().replace(/[\s.,!?~·ㆍ:;()\[\]{}"'“”‘’\-_/]/g,"");}
function detectLocalMention(text:string, personas:Persona[]){
  const normalized=normalizeMention(text);
  for(const p of personas){
    const full=p.name||"";
    const given=full.length>=2?full.slice(1):full;
    const aliases=[full,full+"님",full+"씨",full+"에게",full+"한테",given+"님",given+"씨",given+"에게",given+"한테",p.role].filter(Boolean).map(a=>normalizeMention(String(a)));
    if(aliases.some(a=>a.length>=2&&normalized.includes(a))) return p.id;
  }
  return "";
}

function renderMentionText(text:string,personas:Persona[]){
  // 직원 멘션은 반드시 사용자가 보낸 텍스트 또는 에이전트 응답 안에
  // 명시적으로 존재하는 "@직원이름"만 UI 멘션으로 렌더링한다.
  // 이름이 일반 단어 안에 포함된 경우(예: 작성하시는, 완성하고)는 절대 멘션으로 변환하지 않는다.
  const names=personas.map(p=>p.name).filter(Boolean).sort((a,b)=>b.length-a.length);
  if(names.length===0)return text;
  const escaped=names.map(x=>x.replace(/[.*+?^\x24{}()|[\]\\]/g,"\\$&"));
  const pattern=new RegExp(`(@(?:${escaped.join("|")}))(?=\s|[,，.?!?:;]|$)`,"g");
  const parts=text.split(pattern);
  return parts.map((part,i)=>{
    const clean=part.replace(/^@/,"").trim();
    const found=names.find(name=>name===clean);
    if(found){
      return <span key={i} className="mention-pill">@{found}</span>;
    }
    return <span key={i}>{part}</span>;
  });
}


function SlackMessage({msg,personas,isConsecutive}:{msg:Msg;personas:Persona[];isConsecutive:boolean}){
  const isUser=msg.sender==="user";const isSystem=msg.sender==="system";
  const p=!isUser&&!isSystem?personas.find(x=>x.id===msg.sender):null;
  const name=isUser?"나 (팀장)":p?.name||"시스템";
  const color=isUser?"#1264a3":p?getAvatarBg(p.name):"#999";
  const avatar=isUser?"팀":p?.avatar||name.charAt(0);

  if(isSystem)return(
    <div className="slide-up" style={{padding:"4px 20px",margin:"4px 0"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0"}}>
        <div style={{height:1,flex:1,background:"#e8e8e8"}}/><span style={{fontSize:"0.75rem",color:"#616061",whiteSpace:"nowrap",fontWeight:500}}>{msg.text.length>60?"📋 시나리오 안내":msg.text}</span><div style={{height:1,flex:1,background:"#e8e8e8"}}/>
      </div>
      {msg.text.length>60&&<div style={{background:"#fff9e6",border:"1px solid #f0e4c4",borderRadius:8,padding:"12px 16px",fontSize:"0.8125rem",color:"#1d1c1d",lineHeight:1.6,whiteSpace:"pre-wrap",marginTop:4}}>{msg.text}</div>}
    </div>);

  if(msg.loading){
    const typingPersona=getPersona(personas,msg.sender);
    const typingName=msg.typingName||typingPersona?.name||"담당 직원";
    const typingAvatar=typingPersona?.avatar||"…";
    const typingColor=typingPersona?getAvatarBg(typingPersona.name):"#999";
    return(<div className="fade-in" style={{padding:"7px 20px",display:"flex",gap:10,alignItems:"flex-start"}}>
      <div style={{width:36,height:36,borderRadius:8,background:typingColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{typingAvatar}</div>
      <div style={{paddingTop:2}}>
        <div style={{fontSize:"0.75rem",color:"#616061",marginBottom:2}}>{typingName} 님이 입력 중…</div>
        <div className="dots" style={{color:"#999",fontSize:18,lineHeight:1}}><span>·</span><span>·</span><span>·</span></div>
      </div>
    </div>);
  }

  return(
    <div className="slide-up" style={{padding:isConsecutive?"2px 20px":"8px 20px 2px",display:"flex",gap:10,borderRadius:4,transition:"background 0.1s"}}
      onMouseEnter={e=>e.currentTarget.style.background="#f8f8f8"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      {!isConsecutive?(<div style={{width:36,height:36,borderRadius:8,background:color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:isUser?"0.8125rem":20,fontWeight:700,flexShrink:0,color:isUser?"#fff":"inherit",boxShadow:"0 1px 2px rgba(0,0,0,0.08)"}}>{avatar}</div>):(<div style={{width:36,flexShrink:0}}/>)}
      <div style={{flex:1,minWidth:0}}>
        {!isConsecutive&&(<div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:2}}><span style={{fontSize:"0.9375rem",fontWeight:700,color:"#1d1c1d"}}>{name}</span>{p&&<span style={{fontSize:"0.6875rem",color:"#616061"}}>{p.role}</span>}<span style={{fontSize:"0.6875rem",color:"#999"}}>{msg.ts||timeNow()}</span></div>)}
        <div style={{fontSize:"0.9375rem",color:"#1d1c1d",lineHeight:1.6,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>{renderMentionText(msg.text,personas)}</div>
        {isConsecutive&&<div style={{fontSize:"0.625rem",color:"#aaa",marginTop:1}}>{msg.ts||timeNow()}</div>}
      </div>
    </div>);
}

function Timer({seconds}:{seconds:number}){const m=Math.floor(seconds/60);const s=seconds%60;const warn=seconds<=60&&seconds>0;return(<div className={warn?"timer-blink":""} style={{fontFamily:"'JetBrains Mono',monospace",fontSize:"0.8125rem",fontWeight:500,color:warn?"#e01e5a":"#1d1c1d",background:warn?"#fce4ec":"#f0f0f0",padding:"4px 10px",borderRadius:6}}>{m}:{s.toString().padStart(2,"0")}</div>);}

function EvalModal({text,onClose}:{text:string;onClose:()=>void}){
  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:"clamp(12px,3vw,24px)"}} onClick={onClose}>
      <div style={{background:"#fff",borderRadius:12,maxWidth:640,width:"100%",maxHeight:"85vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"20px 24px",borderBottom:"1px solid #e8e8e8",display:"flex",justifyContent:"space-between",alignItems:"center"}}><h2 style={{fontSize:"1.125rem",fontWeight:700}}>역량 평가 결과</h2><button onClick={onClose} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:"#999"}}>✕</button></div>
        <div style={{padding:"20px 24px",whiteSpace:"pre-wrap",fontSize:"0.875rem",lineHeight:1.8,color:"#1d1c1d"}}>{text}</div>
        <div style={{padding:"16px 24px",borderTop:"1px solid #e8e8e8",display:"flex",justifyContent:"flex-end"}}><button onClick={onClose} style={{background:"#007a5a",color:"#fff",border:"none",borderRadius:6,padding:"8px 20px",fontSize:"0.875rem",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>확인</button></div>
      </div>
    </div>);
}

function compactText(text:string, max:number){
  const clean=(text||"").replace(/\s+/g," ").trim();
  if(clean.length<=max) return clean;
  return clean.slice(0,max).replace(/[\s.,!?·ㆍ:;\-_/]+$/g,"")+"…";
}

function PersonaCard({p}:{p:Persona}){
  const color=getAvatarBg(p.name);
  return(<div style={{background:"#fff",border:"1px solid #e8e8e8",borderRadius:12,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
    <div style={{background:p.bgLight||"#f8f8f8",padding:"18px",borderBottom:"1px solid #eee"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:56,height:56,borderRadius:14,background:color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,boxShadow:"0 2px 4px rgba(0,0,0,0.08)"}}>{p.avatar}</div>
        <div><div style={{fontSize:"1rem",fontWeight:800,color:"#1d1c1d"}}>{p.name}</div><div style={{fontSize:"0.8125rem",fontWeight:600,color:color,marginTop:2}}>{p.role}</div></div>
      </div>
    </div>
    <div style={{padding:16}}>
      <div><div style={{fontSize:"0.6875rem",fontWeight:700,color:"#616061",marginBottom:4}}>주요 전문성</div><div style={{fontSize:"0.8125rem",color:"#616061",lineHeight:1.55}}>{compactText(p.skills_and_expertise||"담당 업무 기반 실무 판단",180)}</div></div>
    </div>
  </div>);
}

export default function Home(){
  const[phase,setPhase]=useState<"job"|"loading_personas"|"scenario"|"chat"|"evaluating">("job");
  const[jobId,setJobId]=useState("");const[personas,setPersonas]=useState<Persona[]>([]);const[scenario,setScenario]=useState<Scenario|null>(null);
  const[messages,setMessages]=useState<Msg[]>([]);const[input,setInput]=useState("");const[loading,setLoading]=useState(false);
  const[timeLeft,setTimeLeft]=useState(CHAT_DURATION_SECONDS);const[timerActive,setTimerActive]=useState(false);const[evaluation,setEvaluation]=useState<string|null>(null);
  const[totalCost,setTotalCost]=useState(0);const[totalTokens,setTotalTokens]=useState({input:0,output:0});const[sessionStartedAt,setSessionStartedAt]=useState<string|null>(null);
  const[providers,setProviders]=useState<ProviderInfo[]>([]);const[selectedProvider,setSelectedProvider]=useState("");const[personaError,setPersonaError]=useState("");const[inputFocused,setInputFocused]=useState(false);
  const chatEndRef=useRef<HTMLDivElement>(null);const inputRef=useRef<HTMLTextAreaElement>(null);const evalTriggered=useRef(false);const responseTimersRef=useRef<ReturnType<typeof setTimeout>[]>([]);
  const timerDone=timeLeft<=0;

  useEffect(()=>{fetch("/api/providers").then(r=>r.json()).then(d=>{setProviders(d.providers||[]);setSelectedProvider(d.defaultProvider||d.providers?.[0]?.id||"");});},[]);
  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);
  useEffect(()=>{if(!timerActive||timerDone)return;const t=setInterval(()=>setTimeLeft(s=>s<=1?0:s-1),1000);return()=>clearInterval(t);},[timerActive,timerDone]);

  const focusInput=useCallback(()=>setTimeout(()=>inputRef.current?.focus(),0),[]);
  const closeEvalAndReset=useCallback(()=>{setEvaluation(null);setPhase("job");setJobId("");setPersonas([]);setScenario(null);setMessages([]);setTotalCost(0);setTotalTokens({input:0,output:0});setTimeLeft(CHAT_DURATION_SECONDS);setTimerActive(false);evalTriggered.current=false;responseTimersRef.current.forEach(clearTimeout);responseTimersRef.current=[];},[]);

  const startScenario=useCallback((sc:Scenario)=>{responseTimersRef.current.forEach(clearTimeout);responseTimersRef.current=[];setScenario(sc);setPhase("chat");setTimeLeft(CHAT_DURATION_SECONDS);setTimerActive(false);evalTriggered.current=false;setTotalCost(0);setTotalTokens({input:0,output:0});setEvaluation(null);setSessionStartedAt(new Date().toISOString());setMessages([{sender:"system",text:`[상황 브리핑]\n\n${sc.description}\n\n당신은 이 팀의 팀장입니다. 첫 메시지를 보내면 10분 타이머가 시작됩니다.\n\n• 팀원마다 알고 있는 정보와 담당 업무가 다릅니다.\n• 각자의 의견, 일정, 우려를 확인하며 상황을 파악하세요.\n• 직원이 되묻거나 난색을 보이면 근거를 바탕으로 조율하세요.\n• 10분 안에 담당자, 기한, 우선순위, 리스크 관리 방식을 구체화하세요.`,ts:timeNow()}]);},[]);

  const selectJob=async(id:string)=>{if(!selectedProvider)return;setJobId(id);setPhase("loading_personas");setPersonaError("");try{const res=await fetch("/api/personas",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobId:id,provider:selectedProvider})});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data?.error||"페르소나 생성 실패");setPersonas(data.personas||[]);setPhase("scenario");}catch(e:any){setPersonaError(e.message||"팀원 배정 중 오류가 발생했습니다.");setPhase("job");}};

  const sendMessage=useCallback(async()=>{
    if(!input.trim()||!scenario||loading||timerDone)return;
    if(!timerActive&&timeLeft===CHAT_DURATION_SECONDS){setTimerActive(true);setSessionStartedAt(new Date().toISOString());}
    responseTimersRef.current.forEach(clearTimeout);responseTimersRef.current=[];
    const userMsg:Msg={sender:"user",text:input.trim(),ts:timeNow()};
    const updated=[...messages.filter(m=>!m.loading),userMsg];

    // 사용자가 특정 직원을 지칭했더라도 즉시 typing indicator를 띄우지 않는다.
    // 실제 업무 메신저처럼 API 응답 이후 직원별 발송 예정 시점에 맞춰 typing → 메시지 순서로 표시한다.
    setMessages(updated);setInput("");setLoading(true);
    if(inputRef.current)inputRef.current.style.height="auto";
    try{
      const res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scenarioId:scenario.id,messages:updated,userMessage:userMsg.text,personas,provider:selectedProvider})});
      if(!res.ok)throw new Error("chat error");
      const data=await res.json();
      if(data.usage){setTotalCost(c=>c+(data.usage.totalCost||0));setTotalTokens(t=>({input:t.input+(data.usage.totalInputTokens||0),output:t.output+(data.usage.totalOutputTokens||0)}));}
      const responses=(data.responses||[]) as {sender:string;text:string;delayMs?:number}[];
      if(responses.length===0){setMessages(updated);setLoading(false);focusInput();return;}

      responses.forEach((r,idx)=>{
        const elapsed=responses.slice(0,idx+1).reduce((sum,x)=>sum+(x.delayMs||0),0);
        const typingLead=Math.min(1400,Math.max(700,Math.floor((r.delayMs||1800)*0.45)));
        const typingAt=Math.max(500,elapsed-typingLead);

        const typingTimer=setTimeout(()=>{
          setMessages(prev=>{
            const withoutTyping=prev.filter(m=>!m.loading);
            return [...withoutTyping,{sender:r.sender,text:"",loading:true,typingName:getTypingName(personas,r.sender)}];
          });
        },typingAt);

        const messageTimer=setTimeout(()=>{
          setMessages(prev=>{
            const withoutTyping=prev.filter(m=>!m.loading);
            const next:Msg={sender:r.sender,text:r.text,ts:timeNow()};
            return [...withoutTyping,next];
          });
          if(idx===responses.length-1){setLoading(false);focusInput();}
        },elapsed);

        responseTimersRef.current.push(typingTimer,messageTimer);
      });
    }
    catch{
      setMessages([...updated,{sender:"system",text:"네트워크 오류가 발생했습니다.",ts:timeNow()}]);
      setLoading(false);
      focusInput();
    }
  },[input,loading,messages,scenario,personas,selectedProvider,timerActive,timeLeft,timerDone,focusInput]);


  const saveSession=useCallback(async(evalText?:string)=>{
    if(!scenario||messages.filter(m=>!m.loading).length<2)return;
    try{
      await fetch("/api/sessions",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          startedAt:sessionStartedAt,
          endedAt:new Date().toISOString(),
          jobId,
          jobLabel:JOB_CATEGORIES.find(j=>j.id===jobId)?.label||"",
          scenarioId:scenario.id,
          scenarioTitle:scenario.title,
          provider:selectedProvider,
          personas,
          messages:messages.filter(m=>!m.loading),
          evaluation:evalText,
          totalCost,
          totalTokens
        })
      });
    }catch(e){
      console.error(e);
    }
  },[sessionStartedAt,jobId,scenario,selectedProvider,personas,messages,totalCost,totalTokens]);

  const doEvaluation=useCallback(async()=>{
    if(!scenario)return;
    setPhase("evaluating");
    setMessages(p=>[...p.filter(m=>!m.loading),{sender:"system",text:"시간이 종료되었습니다. 대화 내용을 분석하고 있습니다.",ts:timeNow()}]);
    try{
      const cleanMessages=messages.filter(m=>!m.loading);
      const res=await fetch("/api/evaluate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scenarioId:scenario.id,messages:cleanMessages,personas,provider:selectedProvider})});
      const data=await res.json();
      const evalText=data.evaluation||"평가 실패";
      setEvaluation(evalText);
      if(data.usage){
        setTotalCost(c=>c+(data.usage.totalCost||data.usage.cost||0));
        setTotalTokens(t=>({
          input:t.input+(data.usage.totalInputTokens||data.usage.inputTokens||0),
          output:t.output+(data.usage.totalOutputTokens||data.usage.outputTokens||0)
        }));
      }
      await saveSession(evalText);
    }catch{
      const failText="평가 요청 중 오류가 발생했습니다.";
      setEvaluation(failText);
      await saveSession(failText);
    }
    setPhase("chat");
  },[messages,scenario,personas,selectedProvider,saveSession]);

  useEffect(()=>{
    if(timerDone&&!evalTriggered.current&&messages.length>1){
      evalTriggered.current=true;
      setLoading(false);
      responseTimersRef.current.forEach(clearTimeout);
      responseTimersRef.current=[];
      setTimerActive(false);
      doEvaluation();
    }
  },[timerDone,messages.length,doEvaluation]);

  const handleTextareaInput=(e:ChangeEvent<HTMLTextAreaElement>)=>{setInput(e.target.value);e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,120)+"px";};

  if(phase==="job"||phase==="loading_personas"){
    return(<div style={{minHeight:"100vh",background:"#fff",display:"flex",flexDirection:"column"}}>
      <nav style={{borderBottom:"1px solid #e8e8e8",padding:"0 clamp(16px,4vw,48px)",height:56,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:28,height:28,borderRadius:6,background:"#4a154b",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700}}>S</div><span style={{fontSize:"0.9375rem",fontWeight:700,color:"#1d1c1d"}}>SJT 시뮬레이션</span></div>
        {providers.length>0&&(<div style={{display:"flex",gap:4}}>{providers.map(p=>(<button key={p.id} onClick={()=>setSelectedProvider(p.id)} style={{padding:"5px 12px",borderRadius:6,border:"1px solid "+(selectedProvider===p.id?"#1264a3":"#e8e8e8"),background:selectedProvider===p.id?"#e8f0fe":"#fff",color:selectedProvider===p.id?"#1264a3":"#616061",fontSize:"0.75rem",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{p.label}</button>))}</div>)}
      </nav>
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"clamp(20px,5vw,60px) clamp(16px,4vw,48px)"}}>
        <div style={{maxWidth:640,width:"100%",textAlign:"center"}}>
          <div style={{fontSize:"0.75rem",fontWeight:600,color:"#007a5a",letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Situational Judgement Test</div>
          <h1 style={{fontSize:"clamp(1.5rem,3.5vw,2.25rem)",fontWeight:800,color:"#1d1c1d",lineHeight:1.3,marginBottom:8}}>직무를 선택하세요</h1>
          <p style={{fontSize:"clamp(0.875rem,1.5vw,1rem)",color:"#616061",lineHeight:1.6,marginBottom:40}}>선택한 직무에 맞는 가상 팀원 3명이 배정됩니다.<br/>10분간 실제 업무 메신저 환경에서 의사결정 역량을 진단합니다.</p>
        </div>
        {personaError&&<div style={{background:"#fce4ec",border:"1px solid #f5c6cb",borderRadius:8,padding:"10px 16px",marginBottom:20,color:"#e01e5a",fontSize:"0.8125rem",maxWidth:500}}>{personaError}</div>}
        {providers.length===0&&<div style={{background:"#fff3e0",border:"1px solid #ffe0b2",borderRadius:8,padding:"10px 16px",marginBottom:20,color:"#e65100",fontSize:"0.8125rem",maxWidth:500}}>API 키가 설정되지 않았습니다.</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,maxWidth:560,width:"100%"}}>
          {JOB_CATEGORIES.map(j=>(<button key={j.id} onClick={()=>selectJob(j.id)} disabled={phase==="loading_personas"||providers.length===0} style={{padding:"20px 16px",borderRadius:10,border:"1px solid #e8e8e8",background:phase==="loading_personas"&&jobId===j.id?"#f0f0f0":"#fff",cursor:phase==="loading_personas"?"wait":providers.length===0?"not-allowed":"pointer",textAlign:"center",fontFamily:"inherit",transition:"all 0.15s",opacity:providers.length===0?0.5:1}} onMouseEnter={e=>{if(providers.length>0){e.currentTarget.style.borderColor="#1264a3";e.currentTarget.style.boxShadow="0 0 0 1px #1264a3";}}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#e8e8e8";e.currentTarget.style.boxShadow="none";}}>
            <div style={{fontSize:28,marginBottom:8}}>{j.icon}</div><div style={{fontSize:"0.875rem",fontWeight:700,color:"#1d1c1d"}}>{j.label}</div>
            {phase==="loading_personas"&&jobId===j.id&&<div style={{fontSize:"0.6875rem",color:"#1264a3",marginTop:6}}>팀원 배정중...</div>}
          </button>))}
        </div>
      </div>
    </div>);
  }

  if(phase==="scenario"){
    const jobLabel=JOB_CATEGORIES.find(j=>j.id===jobId)?.label||"";
    const scenarios=getScenariosForJob(jobId);
    return(<div style={{minHeight:"100vh",background:"#fafbfc",display:"flex",flexDirection:"column"}}>
      <nav style={{borderBottom:"1px solid #e8e8e8",padding:"0 clamp(16px,4vw,48px)",height:56,display:"flex",alignItems:"center",gap:12,background:"#fff"}}>
        <button onClick={()=>setPhase("job")} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:"#616061"}}>←</button>
        <div style={{width:28,height:28,borderRadius:6,background:"#4a154b",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700}}>S</div>
        <span style={{fontSize:"0.9375rem",fontWeight:700,color:"#1d1c1d"}}>SJT 시뮬레이션</span>
        <span style={{fontSize:"0.75rem",color:"#616061",background:"#f0f0f0",padding:"2px 8px",borderRadius:4}}>{jobLabel}</span>
      </nav>
      <div style={{flex:1,padding:"clamp(20px,3vw,40px) clamp(16px,4vw,48px)",maxWidth:1100,margin:"0 auto",width:"100%"}}>
        <div style={{marginBottom:40}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}><h2 style={{fontSize:"1.125rem",fontWeight:700,color:"#1d1c1d"}}>배정된 팀원</h2><span style={{fontSize:"0.75rem",color:"#616061",background:"#f0f0f0",padding:"2px 8px",borderRadius:10}}>{personas.length}명</span></div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>{personas.map(p=><PersonaCard key={p.id} p={p}/>)}</div>
        </div>
        <div><h2 style={{fontSize:"1.125rem",fontWeight:700,color:"#1d1c1d",marginBottom:16}}>시나리오 선택</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:14}}>{scenarios.map(sc=>(<button key={sc.id} onClick={()=>startScenario(sc)} style={{background:"#fff",border:"1px solid #e8e8e8",borderRadius:12,padding:20,textAlign:"left",cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#1264a3";e.currentTarget.style.boxShadow="0 4px 12px rgba(18,100,163,0.12)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#e8e8e8";e.currentTarget.style.boxShadow="none";}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><span style={{fontSize:20}}>{sc.icon}</span><div style={{fontSize:"1rem",fontWeight:700,color:"#1d1c1d"}}>{sc.title}</div></div><div style={{fontSize:"0.8125rem",color:"#616061",lineHeight:1.6}}>{compactText(sc.description,150)}</div>
          </button>))}</div>
        </div>
      </div>
    </div>);
  }

  const visibleMessages=messages.filter(m=>m.sender!=="loading"||m.loading);
  return(<div style={{height:"100vh",display:"flex",flexDirection:"column",background:"#fff"}}>
    <nav style={{height:50,borderBottom:"1px solid #e8e8e8",padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{fontSize:18}}>#</div><div><div style={{fontSize:"0.9375rem",fontWeight:700,color:"#1d1c1d"}}>{scenario?.title}</div><div style={{fontSize:"0.6875rem",color:"#616061"}}>{personas.length}명 · 업무 시뮬레이션</div></div></div>
      <div style={{display:"flex",alignItems:"center",gap:12}}><Timer seconds={timeLeft}/><div style={{fontSize:"0.75rem",color:"#999"}}>{selectedProvider}</div><button onClick={()=>{saveSession();closeEvalAndReset();}} style={{padding:"6px 12px",borderRadius:6,border:"1px solid #e8e8e8",background:"#fff",fontSize:"0.75rem",cursor:"pointer",fontFamily:"inherit"}}>종료</button></div>
    </nav>
    <div style={{flex:1,overflowY:"auto",paddingTop:8}}>
      {visibleMessages.map((m,i)=>{const prev=visibleMessages[i-1];const consecutive=!!prev&&!m.loading&&!prev.loading&&prev.sender===m.sender&&m.sender!=="user"&&m.sender!=="system";return <SlackMessage key={i} msg={m} personas={personas} isConsecutive={consecutive}/>;})}
      <div ref={chatEndRef}/>
    </div>
    <div style={{padding:"0 20px 16px",flexShrink:0}}>
      {timerDone&&!evaluation?(<div style={{textAlign:"center",padding:14,color:"#616061",fontSize:"0.875rem",background:"#f8f8f8",borderRadius:8}}>{phase==="evaluating"?"분석 중...":"시간 종료 — 잠시 후 평가 결과가 표시됩니다."}</div>):(
        <div style={{border:`1px solid ${inputFocused?"#1264a3":"#ccc"}`,borderRadius:10,overflow:"hidden",background:"#fff",transition:"border-color 0.15s",boxShadow:inputFocused?"0 0 0 1px #1264a3":"none"}}>
          <div style={{display:"flex",alignItems:"center",gap:2,padding:"6px 12px",borderBottom:"1px solid #f0f0f0"}}>{["B","I","U","S","🔗","⊞","⊟","☰","</>"].map((t,i)=>(<div key={i} style={{width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:4,fontSize:t.length>1?14:13,color:"#bbb",fontWeight:t==="B"?700:400,fontStyle:t==="I"?"italic":"normal",textDecoration:t==="U"?"underline":t==="S"?"line-through":"none"}}>{t}</div>))}</div>
          <textarea ref={inputRef} value={input} onChange={handleTextareaInput} onFocus={()=>setInputFocused(true)} onBlur={()=>setInputFocused(false)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!loading&&!timerDone){e.preventDefault();sendMessage();}}}
            placeholder={timerDone?"시간 종료":loading?"":!timerActive?`첫 메시지를 보내면 10분 타이머가 시작됩니다`:`# ${scenario?.title||""}에 메시지 보내기`}
            disabled={timerDone} rows={1} style={{width:"100%",padding:"10px 14px",border:"none",outline:"none",fontSize:"0.9375rem",fontFamily:"inherit",background:"transparent",resize:"none",lineHeight:1.5,minHeight:44,maxHeight:120}}/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 12px"}}>
            <div style={{display:"flex",gap:2}}>{["+","Aa","😊","@","📎","🎙"].map((t,i)=>(<div key={i} style={{width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:4,fontSize:14,color:"#bbb"}}>{t}</div>))}</div>
            <button onClick={sendMessage} disabled={!input.trim()||loading||timerDone} style={{padding:"6px 12px",borderRadius:6,border:"none",background:input.trim()&&!loading&&!timerDone?"#007a5a":"#e8e8e8",color:input.trim()&&!loading&&!timerDone?"#fff":"#999",fontSize:"0.875rem",fontWeight:600,cursor:input.trim()&&!loading&&!timerDone?"pointer":"default",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:16}}>▶</span></button>
          </div>
        </div>)}
    </div>
    {evaluation&&<EvalModal text={evaluation} onClose={closeEvalAndReset}/>} 
  </div>);
}
