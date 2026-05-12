"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter }    from "next/navigation";
import { useSession }   from "next-auth/react";
import { api }          from "@/trpc/react";
import { useToast }     from "@/components/ui/Toast";
import { STANDARD_TEILE, GRADING_OPTIONS } from "@/modules/einlagern/constants";
import {
  printAlleEinlagerBelege,
  printEinlagerBeleg,
  EinlagerBelegPreview,
  type EinlagerBelegData,
} from "@/components/ui/EinlagerBeleg";

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardStep = 0 | 1 | 2 | 3 | 4;

type GeraetState = {
  name:  string;
  logId: string | null;
  typ:   "logid" | "modell" | "manuell";
};

type AusgewaehltItem = {
  teiltyp:    string;
  label:      string;
  icon:       string;
  menge:      number;
  grading:    string;
  notiz:      string;
  lagerplatz: string;
};

type ErgebnisItem = {
  teiltyp:      string;
  icon:         string;
  label:        string;
  artikelName:  string;
  kategorie:    string;
  lagerplatz:   string | null;
  menge:        number;
  buchungId:    number;
  belegNr:      string;
  neuerBestand: number;
  grading:      string;
  notizText:    string | undefined;
  eingelagert:  boolean;
};

// ── Shared Styles ─────────────────────────────────────────────────────────────

const S = {
  card: {
    background:   "var(--card-bg)",
    border:       "1px solid var(--border)",
    borderRadius: 16,
    padding:      "2rem",
    boxShadow:    "0 4px 20px rgba(0,0,0,0.08)",
  } satisfies React.CSSProperties,

  bigBtn: (color: string, disabled = false): React.CSSProperties => ({
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    gap:            10,
    width:          "100%",
    minHeight:      70,
    padding:        "0 1.5rem",
    borderRadius:   14,
    border:         "none",
    background:     disabled ? "var(--border)" : color,
    color:          "white",
    fontSize:       "1.1rem",
    fontWeight:     800,
    cursor:         disabled ? "not-allowed" : "pointer",
    fontFamily:     "'Ubuntu', sans-serif",
    transition:     "transform 0.15s, box-shadow 0.15s",
    opacity:        disabled ? 0.6 : 1,
  }),

  backBtn: {
    display:        "flex",
    alignItems:     "center",
    gap:            6,
    background:     "none",
    border:         "none",
    color:          "var(--text-dim)",
    cursor:         "pointer",
    fontSize:       "0.95rem",
    fontWeight:     600,
    fontFamily:     "'Ubuntu', sans-serif",
    padding:        "0.4rem 0.6rem",
    borderRadius:   8,
  } satisfies React.CSSProperties,

  input: {
    width:        "100%",
    minHeight:    56,
    padding:      "0.8rem 1rem",
    borderRadius: 10,
    border:       "2px solid var(--border)",
    background:   "var(--bg)",
    color:        "var(--text)",
    fontSize:     "1.1rem",
    fontFamily:   "'Ubuntu', sans-serif",
    outline:      "none",
    boxSizing:    "border-box",
    transition:   "border-color 0.2s",
  } satisfies React.CSSProperties,
};

// ── WizardProgress ────────────────────────────────────────────────────────────

function WizardProgress({ current, total = 3 }: { current: number; total?: number }) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-dim)", marginBottom: 8 }}>
        Schritt {current} von {total}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {Array.from({ length: total }, (_, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width:          done || active ? 32 : 10,
                height:         10,
                borderRadius:   5,
                background:     done ? "#04B475" : active ? "#202F61" : "var(--border)",
                transition:     "all 0.3s",
                flexShrink:     0,
              }} />
              {done && (
                <span style={{ fontSize: "0.8rem", color: "#04B475", fontWeight: 800 }}>✓</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TeilKonfigurator (Modal) ──────────────────────────────────────────────────

function TeilKonfigurator({
  teil,
  initial,
  onSave,
  onClose,
}: {
  teil:    typeof STANDARD_TEILE[number];
  initial: Partial<AusgewaehltItem>;
  onSave:  (item: AusgewaehltItem) => void;
  onClose: () => void;
}) {
  const [grading, setGrading] = useState(initial.grading ?? "");
  const [menge,   setMenge]   = useState(initial.menge   ?? 1);
  const [notiz,   setNotiz]   = useState(initial.notiz   ?? "");
  const [warn,    setWarn]    = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function changeMenge(delta: number) {
    const next = Math.max(1, Math.min(99, menge + delta));
    if (next > 5 && menge <= 5) setWarn(true);
    else setWarn(false);
    setMenge(next);
  }

  function handleSave() {
    if (!grading) return;
    onSave({
      teiltyp:    teil.id,
      label:      teil.label,
      icon:       teil.icon,
      menge,
      grading,
      notiz,
      lagerplatz: initial.lagerplatz ?? "",
    });
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.35)", width: "100%", maxWidth: 480, color: "var(--text)", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${teil.label} hinzufügen`}
      >
        {/* Header */}
        <div style={{ padding: "1.2rem 1.5rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "2rem" }}>{teil.icon}</span>
          <div>
            <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>
              {teil.label} {initial.grading ? "bearbeiten" : "hinzufügen"}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>{teil.beschreibung}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "1.5rem", lineHeight: 1, padding: "2px 6px" }} aria-label="Schließen">×</button>
        </div>

        <div style={{ padding: "1.5rem" }}>

          {/* Grading */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 800, marginBottom: 10, fontSize: "1rem" }}>
              ❓ In welchem Zustand ist das Teil? <span style={{ color: "var(--danger)" }}>*</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {GRADING_OPTIONS.map((g) => {
                const sel = grading === g.value;
                return (
                  <button
                    key={g.value}
                    onClick={() => setGrading(g.value)}
                    aria-pressed={sel}
                    style={{
                      display:       "flex",
                      alignItems:    "center",
                      gap:           12,
                      padding:       "0.9rem 1rem",
                      borderRadius:  10,
                      border:        `2px solid ${sel ? "#202F61" : "var(--border)"}`,
                      background:    sel ? "rgba(32,47,97,0.08)" : "var(--bg)",
                      cursor:        "pointer",
                      fontFamily:    "'Ubuntu', sans-serif",
                      textAlign:     "left",
                      transition:    "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: "1.4rem", flexShrink: 0 }}>{g.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: sel ? 800 : 600, fontSize: "0.95rem", color: "var(--text)" }}>
                        {g.label} ({g.value})
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
                        {g.beschreibung}
                      </div>
                    </div>
                    {sel && <span style={{ color: "#202F61", fontWeight: 800, fontSize: "1.1rem" }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Menge */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 800, marginBottom: 10, fontSize: "1rem" }}>
              ❓ Wie viele Stück?
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center" }}>
              <button
                onClick={() => changeMenge(-1)}
                disabled={menge <= 1}
                aria-label="Weniger"
                style={{
                  width: 60, height: 60, borderRadius: 12, border: "2px solid var(--border)",
                  background: menge <= 1 ? "var(--bg)" : "var(--card-bg)", color: "var(--text)",
                  fontSize: "1.5rem", fontWeight: 800, cursor: menge <= 1 ? "not-allowed" : "pointer",
                  opacity: menge <= 1 ? 0.4 : 1, fontFamily: "'Ubuntu', sans-serif",
                }}
              >−</button>
              <span style={{ fontSize: "2.5rem", fontWeight: 900, minWidth: 60, textAlign: "center", color: "var(--text)" }}>
                {menge}
              </span>
              <button
                onClick={() => changeMenge(1)}
                aria-label="Mehr"
                style={{
                  width: 60, height: 60, borderRadius: 12, border: "2px solid var(--border)",
                  background: "var(--card-bg)", color: "var(--text)", fontSize: "1.5rem",
                  fontWeight: 800, cursor: "pointer", fontFamily: "'Ubuntu', sans-serif",
                }}
              >+</button>
            </div>
            {warn && (
              <div style={{ textAlign: "center", fontSize: "0.85rem", color: "#f7b928", fontWeight: 600, marginTop: 8 }}>
                ⚠️ Sicher, dass es {menge} Stück sind?
              </div>
            )}
          </div>

          {/* Notiz */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: "0.95rem" }}>
              📝 Notiz <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>(optional)</span>
            </div>
            <input
              type="text"
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
              placeholder='z.B. "Taste fehlt" oder "leicht vergilbt"'
              style={{ ...S.input, minHeight: 48 }}
              onFocus={(e)  => (e.currentTarget.style.borderColor = "#202F61")}
              onBlur={(e)   => (e.currentTarget.style.borderColor = "var(--border)")}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, minHeight: 56, borderRadius: 10, border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--text-dim)", cursor: "pointer",
                fontFamily: "'Ubuntu', sans-serif", fontWeight: 600, fontSize: "1rem",
              }}
            >
              ❌ Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={!grading}
              style={{ ...S.bigBtn("#04B475", !grading), flex: 2 }}
            >
              ✅ {teil.label} hinzufügen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 0: Willkommen ────────────────────────────────────────────────────────

function StepWillkommen({ onStart }: { onStart: () => void }) {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <div style={{ ...S.card, textAlign: "center" }}>
        <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>📦</div>
        <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 0.4rem", color: "var(--text)" }}>
          Teile einlagern
        </h1>
        <p style={{ fontSize: "0.95rem", color: "#008BD2", fontWeight: 700, margin: "0 0 1.5rem", textTransform: "uppercase", letterSpacing: 1 }}>
          Einlager-Assistent · AfB Sömmerda
        </p>

        <div style={{ width: 48, height: 3, margin: "0 auto 2rem", borderRadius: 2, background: "linear-gradient(90deg, #202F61, #008BD2)" }} />

        <div style={{ textAlign: "left", marginBottom: "2rem" }}>
          <div style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: "1rem", color: "var(--text)" }}>
            So geht es:
          </div>
          {[
            { nr: "1️⃣", title: "Gerät eingeben", sub: "Das Gerät, das du gerade zerlegst" },
            { nr: "2️⃣", title: "Teile anklicken", sub: "Was du herausgenommen hast" },
            { nr: "3️⃣", title: "Einbuchen und fertig!", sub: "Du siehst wo du die Teile hinlegst" },
          ].map((s) => (
            <div key={s.nr} style={{
              display:      "flex",
              alignItems:   "flex-start",
              gap:          14,
              padding:      "0.9rem 1rem",
              marginBottom: 8,
              borderRadius: 12,
              background:   "var(--bg)",
              border:       "1px solid var(--border)",
            }}>
              <span style={{ fontSize: "1.8rem", flexShrink: 0, marginTop: -2 }}>{s.nr}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>{s.title}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginTop: 2 }}>{s.sub}</div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onStart}
          style={{ ...S.bigBtn("#04B475"), fontSize: "1.2rem" }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
        >
          Los geht&apos;s! →
        </button>
      </div>
    </div>
  );
}

// ── Step 1: Gerät scannen ─────────────────────────────────────────────────────

function StepGeraet({
  onBack,
  onWeiter,
  initial,
}: {
  onBack:   () => void;
  onWeiter: (g: GeraetState) => void;
  initial:  GeraetState | null;
}) {
  const { show }  = useToast();
  const inputRef  = useRef<HTMLInputElement>(null);
  const [query,   setQuery]   = useState(initial ? "" : "");
  const [suchQ,   setSuchQ]   = useState<string | null>(null);
  const [manName, setManName] = useState("");
  const [modus,   setModus]   = useState<"suche" | "gefunden" | "nichtGefunden" | "manuell">(
    initial ? "gefunden" : "suche",
  );
  const [gefunden, setGefunden] = useState<GeraetState | null>(initial);

  const sucheQuery = api.einlagern.geraetSuchen.useQuery(
    { query: suchQ ?? "" },
    { enabled: !!suchQ, retry: false, staleTime: 0 },
  );

  useEffect(() => {
    if (!sucheQuery.data || !suchQ) return;
    setSuchQ(null);
    if (sucheQuery.data.gefunden) {
      setGefunden({ name: sucheQuery.data.name, logId: sucheQuery.data.logId ?? null, typ: sucheQuery.data.typ });
      setModus("gefunden");
    } else {
      setModus("nichtGefunden");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucheQuery.data]);

  function handleSuchen() {
    const val = query.trim();
    if (!val) return;
    setSuchQ(val);
  }

  function formatLogId(val: string) {
    const digits = val.replace(/\D/g, "");
    if (digits.length === 9) {
      return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    }
    return val;
  }

  useEffect(() => {
    if (modus === "suche") inputRef.current?.focus();
  }, [modus]);

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
        <button onClick={onBack} style={S.backBtn} aria-label="Zurück zur Startseite">
          ← Zurück
        </button>
      </div>

      <WizardProgress current={1} />

      <div style={S.card}>
        <h2 style={{ fontSize: "1.6rem", fontWeight: 900, margin: "0 0 0.5rem", color: "var(--text)" }}>
          Welches Gerät zerlegst du?
        </h2>
        <p style={{ margin: "0 0 1.5rem", color: "var(--text-dim)", fontSize: "0.95rem" }}>
          Scanne den Aufkleber oder tippe die Nummer ein.
        </p>

        {/* Suche */}
        {(modus === "suche" || modus === "nichtGefunden") && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: "1rem" }}>
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSuchen(); }}
                onBlur={(e)  => { e.currentTarget.value = formatLogId(e.currentTarget.value); }}
                placeholder="z.B. 212.706.341"
                style={{ ...S.input, flex: 1, fontSize: "1.3rem", fontWeight: 700, letterSpacing: 2, textAlign: "center" }}
                onFocus={(e)  => (e.currentTarget.style.borderColor = "#202F61")}
                aria-label="Geräte-Nummer oder LogID eingeben"
              />
              <button
                onClick={handleSuchen}
                disabled={!query.trim() || sucheQuery.isFetching}
                style={{ ...S.bigBtn("#202F61", !query.trim() || sucheQuery.isFetching), width: "auto", padding: "0 1.5rem" }}
                aria-label="Gerät suchen"
              >
                {sucheQuery.isFetching
                  ? <span style={{ display: "inline-block", width: 22, height: 22, border: "2px solid white", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                  : "Suchen →"}
              </button>
            </div>

            {modus === "nichtGefunden" && (
              <div style={{ background: "rgba(247,185,40,0.12)", border: "1px solid rgba(247,185,40,0.4)", borderRadius: 12, padding: "1.2rem", marginBottom: "1rem" }}>
                <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: 6 }}>
                  ❓ Dieses Gerät kennen wir noch nicht.
                </div>
                <div style={{ fontSize: "0.9rem", color: "var(--text-dim)", marginBottom: 12 }}>
                  Kein Problem! Schreibe den Gerätenamen auf:
                </div>
                <input
                  type="text"
                  value={manName}
                  onChange={(e) => setManName(e.target.value)}
                  placeholder="z.B. HP EliteBook 840 G5"
                  style={{ ...S.input, marginBottom: 10 }}
                  onFocus={(e)  => (e.currentTarget.style.borderColor = "#202F61")}
                  onBlur={(e)   => (e.currentTarget.style.borderColor = "var(--border)")}
                  aria-label="Gerätenamen manuell eingeben"
                  autoFocus
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => { setModus("suche"); setManName(""); setQuery(""); }}
                    style={{ flex: 1, minHeight: 56, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontWeight: 600, fontSize: "0.95rem" }}
                  >
                    ← Andere Nummer versuchen
                  </button>
                  <button
                    onClick={() => {
                      if (!manName.trim()) { show("Bitte einen Namen eingeben.", "error"); return; }
                      onWeiter({ name: manName.trim(), logId: null, typ: "manuell" });
                    }}
                    disabled={!manName.trim()}
                    style={{ ...S.bigBtn("#008BD2", !manName.trim()), flex: 2 }}
                  >
                    Mit diesem Namen weiter →
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => setModus("manuell")}
              style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline", fontFamily: "'Ubuntu', sans-serif" }}
            >
              Kein Aufkleber? → Modellname eingeben
            </button>
          </>
        )}

        {/* Manueller Modellname-Modus */}
        {modus === "manuell" && (
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSuchen(); }}
              placeholder="z.B. Lenovo ThinkPad T15"
              style={{ ...S.input, marginBottom: 10 }}
              onFocus={(e)  => (e.currentTarget.style.borderColor = "#202F61")}
              onBlur={(e)   => (e.currentTarget.style.borderColor = "var(--border)")}
              aria-label="Modellname eingeben"
              autoFocus
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { setModus("suche"); setQuery(""); }}
                style={{ flex: 1, minHeight: 56, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontWeight: 600 }}
              >
                ← Nummer eingeben
              </button>
              <button
                onClick={handleSuchen}
                disabled={!query.trim() || sucheQuery.isFetching}
                style={{ ...S.bigBtn("#202F61", !query.trim() || sucheQuery.isFetching), flex: 2 }}
              >
                {sucheQuery.isFetching ? "Suche läuft…" : "Suchen →"}
              </button>
            </div>
          </>
        )}

        {/* Gerät gefunden */}
        {modus === "gefunden" && gefunden && (
          <div>
            <div style={{ background: "rgba(4,180,117,0.1)", border: "1px solid rgba(4,180,117,0.4)", borderRadius: 14, padding: "1.5rem", marginBottom: "1.5rem", textAlign: "center" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>✅</div>
              <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: 4 }}>Das ist dein Gerät:</div>
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#202F61", marginBottom: gefunden.logId ? 4 : 0 }}>
                {gefunden.name}
              </div>
              {gefunden.logId && (
                <div style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
                  Nummer: {gefunden.logId}
                </div>
              )}
            </div>
            <div style={{ fontSize: "1rem", fontWeight: 700, textAlign: "center", marginBottom: 16 }}>
              ❓ Ist das richtig?
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setModus("suche"); setGefunden(null); setQuery(""); }}
                style={{ flex: 1, minHeight: 60, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontWeight: 600, fontSize: "0.95rem" }}
              >
                ❌ Nein, neu eingeben
              </button>
              <button
                onClick={() => onWeiter(gefunden)}
                style={{ ...S.bigBtn("#04B475"), flex: 2 }}
              >
                ✅ Ja, weiter →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 2: Teile auswählen ───────────────────────────────────────────────────

function StepTeile({
  geraet,
  items,
  onBack,
  onWeiter,
  onItemsChange,
}: {
  geraet:        GeraetState;
  items:         AusgewaehltItem[];
  onBack:        () => void;
  onWeiter:      () => void;
  onItemsChange: (items: AusgewaehltItem[]) => void;
}) {
  const [konfig,    setKonfig]    = useState<typeof STANDARD_TEILE[number] | null>(null);
  const [editItem,  setEditItem]  = useState<AusgewaehltItem | null>(null);

  // Aktuellen Bestand je Teiltyp für dieses Gerät laden (Bug 3)
  const bestandQuery = api.kompatibilitaet.getByGeraetMitStandard.useQuery(
    { geraet: geraet.name },
    { staleTime: 60_000 },
  );
  const bestandMap = new Map(
    (bestandQuery.data?.teile ?? []).map((t) => [t.teiltyp, t]),
  );

  function handleSave(item: AusgewaehltItem) {
    const existing = items.findIndex((i) => i.teiltyp === item.teiltyp);
    if (existing >= 0) {
      const next = [...items];
      next[existing] = item;
      onItemsChange(next);
    } else {
      onItemsChange([...items, item]);
    }
    setKonfig(null);
    setEditItem(null);
  }

  function handleRemove(teiltyp: string) {
    onItemsChange(items.filter((i) => i.teiltyp !== teiltyp));
  }

  const selected = new Set(items.map((i) => i.teiltyp));

  return (
    <>
      {konfig && (
        <TeilKonfigurator
          teil={konfig}
          initial={editItem ?? {}}
          onSave={handleSave}
          onClose={() => { setKonfig(null); setEditItem(null); }}
        />
      )}

      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
          <button onClick={onBack} style={S.backBtn}>← Zurück</button>
        </div>

        <WizardProgress current={2} />

        {/* Gerät-Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.5rem", padding: "0.9rem 1.2rem", background: "#202F61", borderRadius: 12, color: "white" }}>
          <span style={{ fontSize: "1.4rem" }}>💻</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: "1rem" }}>{geraet.name}</div>
            {geraet.logId && <div style={{ fontSize: "0.8rem", opacity: 0.75 }}>#{geraet.logId}</div>}
          </div>
        </div>

        <div style={S.card}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "0 0 0.3rem", color: "var(--text)" }}>
            Was hast du herausgenommen?
          </h2>
          <p style={{ margin: "0 0 1.5rem", color: "var(--text-dim)", fontSize: "0.95rem" }}>
            Klicke auf die Teile, die du aus dem Gerät genommen hast. Du kannst mehrere auswählen.
          </p>

          {/* Teile-Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: "2rem" }}>
            {STANDARD_TEILE.map((teil) => {
              const sel     = selected.has(teil.id);
              const bInfo   = bestandMap.get(teil.id);
              const bestand = bInfo?.bestand ?? 0;
              const linked  = !!bInfo?.artikelId;
              return (
                <button
                  key={teil.id}
                  onClick={() => {
                    if (sel) {
                      const item = items.find((i) => i.teiltyp === teil.id)!;
                      setEditItem(item);
                    } else {
                      setEditItem(null);
                    }
                    setKonfig(teil);
                  }}
                  aria-pressed={sel}
                  aria-label={`${teil.label} ${sel ? "bearbeiten" : "auswählen"}`}
                  style={{
                    display:        "flex",
                    flexDirection:  "column",
                    alignItems:     "center",
                    gap:            6,
                    padding:        "1rem 0.5rem",
                    borderRadius:   14,
                    border:         `2px solid ${sel ? "#04B475" : "var(--border)"}`,
                    background:     sel ? "rgba(4,180,117,0.08)" : "var(--card-bg)",
                    cursor:         "pointer",
                    fontFamily:     "'Ubuntu', sans-serif",
                    transition:     "all 0.15s",
                    position:       "relative",
                  }}
                >
                  {sel && (
                    <span style={{ position: "absolute", top: 6, right: 8, fontSize: "0.75rem", color: "#04B475", fontWeight: 800 }}>✓</span>
                  )}
                  <span style={{ fontSize: "2rem", lineHeight: 1 }}>{teil.icon}</span>
                  <span style={{ fontSize: "0.8rem", fontWeight: 700, textAlign: "center", lineHeight: 1.3, color: "var(--text)" }}>
                    {teil.label}
                  </span>
                  {/* Bestand-Badge */}
                  {linked && !sel && (
                    <span style={{
                      fontSize: "0.68rem", padding: "0.15rem 0.5rem", borderRadius: 5, fontWeight: 700,
                      background: bestand > 0 ? "rgba(4,180,117,0.12)" : "rgba(250,62,62,0.1)",
                      color:      bestand > 0 ? "#038F5C"              : "#c0392b",
                    }}>
                      {bestand > 0 ? `${bestand}× im Lager` : "0 auf Lager"}
                    </span>
                  )}
                  {!linked && !sel && (
                    <span style={{ fontSize: "0.65rem", color: "var(--text-dim)", fontStyle: "italic" }}>
                      noch nicht erfasst
                    </span>
                  )}
                  <span style={{
                    fontSize:    "0.72rem",
                    padding:     "0.2rem 0.6rem",
                    borderRadius: 6,
                    background:  sel ? "#04B475" : "var(--border)",
                    color:       sel ? "white" : "var(--text-dim)",
                    fontWeight:  600,
                  }}>
                    {sel ? "✏️ Ändern" : "Auswählen"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Auswahl-Liste */}
          {items.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1.5rem", marginBottom: "1.5rem" }}>
              <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: 10 }}>
                Deine Auswahl ({items.length} {items.length === 1 ? "Teil" : "Teile"}):
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((item) => {
                  const grOpt = GRADING_OPTIONS.find((g) => g.value === item.grading);
                  return (
                    <div key={item.teiltyp} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.8rem 1rem", background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)" }}>
                      <span style={{ fontSize: "1.4rem" }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{item.label}</div>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
                          {grOpt?.icon} {grOpt?.label} · {item.menge} Stück
                          {item.notiz && ` · "${item.notiz}"`}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const teil = STANDARD_TEILE.find((t) => t.id === item.teiltyp)!;
                          setEditItem(item);
                          setKonfig(teil);
                        }}
                        style={{ background: "none", border: "1px solid var(--border)", color: "var(--text-dim)", cursor: "pointer", padding: "0.3rem 0.7rem", borderRadius: 6, fontSize: "0.8rem", fontFamily: "'Ubuntu', sans-serif" }}
                        aria-label={`${item.label} bearbeiten`}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleRemove(item.teiltyp)}
                        style={{ background: "none", border: "1px solid rgba(250,62,62,0.3)", color: "#fa3e3e", cursor: "pointer", padding: "0.3rem 0.7rem", borderRadius: 6, fontSize: "0.8rem", fontFamily: "'Ubuntu', sans-serif" }}
                        aria-label={`${item.label} entfernen`}
                      >
                        🗑️
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {items.length === 0 && (
            <div style={{ textAlign: "center", padding: "1rem 0 1.5rem", color: "var(--text-dim)", fontSize: "0.9rem", borderTop: "1px solid var(--border)", marginBottom: "1rem" }}>
              Noch keine Teile ausgewählt. Klicke auf ein Teil oben.
            </div>
          )}

          <button
            onClick={onWeiter}
            disabled={items.length === 0}
            style={{ ...S.bigBtn("#202F61", items.length === 0), fontSize: "1.1rem" }}
          >
            Weiter zu Schritt 3 →
          </button>
        </div>
      </div>
    </>
  );
}

// ── Step 3: Bestätigung ───────────────────────────────────────────────────────

function StepBestaetigung({
  geraet,
  items,
  onBack,
  onEinbuchen,
}: {
  geraet:      GeraetState;
  items:       AusgewaehltItem[];
  onBack:      () => void;
  onEinbuchen: (itemsWithLager: AusgewaehltItem[]) => void;
}) {
  const [localItems, setLocalItems] = useState<AusgewaehltItem[]>(items);

  const previewQuery = api.einlagern.preview.useQuery(
    { geraetName: geraet.name, items: localItems.map((i) => ({ teiltyp: i.teiltyp, menge: i.menge, grading: i.grading })) },
    { staleTime: 0 },
  );

  const neueItems    = previewQuery.data?.filter((p) => p.istNeu) ?? [];
  const neueKateg    = [...new Set(neueItems.map((p) => p.teiltyp))];

  const vorschlaegeQuery = api.einlagern.lagerplatzVorschlaegeMulti.useQuery(
    { kategorien: neueKateg },
    { enabled: neueKateg.length > 0, staleTime: 0 },
  );

  // Pre-fill Lagerplatz-Felder sobald Vorschläge geladen sind
  useEffect(() => {
    if (!vorschlaegeQuery.data) return;
    setLocalItems((prev) =>
      prev.map((item) => {
        if (item.lagerplatz) return item;
        const vorschlag = vorschlaegeQuery.data[item.teiltyp];
        return vorschlag ? { ...item, lagerplatz: vorschlag } : item;
      }),
    );
  }, [vorschlaegeQuery.data]);

  function setLagerplatz(teiltyp: string, wert: string) {
    setLocalItems((prev) =>
      prev.map((item) => item.teiltyp === teiltyp ? { ...item, lagerplatz: wert } : item),
    );
  }

  const isLoading = previewQuery.isLoading || vorschlaegeQuery.isLoading;
  const canSubmit = !isLoading;

  return (
    <div style={{ maxWidth: 660, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
        <button onClick={onBack} style={S.backBtn}>← Zurück</button>
      </div>

      <WizardProgress current={3} />

      <div style={S.card}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "0 0 0.5rem", color: "var(--text)" }}>
          Letzte Überprüfung
        </h2>
        <p style={{ margin: "0 0 1.5rem", color: "var(--text-dim)", fontSize: "0.95rem" }}>
          Du buchst Teile ein für: <strong>{geraet.name}</strong>
        </p>

        {/* Preview-Liste */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
            <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "#202F61", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 1rem" }} />
            Wird vorbereitet…
          </div>
        ) : (
          <>
            <div style={{ marginBottom: "1.5rem" }}>
              {(previewQuery.data ?? []).map((p) => {
                const item       = localItems.find((i) => i.teiltyp === p.teiltyp);
                const teilInfo   = STANDARD_TEILE.find((t) => t.id === p.teiltyp);
                const grOpt      = GRADING_OPTIONS.find((g) => g.value === item?.grading);
                const brauchtLager = p.istNeu && !p.lagerplatz;

                return (
                  <div key={p.teiltyp} style={{ marginBottom: 10, borderRadius: 12, border: `1px solid ${p.istNeu ? "rgba(0,139,210,0.3)" : "var(--border)"}`, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.9rem 1rem", background: p.istNeu ? "rgba(0,139,210,0.05)" : "var(--bg)" }}>
                      <span style={{ fontSize: "1.4rem" }}>{teilInfo?.icon ?? "🔧"}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                          {p.menge}× {teilInfo?.label ?? p.teiltyp}
                          {p.istNeu && (
                            <span style={{ marginLeft: 8, fontSize: "0.72rem", padding: "0.1rem 0.5rem", borderRadius: 5, background: "rgba(0,139,210,0.15)", color: "#008BD2", fontWeight: 700 }}>
                              ✨ Neu
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
                          {grOpt?.icon} {grOpt?.label} · Bestand: {p.aktuellerBestand} → <strong>{p.neuerBestand}</strong>
                        </div>
                      </div>
                      {p.lagerplatz && (
                        <span style={{ fontSize: "0.8rem", padding: "0.2rem 0.6rem", borderRadius: 6, background: "rgba(4,180,117,0.1)", color: "#038F5C", fontWeight: 700 }}>
                          📍 {p.lagerplatz}
                        </span>
                      )}
                    </div>

                    {/* Lagerplatz setzen für neue Teile */}
                    {p.istNeu && (
                      <div style={{ padding: "0.8rem 1rem", borderTop: "1px solid var(--border)", background: "var(--card-bg)" }}>
                        <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: 6, color: "var(--text)" }}>
                          📍 Wo kommt dieses Teil hin?
                          <span style={{ fontWeight: 400, color: "var(--text-dim)", marginLeft: 6 }}>(optional, aber empfohlen)</span>
                        </div>
                        {vorschlaegeQuery.isLoading ? (
                          <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>Vorschlag wird geladen…</div>
                        ) : (
                          <>
                            {vorschlaegeQuery.data?.[p.teiltyp] && !item?.lagerplatz && (
                              <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginBottom: 6 }}>
                                💡 Vorschlag: <strong>{vorschlaegeQuery.data[p.teiltyp]}</strong> (neben ähnlichen Teilen)
                              </div>
                            )}
                            <input
                              type="text"
                              value={item?.lagerplatz ?? ""}
                              onChange={(e) => setLagerplatz(p.teiltyp, e.target.value)}
                              placeholder="z.B. L-1-3-2"
                              style={{ ...S.input, minHeight: 44, fontSize: "1rem" }}
                              onFocus={(e)  => (e.currentTarget.style.borderColor = "#202F61")}
                              onBlur={(e)   => (e.currentTarget.style.borderColor = "var(--border)")}
                              aria-label={`Lagerplatz für ${teilInfo?.label ?? p.teiltyp}`}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Was passiert Info-Box */}
            <div style={{ background: "rgba(32,47,97,0.06)", border: "1px solid rgba(32,47,97,0.15)", borderRadius: 12, padding: "1.2rem", marginBottom: "1.5rem" }}>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", marginBottom: 8 }}>
                ❓ Was passiert wenn du auf &quot;Einbuchen&quot; klickst?
              </div>
              {[
                `✓ ${localItems.reduce((s, i) => s + i.menge, 0)} ${localItems.reduce((s, i) => s + i.menge, 0) === 1 ? "Teil kommt" : "Teile kommen"} ins Lager`,
                "✓ Du siehst wo du die Teile hinlegst",
                "✓ Techniker können die Teile ab sofort bestellen",
              ].map((line) => (
                <div key={line} style={{ fontSize: "0.9rem", color: "var(--text-dim)", marginTop: 4 }}>{line}</div>
              ))}
            </div>

            <button
              onClick={() => onEinbuchen(localItems)}
              disabled={!canSubmit}
              style={{ ...S.bigBtn("#04B475", !canSubmit), fontSize: "1.15rem", marginBottom: 10 }}
            >
              ✅ Jetzt einbuchen!
            </button>
            <button
              onClick={onBack}
              style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.95rem", width: "100%", padding: "0.5rem" }}
            >
              ← Doch nochmal ändern
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Step 4: Fertig + Einlager-Anweisungen ────────────────────────────────────

function StepFertig({
  ergebnisse,
  kuerzel,
  geraetName,
  onNochEins,
  onFertig,
}: {
  ergebnisse: ErgebnisItem[];
  kuerzel:    string;
  geraetName: string;
  onNochEins: () => void;
  onFertig:   () => void;
}) {
  const [eingelagert,  setEingelagert]  = useState<Record<number, boolean>>({});
  const [drucktEinzel, setDrucktEinzel] = useState<Record<number, boolean>>({});
  const alleEingelagert = ergebnisse.every((_, i) => eingelagert[i]);

  function toBelegData(item: ErgebnisItem): EinlagerBelegData {
    return {
      belegNr:            item.belegNr,
      artikelBezeichnung: item.artikelName,
      lagerplatz:         item.lagerplatz,
      kategorie:          item.kategorie,
      menge:              item.menge,
      neuerBestand:       item.neuerBestand,
      notiz:              item.notizText ?? item.grading,
      ersteller:          kuerzel,
      datum:              new Date(),
    };
  }

  async function handleAlleDrucken() {
    await printAlleEinlagerBelege(ergebnisse.map(toBelegData));
  }

  async function handleEinzelDrucken(idx: number) {
    setDrucktEinzel((prev) => ({ ...prev, [idx]: true }));
    await printEinlagerBeleg(toBelegData(ergebnisse[idx]));
    setDrucktEinzel((prev) => ({ ...prev, [idx]: false }));
  }

  return (
    <div style={{ maxWidth: 620, margin: "0 auto" }}>
      <div style={{ ...S.card, textAlign: "center" }}>
        <div style={{ fontSize: "4rem", marginBottom: "0.5rem" }}>🎉</div>
        <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 0.4rem", color: "var(--text)" }}>
          Geschafft!
        </h1>
        <p style={{ margin: "0 0 1.5rem", color: "var(--text-dim)", fontSize: "1rem" }}>
          {ergebnisse.reduce((s, e) => s + e.menge, 0)} {ergebnisse.reduce((s, e) => s + e.menge, 0) === 1 ? "Teil wurde" : "Teile wurden"} eingebucht.
        </p>

        <div style={{ width: 48, height: 3, margin: "0 auto 1.5rem", borderRadius: 2, background: "linear-gradient(90deg, #008BD2, #04B475)" }} />

        {/* Etiketten drucken */}
        <div style={{ textAlign: "left", marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: 10 }}>
            1️⃣ Drucke die Etiketten
          </div>
          <button
            onClick={handleAlleDrucken}
            style={{ ...S.bigBtn("#202F61"), marginBottom: 12 }}
          >
            🖨️ Alle {ergebnisse.length} Etiketten drucken
          </button>

          {/* Beleg-Vorschauen */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ergebnisse.map((item, idx) => (
              <div key={item.buchungId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0.7rem 1rem", background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)" }}>
                <div style={{ flexShrink: 0, transform: "scale(0.55)", transformOrigin: "left center", width: 130, height: 52, overflow: "hidden" }}>
                  <EinlagerBelegPreview data={toBelegData(item)} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>{item.belegNr}</div>
                </div>
                <button
                  onClick={() => handleEinzelDrucken(idx)}
                  disabled={drucktEinzel[idx]}
                  style={{ flexShrink: 0, padding: "0.4rem 0.8rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap" }}
                >
                  {drucktEinzel[idx] ? "⏳" : "🖨️ Einzeln"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Einlager-Anweisungen */}
        <div style={{ textAlign: "left", marginBottom: "2rem" }}>
          <div style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: 12 }}>
            2️⃣ Lege die Teile an diese Plätze:
          </div>

          {ergebnisse.map((item, idx) => (
            <div
              key={item.buchungId}
              style={{
                display:      "flex",
                gap:          12,
                padding:      "1rem",
                marginBottom: 8,
                borderRadius: 12,
                border:       `1px solid ${eingelagert[idx] ? "rgba(4,180,117,0.4)" : "var(--border)"}`,
                background:   eingelagert[idx] ? "rgba(4,180,117,0.05)" : "var(--card-bg)",
                transition:   "all 0.2s",
                alignItems:   "flex-start",
              }}
            >
              <span style={{ fontSize: "1.8rem", flexShrink: 0 }}>{item.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 4 }}>
                  {item.menge}× {item.label}
                  {item.artikelName !== item.teiltyp && (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginLeft: 6 }}>
                      ({item.artikelName})
                    </span>
                  )}
                </div>
                {item.lagerplatz ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>Lege hier hin:</span>
                    <span style={{
                      display:      "inline-block",
                      padding:      "0.25rem 0.8rem",
                      borderRadius: 8,
                      background:   "#202F61",
                      color:        "white",
                      fontWeight:   900,
                      fontSize:     "1rem",
                      letterSpacing: 1,
                    }}>
                      {item.lagerplatz}
                    </span>
                  </div>
                ) : (
                  <div style={{ fontSize: "0.8rem", color: "#f7b928", marginBottom: 6 }}>
                    ⚠️ Kein Lagerplatz vergeben — bitte manuell zuweisen
                  </div>
                )}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={!!eingelagert[idx]}
                  onChange={(e) => setEingelagert((prev) => ({ ...prev, [idx]: e.target.checked }))}
                  style={{ width: 20, height: 20, cursor: "pointer" }}
                  aria-label={`${item.label} als eingelagert markieren`}
                />
                <span style={{ fontSize: "0.85rem", color: eingelagert[idx] ? "#04B475" : "var(--text-dim)", fontWeight: 600 }}>
                  {eingelagert[idx] ? "✓ Eingelagert" : "Eingelagert?"}
                </span>
              </label>
            </div>
          ))}

          {alleEingelagert && ergebnisse.length > 0 && (
            <div style={{ textAlign: "center", padding: "0.8rem", background: "rgba(4,180,117,0.1)", borderRadius: 10, border: "1px solid rgba(4,180,117,0.3)", marginTop: 4 }}>
              <span style={{ color: "#04B475", fontWeight: 800 }}>✅ Alles eingelagert — super gemacht!</span>
            </div>
          )}
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onNochEins}
            style={{ flex: 1, minHeight: 60, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontWeight: 700, fontSize: "0.95rem" }}
          >
            📦 Noch ein Gerät
          </button>
          <button
            onClick={onFertig}
            style={{ ...S.bigBtn("#04B475"), flex: 2 }}
          >
            ✅ Alles fertig!
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Haupt-Wizard ──────────────────────────────────────────────────────────────

export default function EinlagernPage() {
  const router  = useRouter();
  const { show } = useToast();
  const { data: session } = useSession();

  const [step,       setStep]       = useState<WizardStep>(0);
  const [geraet,     setGeraet]     = useState<GeraetState | null>(null);
  const [items,      setItems]      = useState<AusgewaehltItem[]>([]);
  const [ergebnisse, setErgebnisse] = useState<ErgebnisItem[]>([]);

  const kuerzel = (session?.user as { kuerzel?: string } | undefined)?.kuerzel ?? "";

  const executeMutation = api.einlagern.execute.useMutation({
    onSuccess: (data) => {
      const results: ErgebnisItem[] = data.map((r) => {
        const teilInfo = STANDARD_TEILE.find((t) => t.id === r.teiltyp);
        return {
          teiltyp:      r.teiltyp,
          icon:         teilInfo?.icon  ?? "🔧",
          label:        teilInfo?.label ?? r.teiltyp,
          artikelName:  r.artikelName,
          kategorie:    r.kategorie,
          lagerplatz:   r.lagerplatz,
          menge:        r.menge,
          buchungId:    r.buchungId,
          belegNr:      r.belegNr,
          neuerBestand: r.neuerBestand,
          grading:      r.grading,
          notizText:    r.notizText,
          eingelagert:  false,
        };
      });
      setErgebnisse(results);
      setStep(4);
      show(`✅ ${data.length} ${data.length === 1 ? "Teil" : "Teile"} eingebucht!`, "success");
    },
    onError: (e) => {
      show(`Fehler beim Einbuchen: ${e.message}`, "error");
    },
  });

  function handleEinbuchen(finalItems: AusgewaehltItem[]) {
    if (!geraet || finalItems.length === 0) return;
    executeMutation.mutate({
      geraetName: geraet.name,
      logId:      geraet.logId ?? undefined,
      items:      finalItems.map((i) => ({
        teiltyp:    i.teiltyp,
        menge:      i.menge,
        grading:    i.grading,
        notiz:      i.notiz || undefined,
        lagerplatz: i.lagerplatz || undefined,
      })),
    });
  }

  function resetWizard() {
    setGeraet(null);
    setItems([]);
    setErgebnisse([]);
    setStep(1);
  }

  // Loading overlay während execute läuft
  if (executeMutation.isPending) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 }}>
        <div style={{ width: 56, height: 56, border: "4px solid var(--border)", borderTopColor: "#04B475", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>Wird eingebucht…</div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.9rem" }}>Bitte warte kurz.</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "60vh" }}>
      {step === 0 && (
        <StepWillkommen onStart={() => setStep(1)} />
      )}

      {step === 1 && (
        <StepGeraet
          initial={geraet}
          onBack={() => setStep(0)}
          onWeiter={(g) => { setGeraet(g); setStep(2); }}
        />
      )}

      {step === 2 && geraet && (
        <StepTeile
          geraet={geraet}
          items={items}
          onBack={() => setStep(1)}
          onWeiter={() => setStep(3)}
          onItemsChange={setItems}
        />
      )}

      {step === 3 && geraet && items.length > 0 && (
        <StepBestaetigung
          geraet={geraet}
          items={items}
          onBack={() => setStep(2)}
          onEinbuchen={handleEinbuchen}
        />
      )}

      {step === 4 && (
        <StepFertig
          ergebnisse={ergebnisse}
          kuerzel={kuerzel}
          geraetName={geraet?.name ?? ""}
          onNochEins={resetWizard}
          onFertig={() => router.push("/admin")}
        />
      )}
    </div>
  );
}
