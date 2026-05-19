"use client";
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

const LS_KEY = "lagernaut.activeStandortId";

type StandortFilter = {
  activeStandortId:    number | null;
  setActiveStandortId: (id: number | null) => void;
};

const StandortContext = createContext<StandortFilter | null>(null);

export function StandortProvider({ children }: { children: ReactNode }) {
  const [activeStandortId, setActiveStandortIdState] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && saved !== "null") setActiveStandortIdState(Number(saved));
    setMounted(true);
  }, []);

  const setActiveStandortId = (id: number | null) => {
    setActiveStandortIdState(id);
    localStorage.setItem(LS_KEY, id === null ? "null" : String(id));
  };

  if (!mounted) return <>{children}</>;

  return (
    <StandortContext.Provider value={{ activeStandortId, setActiveStandortId }}>
      {children}
    </StandortContext.Provider>
  );
}

const NOOP_FILTER: StandortFilter = {
  activeStandortId:    null,
  setActiveStandortId: () => {
    if (process.env.NODE_ENV === "development") {
      console.warn("setActiveStandortId called outside StandortProvider — ignored");
    }
  },
};

export function useStandortFilter(): StandortFilter {
  return useContext(StandortContext) ?? NOOP_FILTER;
}
