"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Refresh read-only observations on visible directory pages, preserving UI state. */
export function ProtocolRefresh({ intervalMs=30_000 }: { readonly intervalMs?: 5_000 | 30_000 } = {}) {
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  useEffect(()=>{
    const refresh=()=>{if(!pending && document.visibilityState==="visible")startTransition(()=>router.refresh());};
    const timer=window.setInterval(refresh,intervalMs);
    document.addEventListener("visibilitychange",refresh);
    return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[pending,router,intervalMs]);
  return null;
}
