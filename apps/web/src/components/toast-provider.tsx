"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { StatusTone } from "@bnbera/ui";
type Toast = { readonly id: string; readonly tone: StatusTone; readonly title: string; readonly description?: string };
const ToastContext = createContext<{ notify: (toast: Toast) => void; dismiss: (id: string) => void }>({ notify: () => undefined, dismiss: () => undefined });
export const useToast = () => useContext(ToastContext);
function ToastItem({ toast, dismiss }: { readonly toast: Toast; readonly dismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || toast.tone === "warning" || toast.tone === "danger") return;
    const timer = window.setTimeout(() => dismiss(toast.id), 6000);
    return () => window.clearTimeout(timer);
  }, [dismiss, paused, toast]);
  return <div className={`toast toast--${toast.tone}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <div role={toast.tone === "danger" ? "alert" : "status"} aria-atomic="true"><strong>{toast.title}</strong>{toast.description && <p>{toast.description}</p>}</div>
    <button type="button" aria-label={`Dismiss ${toast.title}`} onClick={() => dismiss(toast.id)}>×</button>
  </div>;
}
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((toast: Toast) => setToasts((current) => {
    const previous = current.find((item) => item.id === toast.id);
    if (previous?.title === toast.title && previous?.description === toast.description && previous?.tone === toast.tone) return current;
    return [...current.filter((item) => item.id !== toast.id), toast].slice(-3);
  }), []);
  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  return <ToastContext.Provider value={{ notify, dismiss }}>{children}<aside className="toast-viewport" aria-label="Notifications">{toasts.map((toast) => <ToastItem key={toast.id} toast={toast} dismiss={dismiss} />)}</aside></ToastContext.Provider>;
}
