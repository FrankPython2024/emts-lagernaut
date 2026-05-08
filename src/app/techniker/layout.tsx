"use client";
import { useState, useEffect, createContext, useContext } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ToastProvider } from "@/components/ui/Toast";
import { api } from "@/trpc/react";

// ── Font size context ─────────────────────────────────────────────────────────

type FontSize = "small" | "medium" | "large";

interface FontCtx { fontSize: FontSize; setFontSize: (s: FontSize) => void }
const FontCtx = createContext<FontCtx>({ fontSize: "medium", setFontSize: () => {} });
export function useFontSize() { return useContext(FontCtx); }

type SessionUser = { name?: string; kuerzel?: string; rolle?: string };

// ── Header component ──────────────────────────────────────────────────────────

function TechnikerHeader() {
  const { data: session } = useSession();
  const { fontSize, setFontSize } = useFontSize();
  const [dark, setDark] = useState(false);
  const router = useRouter();

  const user    = session?.user as SessionUser | undefined;
  const kuerzel = user?.kuerzel ?? "";

  // Nachrichten badge
  const ungelesen = api.nachrichten.getUngelesen.useQuery(
    { kuerzel },
    { enabled: !!kuerzel, refetchInterval: 30_000 },
  );
  const badge = ungelesen.data ?? 0;

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  const btnIcon: React.CSSProperties = {
    background: "var(--bg)",
    border:     "1px solid var(--border)",
    color:      "var(--text)",
    padding:    "0.4rem 0.8rem",
    borderRadius: 6,
    cursor:     "pointer",
    fontWeight: 600,
    margin:     "0.1rem",
    transition: "all 0.2s",
    fontFamily: "'Ubuntu', sans-serif",
    whiteSpace: "nowrap",
  };

  return (
    <header style={{
      display:         "flex",
      justifyContent:  "space-between",
      alignItems:      "center",
      padding:         "1rem 2.5rem",
      background:      "var(--card-bg)",
      borderBottom:    "1px solid var(--border)",
      position:        "sticky",
      top:             0,
      zIndex:          1000,
      boxShadow:       "0 2px 4px rgba(0,0,0,0.1)",
    }}>
      {/* Logo + Title */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <img
          src="https://www.afbshop.de/media/ca/1f/fe/1760428029/logo.svg"
          alt="AfB"
          className="dark:bg-white/90 dark:rounded dark:p-0.5"
          style={{ height: "2.5rem", marginRight: "1.2rem" }}
        />
        <div style={{ borderLeft: "2px solid var(--border)", paddingLeft: "1.2rem" }}>
          <strong style={{ display: "block" }}>EMTS | Lagernaut</strong>
          <small style={{ color: "var(--primary)", fontWeight: "bold", textTransform: "uppercase", letterSpacing: 1 }}>
            AfB Sömmerda
          </small>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.2rem" }}>
        {/* Font size */}
        <button onClick={() => setFontSize("small")}  style={{ ...btnIcon, fontSize: "0.75rem" }}>A</button>
        <button onClick={() => setFontSize("medium")} style={{ ...btnIcon, fontSize: "1rem"   }}>A</button>
        <button onClick={() => setFontSize("large")}  style={{ ...btnIcon, fontSize: "1.2rem" }}>A</button>
        <span style={{ borderLeft: "1px solid var(--border)", margin: "0 0.8rem", height: 24 }} />

        {/* Dark mode */}
        <button onClick={toggleTheme} style={btnIcon}>
          {dark ? "☀️ Hell" : "🌙 Dark"}
        </button>

        {/* Profil link */}
        {kuerzel && (
          <Link
            href="/techniker/profil"
            style={{ ...btnIcon, color: "var(--primary)", textDecoration: "none", marginLeft: "0.5rem" }}
          >
            👤 {kuerzel}
          </Link>
        )}

        {/* Nachrichten badge */}
        <Link
          href="/techniker/nachrichten"
          style={{ ...btnIcon, position: "relative", textDecoration: "none" }}
        >
          🔔
          {badge > 0 && (
            <span style={{
              position:   "absolute",
              top:        -4,
              right:      -4,
              background: "var(--danger)",
              color:      "white",
              borderRadius: "50%",
              width:      18,
              height:     18,
              display:    "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize:   "0.6rem",
              fontWeight: "bold",
              lineHeight: 1,
            }}>
              {badge > 9 ? "9+" : badge}
            </span>
          )}
        </Link>

        {/* Logout */}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          style={{ ...btnIcon, marginLeft: "0.2rem" }}
          title="Abmelden"
        >
          🚪
        </button>
      </div>
    </header>
  );
}

// ── Layout root ───────────────────────────────────────────────────────────────

export default function TechnikerLayout({ children }: { children: React.ReactNode }) {
  const [fontSize, _setFontSize] = useState<FontSize>("medium");

  function setFontSize(s: FontSize) {
    _setFontSize(s);
    // Apply to body like techniker.html does
    document.body.classList.remove("font-small", "font-medium", "font-large");
    document.body.classList.add(`font-${s}`);
    localStorage.setItem("tk_fontsize", s);
  }

  // Restore font size from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("tk_fontsize") as FontSize | null;
    if (stored && ["small", "medium", "large"].includes(stored)) {
      setFontSize(stored);
    } else {
      setFontSize("medium");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <FontCtx.Provider value={{ fontSize, setFontSize }}>
      <ToastProvider>
        <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
          <TechnikerHeader />
          {children}
        </div>
      </ToastProvider>
    </FontCtx.Provider>
  );
}
