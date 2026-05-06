"use client";
import { createContext, useCallback, useContext, useState, useEffect } from "react";

type ToastType = "success" | "error" | "warning" | "info";
type Toast = { id: number; msg: string; type: ToastType };

type ToastContextValue = { show: (msg: string, type?: ToastType) => void };
const ToastCtx = createContext<ToastContextValue>({ show: () => {} });

let _id = 0;

const ICONS: Record<ToastType, string> = {
  success: "✅", error: "❌", warning: "⚠️", info: "ℹ️",
};
const BORDERS: Record<ToastType, string> = {
  success: "border-[#00a400]",
  error:   "border-[#fa3e3e]",
  warning: "border-[#f7b928]",
  info:    "border-[#0064d2]",
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onRemove(toast.id), 3000);
    return () => clearTimeout(t);
  }, [toast.id, onRemove]);

  return (
    <div
      className={`flex items-center gap-3 bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] px-4 py-3 rounded-xl border-l-4 ${BORDERS[toast.type]} shadow-xl min-w-[280px] max-w-[400px] animate-slide-in`}
    >
      <span className="text-lg">{ICONS[toast.type]}</span>
      <span className="flex-1 text-sm font-medium">{toast.msg}</span>
      <button onClick={() => onRemove(toast.id)} className="text-gray-400 hover:text-gray-600 ml-2 text-lg leading-none">×</button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback((msg: string, type: ToastType = "info") => {
    const id = ++_id;
    setToasts((t) => [...t, { id, msg, type }]);
  }, []);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[10001] flex flex-col gap-2.5">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={remove} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
