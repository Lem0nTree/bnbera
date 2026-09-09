"use client";
import { useEffect, useRef, useState } from "react";

export function DirectoryActions({slug,name}:{readonly slug:string;readonly name:string}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [copied,setCopied]=useState(false);
  const [question,setQuestion]=useState("What can this agent do, and what should I check before using it?");
  const [answer,setAnswer]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [shareError,setShareError]=useState<string|null>(null);
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),3000);return()=>clearTimeout(timer);},[copied]);
  return <div className="directory-actions"><button className="button button--primary" onClick={()=>dialog.current?.showModal()}><span aria-hidden="true">✦</span> Ask AI</button><button className="button" onClick={async()=>{setShareError(null);try{await navigator.clipboard.writeText(`${window.location.origin}/agents/${slug}`);setCopied(true);}catch{setShareError("Copy the page address from your browser to share this agent.");}}}>{copied?"Link copied ✓":"Share ↗"}</button>
    <dialog ref={dialog} className="directory-ai-dialog" aria-labelledby="directory-ai-title"><div className="directory-ai-heading"><span className="eyebrow">BNBEra assistant</span><button className="button button--icon" aria-label="Close agent assistant" onClick={()=>dialog.current?.close()}>×</button></div><h2 id="directory-ai-title">Get to know {name}</h2><p>Ask about this agent’s published profile and evidence. The assistant cannot invoke agents or access your wallet.</p><form onSubmit={async event=>{event.preventDefault();setBusy(true);setError(null);setAnswer(null);try{const result=await fetch(`/api/marketplace/${slug}/ask`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question})});const body=await result.json();if(!result.ok)throw new Error(typeof body.message==="string"?body.message:"The assistant is temporarily unavailable.");setAnswer(body.answer);}catch(e){setError(e instanceof Error?e.message:"The assistant is temporarily unavailable.");}finally{setBusy(false);}}}><label htmlFor="directory-question">Your question</label><textarea id="directory-question" maxLength={600} rows={3} value={question} onChange={event=>setQuestion(event.target.value)} required/><button className="button button--primary" disabled={busy||question.trim().length<5}>{busy?"Reading the profile…":"Ask about this agent →"}</button></form><div role="status" aria-live="polite">{error&&<p className="directory-ai-error">{error}</p>}{answer&&<div className="directory-ai-answer"><span className="eyebrow">AI interpretation · Check the linked evidence</span><p>{answer}</p></div>}</div><small>Powered by DeepSeek via CheaperInference. Answers are generated from this public profile.</small></dialog>{shareError&&<span role="status">{shareError}</span>}
  </div>;
}
