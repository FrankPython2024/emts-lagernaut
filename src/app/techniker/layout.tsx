"use client";
import { useState, useEffect, createContext, useContext } from "react";
import Link        from "next/link";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ToastProvider }  from "@/components/ui/Toast";
import { api }            from "@/trpc/react";
import { useSocket }      from "@/hooks/useSocket";
import { EVENTS }         from "@/modules/realtime/events";

// ── Font size context ─────────────────────────────────────────────────────────

type FontSize = "small" | "medium" | "large";

interface FontCtx { fontSize: FontSize; setFontSize: (s: FontSize) => void }
const FontCtx = createContext<FontCtx>({ fontSize: "medium", setFontSize: () => {} });
export function useFontSize() { return useContext(FontCtx); }

type SessionUser = { name?: string; kuerzel?: string; rolle?: string };

// ── NachrichtToast ────────────────────────────────────────────────────────────

type ToastData = { id: number; betreff: string; inhalt: string; vonKuerzel: string };

function NachrichtToast({ data, onClose }: { data: ToastData; onClose: () => void }) {
  const router = useRouter();

  return (
    <div style={{
      position:     "fixed",
      top:          80,
      left:         "50%",
      transform:    "translateX(-50%)",
      width:        430,
      maxWidth:     "95vw",
      zIndex:       10002,
      background:   "var(--card-bg)",
      borderLeft:   "6px solid var(--primary)",
      borderRadius: 14,
      boxShadow:    "0 16px 48px rgba(0,0,0,0.28)",
      padding:      "1.2rem 1.5rem",
      animation:    "slideInFromTop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      color:        "var(--text)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: "0.95rem", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: "1.2rem" }}>📬</span>
          Neue Nachricht vom Admin
        </strong>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-dim)", fontSize: "1.3rem", lineHeight: 1, padding: "0 2px",
          }}
        >
          ×
        </button>
      </div>

      <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "8px 0" }} />

      {/* Betreff */}
      <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 5, color: "var(--primary)" }}>
        {data.betreff}
      </div>

      {/* Inhalt-Vorschau */}
      <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginBottom: 14, lineHeight: 1.5 }}>
        {data.inhalt.substring(0, 100)}{data.inhalt.length > 100 ? "…" : ""}
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => { router.push("/techniker/nachrichten"); onClose(); }}
          style={{
            background:   "var(--primary)",
            color:        "white",
            border:       "none",
            padding:      "0.5rem 1.1rem",
            borderRadius: 8,
            cursor:       "pointer",
            fontFamily:   "'Ubuntu', sans-serif",
            fontWeight:   700,
            fontSize:     "0.85rem",
          }}
        >
          📖 Lesen
        </button>
        <button
          onClick={onClose}
          style={{
            background:   "var(--bg)",
            border:       "1px solid var(--border)",
            color:        "var(--text)",
            padding:      "0.5rem 1.1rem",
            borderRadius: 8,
            cursor:       "pointer",
            fontFamily:   "'Ubuntu', sans-serif",
            fontWeight:   600,
            fontSize:     "0.85rem",
          }}
        >
          × Schließen
        </button>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function TechnikerHeader({ bellShake }: { bellShake: boolean }) {
  const { data: session } = useSession();
  const { fontSize, setFontSize } = useFontSize();
  const [dark, setDark] = useState(false);

  const user    = session?.user as SessionUser | undefined;
  const kuerzel = user?.kuerzel ?? "";

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
    background:   "var(--bg)",
    border:       "1px solid var(--border)",
    color:        "var(--text)",
    padding:      "0.4rem 0.8rem",
    borderRadius: 6,
    cursor:       "pointer",
    fontWeight:   600,
    margin:       "0.1rem",
    transition:   "all 0.2s",
    fontFamily:   "'Ubuntu', sans-serif",
    whiteSpace:   "nowrap",
  };

  return (
    <header style={{
      display:        "flex",
      justifyContent: "space-between",
      alignItems:     "center",
      padding:        "1rem 2.5rem",
      background:     "var(--card-bg)",
      borderBottom:   "1px solid var(--border)",
      position:       "sticky",
      top:            0,
      zIndex:         1000,
      boxShadow:      "0 2px 4px rgba(0,0,0,0.1)",
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

        {/* Profil */}
        {kuerzel && (
          <Link href="/techniker/profil" style={{ ...btnIcon, color: "var(--primary)", textDecoration: "none", marginLeft: "0.5rem" }}>
            👤 {kuerzel}
          </Link>
        )}

        {/* Nachrichten badge */}
        <Link
          href="/techniker/nachrichten"
          style={{
            ...btnIcon,
            position:      "relative",
            textDecoration: "none",
            animation:     bellShake ? "bellShake 0.5s ease" : "none",
          }}
        >
          🔔
          {badge > 0 && (
            <span style={{
              position:       "absolute",
              top:            -4,
              right:          -4,
              background:     "var(--danger)",
              color:          "white",
              borderRadius:   "50%",
              width:          18,
              height:         18,
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       "0.6rem",
              fontWeight:     "bold",
              lineHeight:     1,
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
  const [nachrichtToast, setNachrichtToast] = useState<ToastData | null>(null);
  const [bellShake,      setBellShake]      = useState(false);
  const { on, off } = useSocket();

  function setFontSize(s: FontSize) {
    _setFontSize(s);
    document.body.classList.remove("font-small", "font-medium", "font-large");
    document.body.classList.add(`font-${s}`);
    localStorage.setItem("tk_fontsize", s);
  }

  useEffect(() => {
    const stored = localStorage.getItem("tk_fontsize") as FontSize | null;
    if (stored && ["small", "medium", "large"].includes(stored)) {
      setFontSize(stored);
    } else {
      setFontSize("medium");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Socket: neue Nachricht → Toast + Glocke schütteln
  useEffect(() => {
    on(EVENTS.NACHRICHT_NEU, (data: unknown) => {
      const d = data as ToastData;
      setNachrichtToast(d);
      setBellShake(true);
      setTimeout(() => setBellShake(false), 600);
    });
    return () => off(EVENTS.NACHRICHT_NEU);
  }, [on, off]);

  return (
    <FontCtx.Provider value={{ fontSize, setFontSize }}>
      <ToastProvider>
        <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
          <TechnikerHeader bellShake={bellShake} />
          {children}

          {/* Große Nachricht-Toast (kein Auto-Dismiss) */}
          {nachrichtToast && (
            <NachrichtToast
              data={nachrichtToast}
              onClose={() => setNachrichtToast(null)}
            />
          )}
        </div>
      </ToastProvider>
    </FontCtx.Provider>
  );
}
