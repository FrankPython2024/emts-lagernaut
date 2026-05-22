"use client";
import { useState, useEffect, createContext, useContext } from "react";
import { useSession }   from "next-auth/react";
import { ToastProvider } from "@/components/ui/Toast";
import { LogoutButton }  from "@/components/ui/LogoutButton";
import { api }           from "@/trpc/react";
import { useSocket }     from "@/hooks/useSocket";
import { EVENTS }        from "@/modules/realtime/events";

// ── Font size context ─────────────────────────────────────────────────────────

type FontSize = "small" | "medium" | "large";

interface FontCtx { fontSize: FontSize; setFontSize: (s: FontSize) => void }
const FontCtx = createContext<FontCtx>({ fontSize: "medium", setFontSize: () => {} });
export function useFontSize() { return useContext(FontCtx); }

type SessionUser = { name?: string; kuerzel?: string; rolle?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeZeit(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60)  return "gerade eben";
  const m = Math.floor(s / 60);
  if (m < 60)  return `vor ${m} Minute${m !== 1 ? "n" : ""}`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `vor ${h} Stunde${h !== 1 ? "n" : ""}`;
  const d = Math.floor(h / 24);
  if (d === 1) return "gestern";
  if (d < 7)   return `vor ${d} Tagen`;
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

// ── NachrichtToast ────────────────────────────────────────────────────────────

type ToastData = { id: number; betreff: string; inhalt: string; vonKuerzel: string };

function NachrichtToast({ data, onClose }: { data: ToastData; onClose: () => void }) {
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
      color:        "var(--text)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: "0.95rem", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: "1.2rem" }}>📬</span>
          Neue Chat-Nachricht
        </strong>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", fontSize: "1.3rem", lineHeight: 1, padding: "0 2px" }}>×</button>
      </div>
      <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "8px 0" }} />
      <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 5, color: "var(--primary)" }}>{data.betreff}</div>
      <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginBottom: 14, lineHeight: 1.5 }}>
        {data.inhalt.substring(0, 100)}{data.inhalt.length > 100 ? "…" : ""}
      </div>
      <button
        onClick={onClose}
        style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "0.5rem 1.1rem", borderRadius: 8, cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontWeight: 600, fontSize: "0.85rem" }}
      >
        × Schließen
      </button>
    </div>
  );
}

// ── LiveUhr ───────────────────────────────────────────────────────────────────

function LiveUhr() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return <div style={{ width: 110, height: 36 }} />;

  const uhrzeit = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const datum   = now.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.3 }}>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "0.95rem", letterSpacing: "0.02em" }}>
        {uhrzeit}
      </span>
      <span style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>
        {datum}
      </span>
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, wert, accent }: { label: string; wert: number; accent?: boolean }) {
  return (
    <div style={{
      padding:      "0.875rem 1rem",
      borderRadius: 12,
      border:       `1px solid ${accent ? "rgba(0,139,210,0.30)" : "var(--border)"}`,
      background:   accent ? "rgba(0,139,210,0.07)" : "var(--bg)",
    }}>
      <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: "0.2rem", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{
        fontSize:            "1.75rem",
        fontWeight:          800,
        fontVariantNumeric:  "tabular-nums",
        color:               accent ? "#005fa3" : "var(--text)",
        lineHeight:          1,
      }}>
        {wert}
      </div>
    </div>
  );
}

// ── ProfilModal ───────────────────────────────────────────────────────────────

function ProfilModal({ kuerzel, name, onClose }: { kuerzel: string; name: string; onClose: () => void }) {
  const anfragenQuery = api.anfragen.getByTechniker.useQuery(
    { kuerzel, showAll: true, limit: 500 },
    { enabled: !!kuerzel, staleTime: 10_000 },
  );

  const alle = anfragenQuery.data?.anfragen ?? [];

  // Zeit-Grenzen (client-seitig, einmalig beim Render berechnet)
  const now         = new Date();
  const heuteStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const gesternStart = new Date(heuteStart); gesternStart.setDate(gesternStart.getDate() - 1);
  const wochenTag   = heuteStart.getDay() === 0 ? 6 : heuteStart.getDay() - 1; // 0=Mo
  const wocheStart  = new Date(heuteStart); wocheStart.setDate(wocheStart.getDate() - wochenTag);
  const monatStart  = new Date(now.getFullYear(), now.getMonth(), 1);
  const jahrStart   = new Date(now.getFullYear(), 0, 1);

  const zaehleDatum = (von: Date, bis?: Date) =>
    alle.filter(a => {
      const d = new Date(a.datum);
      return d >= von && (!bis || d < bis);
    }).length;

  const heute        = zaehleDatum(heuteStart);
  const gestern      = zaehleDatum(gesternStart, heuteStart);
  const woche        = zaehleDatum(wocheStart);
  const monat        = zaehleDatum(monatStart);
  const jahr         = zaehleDatum(jahrStart);
  const gesamt       = alle.length;
  const abgeschlossen = alle.filter(a => a.status === "ABGESCHLOSSEN").length;
  const aktiv        = alle.filter(a => ["NEU", "IN_BEARBEITUNG", "BEDARF"].includes(a.status)).length;
  const storniert    = alle.filter(a => a.status === "STORNIERT").length;

  const btnClose: React.CSSProperties = {
    background: "none", border: "none", cursor: "pointer",
    fontSize: "1.3rem", color: "var(--text-dim)", padding: "4px 8px", lineHeight: 1,
    minHeight: 44, minWidth: 44,
  };
  const statusRow: React.CSSProperties = {
    display: "flex", justifyContent: "space-between", padding: "0.55rem 0",
    borderBottom: "1px solid var(--border)", fontSize: "0.95rem",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}
    >
      <div
        className="modal-enter"
        style={{ width: "100%", maxWidth: 520, background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.25)", color: "var(--text)", overflow: "hidden", maxHeight: "90vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800 }}>Profil und Statistiken</h2>
          <button onClick={onClose} aria-label="Schließen" style={btnClose}>✕</button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem 2rem" }}>
          {/* Persönliche Daten */}
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)" }}>
            Persönliche Daten
          </h3>
          <div style={statusRow}>
            <span style={{ color: "var(--text-dim)" }}>Name</span>
            <span style={{ fontWeight: 700 }}>{name || "–"}</span>
          </div>
          <div style={{ ...statusRow, borderBottom: "none", marginBottom: "1.5rem" }}>
            <span style={{ color: "var(--text-dim)" }}>Kürzel</span>
            <span style={{ fontWeight: 700 }}>{kuerzel}</span>
          </div>

          {/* Zeitraum-KPIs */}
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)" }}>
            Anfragen
          </h3>

          {anfragenQuery.isLoading ? (
            <p style={{ color: "var(--text-dim)", textAlign: "center", padding: "1rem 0" }}>Wird geladen…</p>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.6rem", marginBottom: "1.25rem" }}>
                <StatCard label="Heute"        wert={heute}   />
                <StatCard label="Gestern"      wert={gestern} />
                <StatCard label="Diese Woche"  wert={woche}   />
                <StatCard label="Dieser Monat" wert={monat}   />
                <StatCard label="Dieses Jahr"  wert={jahr}    />
                <StatCard label="Insgesamt"    wert={gesamt}  accent />
              </div>

              {/* Status-Aufschlüsselung */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                <div style={statusRow}>
                  <span style={{ color: "var(--text-dim)" }}>Abgeschlossen</span>
                  <span style={{ fontWeight: 700, color: "#15803d", fontVariantNumeric: "tabular-nums" }}>{abgeschlossen}</span>
                </div>
                <div style={statusRow}>
                  <span style={{ color: "var(--text-dim)" }}>Aktiv (Neu / In Bearbeitung)</span>
                  <span style={{ fontWeight: 700, color: "#005fa3", fontVariantNumeric: "tabular-nums" }}>{aktiv}</span>
                </div>
                <div style={{ ...statusRow, borderBottom: "none" }}>
                  <span style={{ color: "var(--text-dim)" }}>Storniert</span>
                  <span style={{ fontWeight: 700, color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>{storniert}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function TechnikerHeader() {
  const { data: session }          = useSession();
  const { fontSize, setFontSize }  = useFontSize();
  const [dark,       setDark]      = useState(false);
  const [showProfil, setShowProfil] = useState(false);

  const user    = session?.user as SessionUser | undefined;
  const kuerzel = user?.kuerzel ?? "";
  const name    = user?.name    ?? "";

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
    background:  "var(--bg)",
    border:      "1px solid var(--border)",
    color:       "var(--text)",
    padding:     "0.4rem 0.8rem",
    borderRadius: 6,
    cursor:      "pointer",
    fontWeight:  600,
    margin:      "0.1rem",
    transition:  "all 0.2s",
    fontFamily:  "'Ubuntu', sans-serif",
    whiteSpace:  "nowrap",
  };

  return (
    <>
      <header style={{
        display:        "flex",
        justifyContent: "space-between",
        alignItems:     "center",
        padding:        "0.75rem 2rem",
        background:     "var(--card-bg)",
        borderBottom:   "1px solid var(--border)",
        position:       "sticky",
        top:            0,
        zIndex:         1000,
        boxShadow:      "0 2px 4px rgba(0,0,0,0.08)",
        gap:            "1rem",
      }}>
        {/* Logo + Title */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <img
            src="https://www.afbshop.de/media/ca/1f/fe/1760428029/logo.svg"
            alt="AfB"
            className="dark:bg-white/90 dark:rounded dark:p-0.5"
            style={{ height: "2.2rem", marginRight: "1rem" }}
          />
          <div style={{ borderLeft: "2px solid var(--border)", paddingLeft: "1rem" }}>
            <strong style={{ display: "block", fontSize: "0.9rem" }}>EMTS | Lagernaut</strong>
            <small style={{ color: "var(--primary)", fontWeight: "bold", textTransform: "uppercase", letterSpacing: 1, fontSize: "0.65rem" }}>
              AfB Sömmerda
            </small>
          </div>
        </div>

        {/* Live-Uhr (mittig) */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <LiveUhr />
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.2rem", flexShrink: 0 }}>
          {/* Schriftgröße */}
          {(["small", "medium", "large"] as const).map((sz, i) => {
            const isActive = fontSize === sz;
            return (
              <button
                key={sz}
                onClick={() => setFontSize(sz)}
                title={sz === "small" ? "Klein" : sz === "medium" ? "Standard" : "Groß"}
                style={{
                  ...btnIcon,
                  fontSize:   ["0.75rem", "1rem", "1.25rem"][i],
                  background: isActive ? "var(--primary)" : "var(--bg)",
                  color:      isActive ? "white"          : "var(--text)",
                  border:     isActive ? "1px solid var(--primary)" : "1px solid var(--border)",
                  fontWeight: isActive ? 800 : 600,
                }}
              >
                A
              </button>
            );
          })}

          <span style={{ borderLeft: "1px solid var(--border)", margin: "0 0.5rem", height: 24 }} />

          {/* Dark mode */}
          <button onClick={toggleTheme} style={btnIcon}>
            {dark ? "☀️ Hell" : "🌙 Dunkel"}
          </button>

          {/* Profil + Statistiken */}
          {kuerzel && (
            <button
              onClick={() => setShowProfil(true)}
              style={{ ...btnIcon, color: "var(--primary)", fontWeight: 700 }}
            >
              👤 Profil und Statistiken
            </button>
          )}

          {/* Logout */}
          <LogoutButton style={{ ...btnIcon, marginLeft: "0.2rem" }} title="Abmelden">
            Abmelden
          </LogoutButton>
        </div>
      </header>

      {showProfil && (
        <ProfilModal kuerzel={kuerzel} name={name} onClose={() => setShowProfil(false)} />
      )}
    </>
  );
}

// ── Layout root ───────────────────────────────────────────────────────────────

export default function TechnikerLayout({ children }: { children: React.ReactNode }) {
  const [fontSize, _setFontSize]  = useState<FontSize>("medium");
  const [nachrichtToast, setNachrichtToast] = useState<ToastData | null>(null);
  const { on, off } = useSocket();

  function setFontSize(s: FontSize) {
    _setFontSize(s);
    document.documentElement.classList.remove("font-small", "font-medium", "font-large");
    document.documentElement.classList.add(`font-${s}`);
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

  // Socket: neuer Chat → Toast
  useEffect(() => {
    const handler = (data: unknown) => {
      const d = data as ToastData;
      setNachrichtToast(d);
    };
    on(EVENTS.CHAT_NEU,      handler);
    on(EVENTS.NACHRICHT_NEU, handler);
    return () => {
      off(EVENTS.CHAT_NEU);
      off(EVENTS.NACHRICHT_NEU);
    };
  }, [on, off]);

  return (
    <FontCtx.Provider value={{ fontSize, setFontSize }}>
      <ToastProvider>
        <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
          <TechnikerHeader />
          {children}

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
