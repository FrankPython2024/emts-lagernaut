"use client";
import { useState, useEffect, createContext, useContext } from "react";
import { useSession }   from "next-auth/react";
import FocusTrap        from "focus-trap-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { LogoutButton }  from "@/components/ui/LogoutButton";
import { api }           from "@/trpc/react";
import { useSocket }     from "@/hooks/useSocket";
import { EVENTS }        from "@/modules/realtime/events";
import { useTabBadge }   from "@/hooks/useTabBadge";
import { NotificationProvider }        from "@/lib/notifications/notificationContext";
import { NotificationToggleTechniker } from "@/components/header/NotificationToggleTechniker";
import { useTechnikerNotifications }   from "@/hooks/useTechnikerNotifications";
import { TestModusBanner }             from "@/components/TestModusBanner";

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

// ── PasswortSektion ───────────────────────────────────────────────────────────

const pwInputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "0.75rem 1rem",
  borderRadius: 8,
  border:       "1px solid var(--border)",
  background:   "var(--card-bg)",
  color:        "var(--text)",
  fontSize:     "1rem",
  minHeight:    48,
  fontFamily:   "'Ubuntu', sans-serif",
  outline:      "none",
  boxSizing:    "border-box",
};

function PasswortSektion() {
  const [pwAkt,  setPwAkt]  = useState("");
  const [pwNeu,  setPwNeu]  = useState("");
  const [pwNeu2, setPwNeu2] = useState("");
  const [erfolg, setErfolg] = useState(false);
  const { show: toast } = useToast();

  const changePassword = api.benutzer.changePassword.useMutation({
    onSuccess: () => {
      setPwAkt(""); setPwNeu(""); setPwNeu2("");
      setErfolg(true);
      setTimeout(() => setErfolg(false), 3_000);
      toast("Passwort erfolgreich geändert", "success");
    },
    onError: (err) => {
      toast(err.message || "Passwort konnte nicht geändert werden", "error");
    },
  });

  function handleSubmit() {
    if (pwNeu !== pwNeu2) {
      toast("Die neuen Passwörter stimmen nicht überein", "error");
      return;
    }
    if (pwNeu.length < 8) {
      toast("Neues Passwort muss mindestens 8 Zeichen lang sein", "error");
      return;
    }
    changePassword.mutate({ aktuellesPasswort: pwAkt, neuesPasswort: pwNeu });
  }

  const mismatch  = !!pwNeu2 && pwNeu !== pwNeu2;
  const canSubmit = !!pwAkt && !!pwNeu && !!pwNeu2 && !mismatch && !changePassword.isPending;

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1.25rem", marginTop: "1.5rem" }}>
      <h3 style={{
        margin:         "0 0 1rem",
        fontSize:       "0.8rem",
        fontWeight:     700,
        textTransform:  "uppercase",
        letterSpacing:  "0.06em",
        color:          "var(--text-dim)",
      }}>
        Passwort ändern
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.3rem", color: "var(--text)" }}>
            Aktuelles Passwort
          </span>
          <input
            type="password"
            value={pwAkt}
            onChange={e => setPwAkt(e.target.value)}
            autoComplete="current-password"
            style={pwInputStyle}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.3rem", color: "var(--text)" }}>
            Neues Passwort{" "}
            <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>(min. 8 Zeichen)</span>
          </span>
          <input
            type="password"
            value={pwNeu}
            onChange={e => setPwNeu(e.target.value)}
            autoComplete="new-password"
            style={pwInputStyle}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.3rem", color: "var(--text)" }}>
            Neues Passwort bestätigen
          </span>
          <input
            type="password"
            value={pwNeu2}
            onChange={e => setPwNeu2(e.target.value)}
            autoComplete="new-password"
            style={{
              ...pwInputStyle,
              borderColor: mismatch ? "#ef4444" : "var(--border)",
            }}
          />
          {mismatch && (
            <span style={{ display: "block", fontSize: "0.82rem", color: "#ef4444", marginTop: "0.3rem" }}>
              Passwörter stimmen nicht überein
            </span>
          )}
        </label>

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            minHeight:    56,
            padding:      "0.85rem 1.5rem",
            borderRadius: 12,
            background:   canSubmit ? "var(--primary)" : "var(--border)",
            color:        canSubmit ? "white" : "var(--text-dim)",
            fontWeight:   700,
            fontSize:     "0.98rem",
            fontFamily:   "'Ubuntu', sans-serif",
            cursor:       canSubmit ? "pointer" : "not-allowed",
            border:       "none",
            marginTop:    "0.4rem",
            transition:   "background 0.15s",
          }}
        >
          {changePassword.isPending ? "⏳ Speichere…" : "💾 Passwort ändern"}
        </button>

        {erfolg && (
          <div style={{
            padding:      "0.75rem 1rem",
            borderRadius: 10,
            background:   "rgba(34,197,94,0.12)",
            color:        "#15803d",
            fontSize:     "0.92rem",
            fontWeight:   600,
          }}>
            ✓ Passwort erfolgreich geändert
          </div>
        )}
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

  // Escape schließt
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}
    >
      <FocusTrap focusTrapOptions={{
        escapeDeactivates:       false,
        allowOutsideClick:       true,
        returnFocusOnDeactivate: true,
        fallbackFocus:           "[aria-labelledby='profil-modal-title']",
        initialFocus:            false,
      }}>
      <div
        className="modal-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profil-modal-title"
        tabIndex={-1}
        style={{ width: "100%", maxWidth: 520, background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.25)", color: "var(--text)", overflow: "hidden", maxHeight: "90vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
          <h2 id="profil-modal-title" style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800 }}>Profil und Statistiken</h2>
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

          <PasswortSektion />
        </div>
      </div>
      </FocusTrap>
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

          {/* Browser-Benachrichtigungen */}
          <NotificationToggleTechniker style={btnIcon} />

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
  const { on, off } = useSocket();
  const utils = api.useUtils();
  const { notify } = useTabBadge();

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

  // Socket: neuer Chat → Badge-Query invalidieren (kein Toast — der Badge in
  // der Anfragen-Liste reicht als Hinweis). Zusätzlich Tab-Counter erhöhen wenn
  // der Tab im Hintergrund ist. Alle drei Events sind via emitToUser bereits auf
  // den eigenen Techniker zugeschnitten.
  //
  // Counter-Audit/Fixes:
  //   • ANFRAGE_UEBERNOMMEN (NEU→IN_BEARBEITUNG) wurde vorher NICHT gezählt → ergänzt.
  //   • Bei NICHT_VERFUEGBAR feuern Status (ANFRAGE_UPDATED) UND Auto-Chat (CHAT_NEU).
  //     Die Auto-Chat-Nachricht trägt isAutoMessage=true und tickt NICHT mit →
  //     genau eine Erhöhung statt zwei.
  useEffect(() => {
    const invalidateChat = () => {
      utils.chat.getStatsForAnfrage.invalidate();
      utils.chat.getUngelesenCount.invalidate();
    };
    const onChat = (d: unknown) => {
      invalidateChat();
      if (!(d as { isAutoMessage?: boolean })?.isAutoMessage) notify();
    };
    const onAnfrage = () => { notify(); };

    on(EVENTS.CHAT_NEU,           onChat);
    on(EVENTS.NACHRICHT_NEU,      invalidateChat);
    on(EVENTS.ANFRAGE_UPDATED,    onAnfrage);
    on(EVENTS.ANFRAGE_UEBERNOMMEN, onAnfrage);
    return () => {
      off(EVENTS.CHAT_NEU);
      off(EVENTS.NACHRICHT_NEU);
      off(EVENTS.ANFRAGE_UPDATED);
      off(EVENTS.ANFRAGE_UEBERNOMMEN);
    };
  }, [on, off, utils, notify]);

  return (
    <FontCtx.Provider value={{ fontSize, setFontSize }}>
      <ToastProvider>
        <NotificationProvider>
          <TechnikerNotifications />
          <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
            <TestModusBanner />
            <TechnikerHeader />
            {children}
          </div>
        </NotificationProvider>
      </ToastProvider>
    </FontCtx.Provider>
  );
}

// ── Browser-Notifications (System-Toast + Ping) — einmal im Layout gemountet ──

function TechnikerNotifications() {
  useTechnikerNotifications();
  return null;
}
