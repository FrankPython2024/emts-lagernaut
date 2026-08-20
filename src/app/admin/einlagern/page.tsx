"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter }    from "next/navigation";
import { useSession }   from "next-auth/react";
import { api }          from "@/trpc/react";
import { useToast }     from "@/components/ui/Toast";
import { TeilenummerFeld } from "@/components/TeilenummerFeld";
import { StepLosesTeil }   from "./StepLosesTeil";
import { StepFotoErkennen, type ErkanntesTeil } from "./StepFotoErkennen";
import { STANDARD_TEILE, GRADING_OPTIONS } from "@/modules/einlagern/constants";
import { useStandortFilter } from "@/lib/standort/standortContext";
import {
  HERKUNFT_ARTEN, HERKUNFT_LABEL, HERKUNFT_ICON, HERKUNFT_HILFE,
  type HerkunftArt,
} from "@/lib/einlagern/herkunft";
import {
  DT_ART, DT_GROESSE, DT_SCHNITTSTELLE, DT_BAUFORM,
  RAM_GROESSE, RAM_GENERATION, RAM_BAUFORM,
  bezeichnungDatentraeger, bezeichnungRam,
} from "@/lib/einlagern/komponenten";
import {
  printAlleEinlagerBelege,
  printEinlagerBeleg,
  EinlagerBelegPreview,
  type EinlagerBelegData,
} from "@/components/ui/EinlagerBeleg";

// ── Types ─────────────────────────────────────────────────────────────────────

// 6 = Datentraeger/RAM erfassen (eigener Weg, nicht geraetegebunden)
// 0 Willkommen · 1–5 der Weg über das Spendergerät · 6 Datenträger/RAM ·
// 7 einzelnes Teil ohne Gerät. 6 und 7 sind eigenständige Zweige, keine
// Zwischenschritte — deshalb hinten angehängt statt einsortiert.
// 8 = Foto-Erkennung, muendet in 7 (Erfassung ohne Geraet).
type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

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
  verschiedenesText?: string;
  // Aufgedruckte Teilenummer. Optional — wer nichts scannen kann, lagert wie
  // bisher ein. Ist sie gesetzt, bestimmt sie serverseitig den Artikel.
  teilenummer?: string;
};

type ErgebnisItem = {
  teiltyp:       string;
  icon:          string;
  label:         string;
  artikelName:   string;
  kategorie:     string;
  lagerplatz:    string | null;
  etlLagerplatz?: string;
  menge:         number;
  buchungId:     number;
  belegNr:       string;
  neuerBestand:  number;
  grading:       string;
  notizText:     string | undefined;
  eingelagert:   boolean;
};

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function gradingFarbe(g?: string): string {
  switch (g) {
    case "A+": return "var(--afb-green)";
    case "A":  return "var(--afb-green)";
    case "B":  return "var(--afb-blue)";
    case "C":  return "#F59E0B";
    default:   return "#94A3B8";
  }
}

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
    padding:        "0.75rem 0.6rem",
    minHeight:      44,
    borderRadius:   8,
  } satisfies React.CSSProperties,

  input: {
    width:        "100%",
    minHeight:    60,
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
                background:     done ? "var(--afb-green)" : active ? "var(--afb-navy)" : "var(--border)",
                transition:     "all 0.3s",
                flexShrink:     0,
              }} />
              {done && (
                <span style={{ fontSize: "0.8rem", color: "var(--afb-green)", fontWeight: 800 }}>✓</span>
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
  const [freitext, setFreitext] = useState(initial.verschiedenesText ?? "");
  const [teilenummer, setTeilenummer] = useState(initial.teilenummer ?? "");
  const freitextRef = useRef<HTMLInputElement>(null);

  const istVerschiedenes = teil.istVerschiedenes;
  const freitextOk       = !istVerschiedenes || freitext.trim().length >= 2;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Bei Verschiedenes direkt ins Freitext-Feld springen
  useEffect(() => {
    if (istVerschiedenes) freitextRef.current?.focus();
  }, [istVerschiedenes]);

  // Menge frei eingebbar (3D-Druck liefert oft große Stückzahlen). Cap 9999 =
  // Server-Limit; Warnhinweis erst bei ungewöhnlich hohen Werten (Tippfehler-Schutz).
  function setMengeSicher(n: number) {
    const clamped = Math.max(1, Math.min(9999, Number.isFinite(n) ? n : 1));
    setWarn(clamped > 50);
    setMenge(clamped);
  }
  function changeMenge(delta: number) {
    setMengeSicher(menge + delta);
  }
  function onMengeInput(raw: string) {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 4);
    if (digits === "") { setMenge(0); setWarn(false); return; } // transient leer; Blur setzt auf 1
    const n = Math.min(9999, parseInt(digits, 10));
    setMenge(n);
    setWarn(n > 50);
  }

  function handleSave() {
    if (!grading || !freitextOk) return;
    const ft = freitext.trim();
    onSave({
      teiltyp:    teil.id,
      label:      istVerschiedenes && ft ? `${teil.label} — ${ft}` : teil.label,
      icon:       teil.icon,
      menge:      Math.max(1, Math.min(9999, menge)),
      grading,
      notiz,
      lagerplatz: initial.lagerplatz ?? "",
      ...(teilenummer.trim() ? { teilenummer: teilenummer.trim() } : {}),
      ...(istVerschiedenes ? { verschiedenesText: ft } : {}),
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

          {/* Freitext — nur bei Verschiedenes */}
          {istVerschiedenes && (
            <div style={{ marginBottom: "1.5rem" }}>
              <label htmlFor="verschiedenes-freitext" style={{ display: "block", fontWeight: 800, marginBottom: 10, fontSize: "1rem" }}>
                ❓ Was genau? <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="verschiedenes-freitext"
                ref={freitextRef}
                type="text"
                value={freitext}
                onChange={(e) => setFreitext(e.target.value)}
                placeholder='z.B. "Schraubenset" oder "Abdeckungen"'
                maxLength={100}
                style={{ ...S.input, minHeight: 56 }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--afb-navy)")}
                onBlur={(e)  => (e.currentTarget.style.borderColor = "var(--border)")}
                aria-label="Freitext für Verschiedenes-Artikel"
              />
              {!freitextOk && (
                <div style={{ fontSize: "0.8rem", color: "#f7b928", fontWeight: 600, marginTop: 6 }}>
                  Bitte mindestens 2 Zeichen eingeben.
                </div>
              )}
            </div>
          )}

          {/* Teilenummer — steht bewusst ganz oben: Das Teil ist gerade in der
              Hand, da wird gescannt, bevor irgendetwas ausgewählt wird. */}
          <div style={{ marginBottom: "1.5rem" }}>
            <TeilenummerFeld wert={teilenummer} onChange={setTeilenummer} />
          </div>

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
                      border:        `2px solid ${sel ? "var(--afb-navy)" : "var(--border)"}`,
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
                    {sel && <span style={{ color: "var(--afb-navy)", fontWeight: 800, fontSize: "1.1rem" }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Menge */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 800, marginBottom: 10, fontSize: "1rem" }}>
              ❓ Wie viele Stück? <span style={{ fontWeight: 400, color: "var(--text-dim)", fontSize: "0.85rem" }}>(Zahl direkt eintippbar)</span>
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
              <input
                type="text"
                inputMode="numeric"
                value={menge === 0 ? "" : menge}
                onChange={(e) => onMengeInput(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => setMengeSicher(menge || 1)}
                aria-label="Stückzahl (frei eingebbar)"
                style={{
                  width: 130, height: 60, textAlign: "center",
                  fontSize: "2.5rem", fontWeight: 900, color: "var(--text)",
                  background: "var(--bg)", border: "2px solid var(--border)", borderRadius: 12,
                  fontFamily: "'Ubuntu', sans-serif", outline: "none",
                }}
                onFocusCapture={(e) => (e.currentTarget.style.borderColor = "var(--afb-navy)")}
                onBlurCapture={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
              />
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
              onFocus={(e)  => (e.currentTarget.style.borderColor = "var(--afb-navy)")}
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
              disabled={!grading || !freitextOk}
              style={{ ...S.bigBtn("var(--afb-green)", !grading || !freitextOk), flex: 2 }}
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

function StepWillkommen({ onStart, onKomponenten, onLosesTeil, onFoto }: { onStart: () => void; onKomponenten: () => void; onLosesTeil: () => void; onFoto?: () => void }) {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <div style={{ ...S.card, textAlign: "center" }}>
        <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>📦</div>
        <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 0.4rem", color: "var(--text)" }}>
          Teile einlagern
        </h1>
        <p style={{ fontSize: "0.95rem", color: "var(--afb-blue)", fontWeight: 700, margin: "0 0 1.5rem", textTransform: "uppercase", letterSpacing: 1 }}>
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
          style={{ ...S.bigBtn("var(--afb-green)"), fontSize: "1.2rem" }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
        >
          Los geht&apos;s! →
        </button>

        {/* Zweiter Weg: Datenträger und Arbeitsspeicher sind nicht geräte-
            gebunden, sie werden kartonweise gezählt. Deshalb ein eigener
            Einstieg statt eines Umwegs über die Geräte-Erkennung. */}
        <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginBottom: "0.8rem" }}>
            Du hast Festplatten oder Arbeitsspeicher zu erfassen, die nicht aus einem
            bestimmten Gerät stammen?
          </div>
          <button
            onClick={onKomponenten}
            style={{ ...S.bigBtn("var(--afb-blue)"), fontSize: "1.05rem" }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
          >
            💾 Datenträger &amp; Arbeitsspeicher erfassen
          </button>
        </div>

        {/* Weg B: Es liegt nur das Teil da, keine LogID. Kommt bei Teilen aus
            Kisten und Lieferungen vor und war bisher gar nicht vorgesehen —
            der Assistent verlangte immer ein Gerät. */}
        <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginBottom: "0.8rem" }}>
            Du hast nur das Ersatzteil, ohne Gerät und ohne LogID?
          </div>
          <button
            onClick={onLosesTeil}
            style={{ ...S.bigBtn("var(--afb-green)"), fontSize: "1.05rem" }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
          >
            🔩 Einzelnes Teil ohne Gerät
          </button>

          {/* Erscheint nur, wenn die Bilderkennung eingerichtet ist. Ohne
              Schluessel waere der Knopf ein Versprechen, das niemand einloest. */}
          {onFoto && (
            <button
              onClick={onFoto}
              style={{ ...S.bigBtn("var(--afb-blue)"), fontSize: "1.05rem", marginTop: "0.8rem" }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
            >
              📷 Ersatzteil erkennen lassen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Datenträger & Arbeitsspeicher erfassen ───────────────────────────────────
// Eigener Weg neben dem Ernten aus einem Spendergerät. Merkmale werden gewählt,
// nicht getippt: Die Bezeichnung entsteht daraus zentral und immer gleich, damit
// nicht wieder Schreibvarianten desselben Artikels entstehen.

type KompZeile = {
  id:            number;
  art:           "DATENTRAEGER" | "RAM";
  typ:           string;   // SSD | HDD (nur Datenträger)
  groesse:       string;
  schnittstelle: string;   // nur Datenträger
  generation:    string;   // nur RAM
  bauform:       string;
  menge:         string;
  lagerplatz:    string;
};

function leereZeile(art: "DATENTRAEGER" | "RAM", id: number): KompZeile {
  return art === "DATENTRAEGER"
    ? { id, art, typ: "SSD", groesse: "512 GB", schnittstelle: "NVMe PCIe3", generation: "", bauform: "M.2 2280", menge: "", lagerplatz: "" }
    : { id, art, typ: "",    groesse: "8 GB",   schnittstelle: "",           generation: "DDR4", bauform: "SO-DIMM", menge: "", lagerplatz: "" };
}

type KompErgebnis = {
  bezeichnung: string; menge: number; neuerBestand: number;
  neuAngelegt: boolean; lagerplatz: string | null;
};

function StepKomponenten({ standortId, onBack }: {
  standortId: number;
  onBack:     () => void;
}) {
  const { show } = useToast();
  const [zeilen, setZeilen] = useState<KompZeile[]>([leereZeile("DATENTRAEGER", 1)]);
  const [ergebnis, setErgebnis] = useState<KompErgebnis[] | null>(null);
  const naechsteId = useRef(2);

  const erfassen = api.einlagern.erfasseKomponenten.useMutation({
    onSuccess: (r) => setErgebnis(r),
    onError:   (e) => show(e.message, "error"),
  });

  // ── Ergebnis nach dem Buchen ───────────────────────────────────────────────
  if (ergebnis) {
    const neue = ergebnis.filter((e) => e.neuAngelegt).length;
    return (
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{ ...S.card, textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>✅</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "0 0 0.4rem", color: "var(--text)" }}>
            Eingebucht
          </h2>
          <p style={{ color: "var(--text-dim)", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
            {ergebnis.reduce((s, e) => s + e.menge, 0)} Stück in {ergebnis.length}{" "}
            {ergebnis.length === 1 ? "Sorte" : "Sorten"}
            {neue > 0 && <> · {neue} {neue === 1 ? "Artikel" : "Artikel"} neu angelegt</>}
          </p>

          <div style={{ textAlign: "left", marginBottom: "1.5rem" }}>
            {ergebnis.map((e) => (
              <div key={e.bezeichnung} style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10,
                padding: "0.7rem 0.9rem", marginBottom: 6, borderRadius: 10,
                border: "1px solid var(--border)", background: "var(--bg)",
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text)" }}>
                    {e.bezeichnung}
                    {e.neuAngelegt && (
                      <span style={{ marginLeft: 6, fontSize: "0.72rem", fontWeight: 700, color: "var(--afb-blue)" }}>NEU</span>
                    )}
                  </div>
                  {e.lagerplatz && (
                    <div style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>📍 {e.lagerplatz}</div>
                  )}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontWeight: 800, color: "var(--afb-green, #04B475)" }}>+{e.menge}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>Bestand {e.neuerBestand}</div>
                </div>
              </div>
            ))}
          </div>

          {ergebnis.some((e) => e.neuAngelegt) && (
            <p style={{ fontSize: "0.82rem", color: "var(--text-dim)", marginBottom: "1.2rem" }}>
              Neu angelegte Artikel haben noch keinen Preis. Den trägst du unter
              Artikel ein, sonst fehlen sie später in der Wertauswertung.
            </p>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => { setErgebnis(null); setZeilen([leereZeile("DATENTRAEGER", naechsteId.current++)]); }}
              style={{ ...S.bigBtn("var(--afb-blue)"), flex: "1 1 200px" }}>
              Weitere erfassen
            </button>
            <button onClick={onBack}
              style={{ flex: "1 1 160px", minHeight: 56, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-dim)", cursor: "pointer", fontWeight: 700 }}>
              Fertig
            </button>
          </div>
        </div>
      </div>
    );
  }

  function aendern(id: number, feld: keyof KompZeile, wert: string) {
    setZeilen((z) => z.map((r) => (r.id === id ? { ...r, [feld]: wert } : r)));
  }
  function hinzufuegen(art: "DATENTRAEGER" | "RAM") {
    setZeilen((z) => [...z, leereZeile(art, naechsteId.current++)]);
  }
  function entfernen(id: number) {
    setZeilen((z) => (z.length > 1 ? z.filter((r) => r.id !== id) : z));
  }

  // Vorschau der Bezeichnung, damit vor dem Buchen sichtbar ist, was entsteht.
  const vorschau = (r: KompZeile) => r.art === "DATENTRAEGER"
    ? bezeichnungDatentraeger({ art: r.typ, groesse: r.groesse, schnittstelle: r.schnittstelle, bauform: r.bauform })
    : bezeichnungRam({ groesse: r.groesse, generation: r.generation, bauform: r.bauform });

  const gueltig = zeilen.filter((r) => Number(r.menge) > 0);
  const gesamtStueck = gueltig.reduce((s, r) => s + Number(r.menge), 0);

  const feld: React.CSSProperties = {
    ...S.input, minHeight: 48, fontSize: "0.95rem", padding: "0.5rem 0.6rem",
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
        <button onClick={onBack} style={S.backBtn}>← Zurück</button>
      </div>

      <div style={S.card}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "0 0 0.4rem", color: "var(--text)" }}>
          💾 Datenträger &amp; Arbeitsspeicher erfassen
        </h2>
        <p style={{ color: "var(--text-dim)", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
          Eine Zeile je Sorte. Die Bezeichnung entsteht automatisch aus den Merkmalen,
          damit nicht zweimal derselbe Artikel unter verschiedenen Namen angelegt wird.
          Preise werden separat am Artikel gepflegt.
        </p>

        {zeilen.map((r) => (
          <div key={r.id} style={{
            border: "1px solid var(--border)", borderRadius: 12,
            padding: "0.9rem 1rem", marginBottom: 10, background: "var(--bg)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--afb-navy, #202F61)" }}>
                {vorschau(r) || "…"}
              </div>
              {zeilen.length > 1 && (
                <button onClick={() => entfernen(r.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "var(--text-dim)" }}
                  aria-label="Zeile entfernen">✕</button>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
              {r.art === "DATENTRAEGER" ? (
                <>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>Art
                    <select value={r.typ} onChange={(e) => aendern(r.id, "typ", e.target.value)} style={feld}>
                      {DT_ART.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>Größe
                    <select value={r.groesse} onChange={(e) => aendern(r.id, "groesse", e.target.value)} style={feld}>
                      {DT_GROESSE.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>Schnittstelle
                    <select value={r.schnittstelle} onChange={(e) => aendern(r.id, "schnittstelle", e.target.value)} style={feld}>
                      {DT_SCHNITTSTELLE.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>Bauform
                    <select value={r.bauform} onChange={(e) => aendern(r.id, "bauform", e.target.value)} style={feld}>
                      {DT_BAUFORM.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>Größe
                    <select value={r.groesse} onChange={(e) => aendern(r.id, "groesse", e.target.value)} style={feld}>
                      {RAM_GROESSE.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>Generation
                    <select value={r.generation} onChange={(e) => aendern(r.id, "generation", e.target.value)} style={feld}>
                      {RAM_GENERATION.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>Bauform
                    <select value={r.bauform} onChange={(e) => aendern(r.id, "bauform", e.target.value)} style={feld}>
                      {RAM_BAUFORM.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                </>
              )}

              <label style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>Anzahl *
                <input type="number" min={1} inputMode="numeric" value={r.menge}
                  onChange={(e) => aendern(r.id, "menge", e.target.value)}
                  placeholder="z.B. 240" style={{ ...feld, fontWeight: 800 }} />
              </label>
              <label style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>Lagerplatz
                <input type="text" value={r.lagerplatz}
                  onChange={(e) => aendern(r.id, "lagerplatz", e.target.value)}
                  placeholder="optional" style={feld} />
              </label>
            </div>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "1.2rem" }}>
          <button onClick={() => hinzufuegen("DATENTRAEGER")}
            style={{ flex: "1 1 200px", minHeight: 52, borderRadius: 10, border: "1px dashed var(--border)", background: "var(--card-bg)", color: "var(--text)", cursor: "pointer", fontWeight: 700 }}>
            + Datenträger
          </button>
          <button onClick={() => hinzufuegen("RAM")}
            style={{ flex: "1 1 200px", minHeight: 52, borderRadius: 10, border: "1px dashed var(--border)", background: "var(--card-bg)", color: "var(--text)", cursor: "pointer", fontWeight: 700 }}>
            + Arbeitsspeicher
          </button>
        </div>

        <button
          onClick={() => erfassen.mutate({
            standortId,
            zeilen: gueltig.map((r) => r.art === "DATENTRAEGER"
              ? { art: "DATENTRAEGER" as const, typ: r.typ, groesse: r.groesse, schnittstelle: r.schnittstelle, bauform: r.bauform, menge: Number(r.menge), lagerplatz: r.lagerplatz.trim() || null }
              : { art: "RAM" as const, groesse: r.groesse, generation: r.generation, bauform: r.bauform, menge: Number(r.menge), lagerplatz: r.lagerplatz.trim() || null }),
          })}
          disabled={gueltig.length === 0 || erfassen.isPending}
          style={{ ...S.bigBtn("var(--afb-green)"), opacity: gueltig.length === 0 || erfassen.isPending ? 0.5 : 1 }}
        >
          {erfassen.isPending
            ? "Wird gebucht…"
            : `${gueltig.length} ${gueltig.length === 1 ? "Sorte" : "Sorten"} einbuchen (${gesamtStueck} Stück)`}
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
  standortId,
}: {
  onBack:     () => void;
  onWeiter:   (g: GeraetState) => void;
  initial:    GeraetState | null;
  standortId: number;
}) {
  const { show }  = useToast();
  const inputRef  = useRef<HTMLInputElement>(null);
  const [query,   setQuery]   = useState(initial ? "" : "");
  const [suchQ,   setSuchQ]   = useState<string | null>(null);
  const [manName, setManName] = useState("");
  const [modus,   setModus]   = useState<"suche" | "gefunden" | "nichtGefunden" | "manuell">(
    initial ? "gefunden" : "suche",
  );
  const [gefunden,    setGefunden]    = useState<GeraetState | null>(initial);
  const [prüfModal,   setPrüfModal]   = useState<{
    geraet:    GeraetState;
    sauber:    string;
    aehnliche: Array<{ id: number; modell: string; hersteller: string; inaktiv: boolean; deaktiviertGrund?: string | null }>;
    lädt:      boolean;
  } | null>(null);

  const modellLookup = api.modell.lookup.useMutation();

  async function weiterMitPrüfung(geraet: GeraetState) {
    const herstellerRoh = geraet.name.split(" ")[0] ?? "";
    const BEKANNTE: readonly string[] = ["HP", "Lenovo", "Dell", "Fujitsu"];
    // Nur prüfen wenn Hersteller sicher erkennbar
    const hersteller = BEKANNTE.find((h) =>
      geraet.name.toLowerCase().startsWith(h.toLowerCase()) ||
      herstellerRoh.toLowerCase() === h.toLowerCase(),
    );

    if (!hersteller) {
      onWeiter(geraet);
      return;
    }

    try {
      const result = await modellLookup.mutateAsync({
        bezeichnung:     geraet.name,
        hersteller:      hersteller as "HP" | "Lenovo" | "Dell" | "Fujitsu",
        adminBestaetigt: false,
      });

      if (result.fehler) {
        // Nicht-Portfolio-Hersteller (Apple, ASUS etc.) — klare Meldung
        show(`⚠️ ${result.fehler}`, "error");
        return;
      }

      if (result.istUnsicher && result.aehnliche.length > 0) {
        const sauber = result.modell?.modell ?? geraet.name;
        setPrüfModal({ geraet, sauber, aehnliche: result.aehnliche, lädt: false });
      } else {
        onWeiter(geraet);
      }
    } catch {
      // Netzwerk-/Server-Fehler: kein Blocker, Wizard weiterführen
      onWeiter(geraet);
    }
  }

  const sucheQuery = api.einlagern.geraetSuchen.useQuery(
    { query: suchQ ?? "" },
    { enabled: !!suchQ, retry: false, staleTime: 0 },
  );

  // Früh-Prüfung (rein lesend): liegt dieses Modell schon im Regal? Nur Vorschau —
  // die eigentliche Zuweisung passiert weiterhin in Step 2.
  const regalQuery = api.einlagern.modellImRegal.useQuery(
    { geraetName: gefunden?.name ?? "", logId: gefunden?.logId ?? undefined },
    { enabled: modus === "gefunden" && !!gefunden, staleTime: 0 },
  );
  const regal           = regalQuery.data;
  const regalAndererOrt = !!regal?.imRegal && regal.standortId != null && regal.standortId !== standortId;

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

      <WizardProgress current={1} total={4} />

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
                onFocus={(e)  => (e.currentTarget.style.borderColor = "var(--afb-navy)")}
                aria-label="Geräte-Nummer oder LogID eingeben"
              />
              <button
                onClick={handleSuchen}
                disabled={!query.trim() || sucheQuery.isFetching}
                style={{ ...S.bigBtn("var(--afb-navy)", !query.trim() || sucheQuery.isFetching), width: "auto", padding: "0 1.5rem" }}
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
                  onFocus={(e)  => (e.currentTarget.style.borderColor = "var(--afb-navy)")}
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
                      void weiterMitPrüfung({ name: manName.trim(), logId: null, typ: "manuell" });
                    }}
                    disabled={!manName.trim() || modellLookup.isPending}
                    style={{ ...S.bigBtn("var(--afb-blue)", !manName.trim() || modellLookup.isPending), flex: 2 }}
                  >
                    {modellLookup.isPending ? "Prüfe…" : "Mit diesem Namen weiter →"}
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
              onFocus={(e)  => (e.currentTarget.style.borderColor = "var(--afb-navy)")}
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
                style={{ ...S.bigBtn("var(--afb-navy)", !query.trim() || sucheQuery.isFetching), flex: 2 }}
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
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "var(--afb-navy)", marginBottom: gefunden.logId ? 4 : 0 }}>
                {gefunden.name}
              </div>
              {gefunden.logId && (
                <div style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
                  Nummer: {gefunden.logId}
                </div>
              )}
            </div>

            {/* Früh-Hinweis: Modell schon im Regal? (rein lesend, nur Vorschau) */}
            {regalQuery.isLoading && (
              <div style={{ textAlign: "center", color: "var(--text-dim)", fontSize: "0.95rem", marginBottom: 16 }}>
                Regal wird geprüft…
              </div>
            )}
            {regal && (
              regal.imRegal ? (
                <div
                  role="status"
                  style={{ background: "rgba(0,139,210,0.1)", border: "1px solid rgba(0,139,210,0.45)", borderRadius: 14, padding: "1.1rem 1.25rem", marginBottom: 16 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: "1.1rem", color: "var(--afb-navy)", marginBottom: 6 }}>
                    <span aria-hidden style={{ fontSize: "1.6rem" }}>📦</span>
                    Modell liegt schon im Regal
                  </div>
                  <div style={{ fontSize: "1rem", lineHeight: 1.5 }}>
                    <strong>{gefunden.name}</strong> liegt in Fach{" "}
                    <strong style={{ color: "var(--afb-navy)" }}>{regal.fachCode}</strong>
                    {regalAndererOrt && regal.standortName && (
                      <> · <strong>Standort {regal.standortName}</strong></>
                    )}
                    .<br />→ Du kannst die Teile direkt <strong>dazubuchen</strong>.
                  </div>
                  {regalAndererOrt && (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, background: "rgba(247,185,40,0.15)", border: "1px solid rgba(247,185,40,0.5)", borderRadius: 10, padding: "0.7rem 0.9rem", fontSize: "0.95rem", fontWeight: 700, color: "var(--text)" }}
                    >
                      <span aria-hidden style={{ fontSize: "1.3rem" }}>⚠️</span>
                      Achtung: liegt an <strong>Standort {regal.standortName}</strong> — nicht im aktuellen Lager!
                    </div>
                  )}
                </div>
              ) : (
                <div
                  role="status"
                  style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(101,103,107,0.1)", border: "1px solid var(--border)", borderRadius: 14, padding: "1.1rem 1.25rem", marginBottom: 16 }}
                >
                  <span aria-hidden style={{ fontSize: "1.6rem" }}>🆕</span>
                  <div style={{ fontSize: "1rem", lineHeight: 1.5 }}>
                    <strong>Neues Modell</strong> — die Zuordnung im Regal beginnt im nächsten Schritt.
                  </div>
                </div>
              )
            )}

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
                onClick={() => void weiterMitPrüfung(gefunden)}
                disabled={modellLookup.isPending}
                style={{ ...S.bigBtn("var(--afb-green)", modellLookup.isPending), flex: 2 }}
              >
                {modellLookup.isPending
                  ? "Prüfe…"
                  : regal?.imRegal
                    ? "✅ Teile dazubuchen →"
                    : "✅ Zuordnung beginnen →"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Duplikat-Schutz: Ähnliche Modelle gefunden */}
      {prüfModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setPrüfModal(null)}
        >
          <div
            style={{ background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.35)", width: "100%", maxWidth: 480, color: "var(--text)", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Ähnliche Modelle gefunden"
          >
            <div style={{ padding: "1.2rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: 4 }}>
                ⚠️ Ähnliche Modelle gefunden
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
                Meinst du eins dieser Modelle?
              </div>
            </div>

            <div style={{ padding: "1rem 1.5rem" }}>
              <div style={{ marginBottom: "1rem" }}>
                {prüfModal.aehnliche.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { setPrüfModal(null); onWeiter({ ...prüfModal.geraet, name: `${a.hersteller} ${a.modell}` }); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "0.8rem 1rem", marginBottom: 6, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.95rem", fontWeight: 600, transition: "background 0.15s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(32,47,97,0.08)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg)")}
                  >
                    ✓ {a.hersteller} {a.modell}
                  </button>
                ))}
              </div>

              <div style={{ background: "rgba(247,185,40,0.1)", border: "1px solid rgba(247,185,40,0.4)", borderRadius: 10, padding: "0.8rem 1rem", marginBottom: "1rem", fontSize: "0.85rem", color: "var(--text-dim)" }}>
                Eingabe: <strong style={{ color: "var(--text)" }}>{prüfModal.geraet.name}</strong><br />
                Bereinigt: <strong style={{ color: "var(--text)" }}>{prüfModal.sauber}</strong>
              </div>

              <button
                onClick={() => {
                  const herst = prüfModal.aehnliche[0]?.hersteller ?? "";
                  const h = herst as "HP" | "Lenovo" | "Dell" | "Fujitsu";
                  setPrüfModal((prev) => prev ? { ...prev, lädt: true } : null);
                  modellLookup.mutate(
                    { bezeichnung: prüfModal.geraet.name, hersteller: h, adminBestaetigt: true },
                    { onSettled: () => { setPrüfModal(null); onWeiter(prüfModal.geraet); } },
                  );
                }}
                disabled={prüfModal.lädt || modellLookup.isPending}
                style={{ ...S.bigBtn("#fa3e3e", prüfModal.lädt || modellLookup.isPending), fontSize: "0.95rem" }}
              >
                {prüfModal.lädt ? "Wird angelegt…" : "⚠️ Trotzdem neues Modell anlegen"}
              </button>

              <button
                onClick={() => setPrüfModal(null)}
                style={{ width: "100%", marginTop: 8, background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.9rem", padding: "0.5rem" }}
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 2 (NEU): Lagerplatz ──────────────────────────────────────────────────

function PlatzKarte({
  code, reihe, ebene, fach, hersteller, grund, istEmpfehlung, empfehlungLabel, belegt,
}: {
  code:              string;
  reihe:             number;
  ebene:             number;
  fach:              number;
  hersteller:        string | null;
  grund?:            string;
  istEmpfehlung?:    boolean;
  empfehlungLabel?:  string;
  belegt?:           number;
}) {
  const MAX = 4;
  return (
    <div style={{
      border:       `2px solid ${istEmpfehlung ? "var(--afb-green)" : "var(--border)"}`,
      borderRadius: 14,
      padding:      "1.2rem 1.4rem",
      background:   istEmpfehlung ? "rgba(4,180,117,0.06)" : "var(--bg)",
      textAlign:    "center",
    }}>
      {istEmpfehlung && (
        <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "var(--afb-green)", letterSpacing: 1, marginBottom: 8 }}>
          ⭐ {empfehlungLabel ?? "EMPFEHLUNG"}
        </div>
      )}
      <div style={{ fontSize: "1.8rem", fontWeight: 900, color: "var(--afb-navy)", letterSpacing: 1, marginBottom: 6 }}>
        {code}
      </div>
      <div style={{ fontSize: "0.9rem", color: "var(--text-dim)" }}>
        Reihe {reihe} · Ebene {ebene} · Fach {fach}
        {hersteller && (
          <> · <span style={{ color: "var(--afb-blue)", fontWeight: 700 }}>{hersteller}-Bereich</span></>
        )}
        {typeof belegt === "number" && (
          <> · <span style={{ fontWeight: 700, color: "var(--text)" }}>{belegt}/{MAX} belegt</span></>
        )}
      </div>
      {grund && (
        <div style={{ fontSize: "0.78rem", color: "var(--afb-green)", marginTop: 6, fontWeight: 600 }}>
          {grund}
        </div>
      )}
    </div>
  );
}

function LagerplatzBrowser({
  onWaehlen,
  onSchliessen,
  standortId,
}: {
  // id === null bedeutet: manuell angelegter Platz (kein ETL-Fach, siehe unten).
  onWaehlen:    (id: number | null, code: string) => void;
  onSchliessen: () => void;
  standortId:   number;
}) {
  const [suche,   setSuche]   = useState("");
  const [klapp,   setKlapp]   = useState<Record<number, boolean>>({});

  const freieQ = api.lagerplatz.free.useQuery({ standortId }, { staleTime: 30_000 });

  // Manuell angelegte Lagerplätze liegen in einer ANDEREN Tabelle als die
  // ETL-Fächer (LagerplatzConfig vs. lagerplatz) und tauchten hier deshalb nie
  // auf. Sie haben kein Regal/Ebene/Fach und damit keine Fach-Belegung — der
  // Code wird stattdessen direkt am Artikel hinterlegt.
  const manuelleQ = api.lagerplaetze.getAll.useQuery(undefined, { staleTime: 60_000 });

  const gefiltert = (freieQ.data ?? []).filter((p) =>
    !suche || p.code.toUpperCase().includes(suche.toUpperCase()),
  );

  // `ausConfig` markiert echte Handanlagen. NICHT über die ETL-Frei-Liste filtern:
  // ein volles Fach (4/4) steht dort nicht drin und würde sonst hier auftauchen.
  const etlCodes = new Set((freieQ.data ?? []).map((p) => p.code));
  const manuelle = (manuelleQ.data ?? [])
    .filter((l) => l.ausConfig && !etlCodes.has(l.lagerplatz))
    .filter((l) => !suche || l.lagerplatz.toUpperCase().includes(suche.toUpperCase()));

  const byReihe: Record<number, typeof gefiltert[number][]> = {};
  for (const p of gefiltert) {
    if (!byReihe[p.reihe]) byReihe[p.reihe] = [];
    byReihe[p.reihe].push(p);
  }
  const reihen = Object.keys(byReihe).map(Number).sort((a, b) => a - b);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onSchliessen}
    >
      <div
        style={{ background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.35)", width: "100%", maxWidth: 560, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden", color: "var(--text)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Freie Lagerplätze durchsuchen"
      >
        <div style={{ padding: "1.2rem 1.5rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "1.4rem" }}>📦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>Anderen Platz wählen</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
              {freieQ.data ? `${freieQ.data.length} freie Plätze` : "Lädt…"}
            </div>
          </div>
          <button
            onClick={onSchliessen}
            style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "1.5rem", lineHeight: 1, padding: "2px 8px" }}
            aria-label="Schließen"
          >×</button>
        </div>

        <div style={{ padding: "0.8rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
          <input
            type="text"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="z.B. ETL-1 oder ETL-9-3-4"
            style={{ ...S.input, minHeight: 44, fontSize: "1rem" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--afb-navy)")}
            onBlur={(e)  => (e.currentTarget.style.borderColor = "var(--border)")}
            aria-label="Lagerplatz suchen"
            autoFocus
          />
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "0.5rem 1rem 1rem" }}>
          {/* Manuell angelegte Plätze zuerst — die werden gezielt angelegt und
              sind deshalb meist das, was gesucht wird. */}
          {manuelle.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-dim)", margin: "0.3rem 0 0.5rem" }}>
                Eigene Lagerplätze
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {manuelle.map((l) => (
                  <button
                    key={l.lagerplatz}
                    onClick={() => onWaehlen(null, l.lagerplatz)}
                    style={{ padding: "0.7rem 1rem", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.9rem", fontWeight: 700, minHeight: 62, minWidth: 90, textAlign: "center" }}
                    aria-label={`Eigener Lagerplatz ${l.lagerplatz}, ${l.artikelAnzahl} Artikel`}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--afb-navy)")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  >
                    {l.lagerplatz}
                    <div style={{ fontSize: "0.72rem", fontWeight: 400, color: "var(--text-dim)", marginTop: 2 }}>
                      {l.bereich} · {l.artikelAnzahl} Artikel
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {freieQ.isLoading ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>Lädt…</div>
          ) : reihen.length === 0 ? (
            manuelle.length === 0 && (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>Keine freien Plätze gefunden.</div>
            )
          ) : reihen.map((reihe) => {
            const plaetze    = byReihe[reihe] ?? [];
            const herst      = plaetze[0]?.hersteller ?? "—";
            const aufgeklappt = klapp[reihe] !== false;
            return (
              <div key={reihe} style={{ marginBottom: "0.4rem" }}>
                <button
                  onClick={() => setKlapp((prev) => ({ ...prev, [reihe]: !aufgeklappt }))}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0.5rem", background: "none", border: "none", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", borderRadius: 8 }}
                  aria-expanded={aufgeklappt}
                >
                  <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--text-dim)" }}>
                    Reihe {reihe} · {herst} · {plaetze.length} frei
                  </span>
                  <span style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>{aufgeklappt ? "▲" : "▼"}</span>
                </button>
                {aufgeklappt && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: "0.3rem 0.5rem" }}>
                    {plaetze.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => onWaehlen(p.id, p.code)}
                        style={{ padding: "0.7rem 0.5rem", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.85rem", fontWeight: 700, textAlign: "center", minHeight: 62, transition: "background 0.15s" }}
                        aria-label={`Lagerplatz ${p.code.replace(/-/g, " ")}, Reihe ${p.reihe}, Ebene ${p.ebene}, Fach ${p.fach}${p.hersteller ? `, ${p.hersteller}-Bereich` : ""}`}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(32,47,97,0.08)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg)")}
                      >
                        {p.code}
                        <div style={{ fontSize: "0.72rem", fontWeight: 400, color: "var(--text-dim)", marginTop: 2 }}>E{p.ebene}·F{p.fach} · {p.belegt}/4</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepLagerplatz({
  geraet,
  standortId,
  onWeiter,
  onBack,
}: {
  geraet:     GeraetState;
  standortId: number;
  // freierCode = manuell angelegter Platz (kein ETL-Fach). Der bekommt keine
  // Fach-Belegung, sondern wird direkt als Lagerplatz an den Artikeln gesetzt.
  onWeiter:   (lagerplatzId: number | null, freierCode?: string) => void;
  onBack:     () => void;
}) {
  const [browserAuf, setBrowserAuf] = useState(false);

  const vorschlagQ = api.lagerplatz.vorschlagByName.useQuery(
    { geraetName: geraet.name, standortId },
    { staleTime: 0, retry: 1 },
  );

  const d = vorschlagQ.data;

  const kurzName = geraet.name.length > 40
    ? geraet.name.slice(0, 38) + "…"
    : geraet.name;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
        <button onClick={onBack} style={S.backBtn} aria-label="Zurück zur Gerät-Auswahl">← Zurück</button>
      </div>

      <WizardProgress current={2} total={4} />

      <div style={S.card}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "0 0 0.5rem", color: "var(--text)" }}>
          📍 Wo kommt dieses Gerät hin?
        </h2>

        {vorschlagQ.isLoading && (
          <div style={{ textAlign: "center", padding: "3rem 0" }}>
            <div style={{ width: 40, height: 40, border: "3px solid var(--border)", borderTopColor: "var(--afb-navy)", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 1rem" }} />
            <div style={{ color: "var(--text-dim)", fontSize: "0.95rem" }}>Platz wird gesucht…</div>
          </div>
        )}

        {vorschlagQ.error && (
          <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--text-dim)" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 12 }}>⚠️</div>
            <div style={{ marginBottom: 20 }}>Fehler beim Laden. Du kannst ohne Lagerplatz weitermachen.</div>
            <button
              onClick={() => onWeiter(null)}
              style={{ ...S.bigBtn("var(--afb-navy)"), maxWidth: 280, margin: "0 auto" }}
            >
              Weiter ohne Lagerplatz →
            </button>
          </div>
        )}

        {/* Kein Standort zugewiesen — sah vorher aus wie „Lager ist voll", weil
            der Standort-Filter dann nichts findet. Eigene, handlungsfähige
            Meldung statt einer falschen Diagnose. */}
        {d && "keinStandort" in d && d.keinStandort && (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: 8 }}>Kein Standort zugewiesen</div>
            <div style={{ color: "var(--text-dim)", fontSize: "0.95rem", marginBottom: 24, lineHeight: 1.5 }}>
              Deinem Konto ist noch kein Standort zugeordnet.<br />
              Deshalb sind für dich keine Lagerplätze sichtbar.<br />
              <strong>Bitte melde dich bei der Lagerleitung.</strong><br />
              <span style={{ fontSize: "0.85rem" }}>
                Wurde der Standort gerade erst gesetzt: einmal abmelden und neu anmelden.
              </span>
            </div>
            <button onClick={() => onWeiter(null)} style={{ ...S.bigBtn("var(--afb-blue)") }}>
              Ohne Lagerplatz weiter →
            </button>
          </div>
        )}

        {d && d.voll && (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: 8 }}>Lager ist voll</div>
            <div style={{ color: "var(--text-dim)", fontSize: "0.95rem", marginBottom: 24 }}>
              Es ist kein freier Lagerplatz mehr da.<br />Bitte erst andere Geräte auslagern.
            </div>
            <button onClick={() => onWeiter(null)} style={{ ...S.bigBtn("var(--afb-blue)") }}>
              Ohne Lagerplatz weiter →
            </button>
          </div>
        )}

        {d && !d.voll && d.bereitsZugewiesen && (
          <div>
            <p style={{ color: "var(--text-dim)", fontSize: "0.95rem", margin: "0 0 1rem" }}>
              Dieses Modell hat schon einen Platz:
            </p>
            <PlatzKarte
              code={d.platz.code}
              reihe={d.platz.reihe}
              ebene={d.platz.ebene}
              fach={d.platz.fach}
              hersteller={d.platz.hersteller}
              istEmpfehlung
              empfehlungLabel="ZUGEWIESENER PLATZ"
            />
            <button
              onClick={() => onWeiter(d.platz.id)}
              style={{ ...S.bigBtn("var(--afb-green)"), marginTop: "1rem" }}
              aria-label={`Hier einlagern, Lagerplatz ${d.platz.code}, Reihe ${d.platz.reihe}, Ebene ${d.platz.ebene}, Fach ${d.platz.fach}`}
            >
              ✓ Hier einlagern
            </button>
            <button
              onClick={() => setBrowserAuf(true)}
              style={{ width: "100%", marginTop: 10, background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.95rem", fontWeight: 600, padding: "0.5rem", textDecoration: "underline" }}
            >
              Anderen Platz wählen
            </button>
          </div>
        )}

        {d && !d.voll && !d.bereitsZugewiesen && (
          <div>
            <p style={{ color: "var(--text-dim)", fontSize: "0.95rem", margin: "0 0 1rem" }}>
              Vorschlag für <strong style={{ color: "var(--text)" }} title={geraet.name}>{kurzName}</strong>:
            </p>

            {d.vorschlaege[0] && (
              <>
                <PlatzKarte
                  code={d.vorschlaege[0].code}
                  reihe={d.vorschlaege[0].reihe}
                  ebene={d.vorschlaege[0].ebene}
                  fach={d.vorschlaege[0].fach}
                  hersteller={d.vorschlaege[0].hersteller}
                  grund={d.vorschlaege[0].grund}
                  belegt={d.vorschlaege[0].belegt}
                  istEmpfehlung
                />
                <button
                  onClick={() => onWeiter(d.vorschlaege[0]!.id)}
                  style={{ ...S.bigBtn("var(--afb-green)"), marginTop: "0.8rem" }}
                  aria-label={`Diesen Platz nehmen: ${d.vorschlaege[0].code}, Reihe ${d.vorschlaege[0].reihe}, Ebene ${d.vorschlaege[0].ebene}, Fach ${d.vorschlaege[0].fach}${d.vorschlaege[0].hersteller ? `, ${d.vorschlaege[0].hersteller}-Bereich` : ""}, Empfehlung`}
                >
                  ✓ Diesen Platz nehmen
                </button>
              </>
            )}

            {d.vorschlaege.length > 1 && (
              <div style={{ marginTop: "1.2rem" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-dim)", marginBottom: 8 }}>
                  Andere passende Plätze:
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {d.vorschlaege.slice(1).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onWeiter(p.id)}
                      style={{ padding: "0.7rem 1rem", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.9rem", fontWeight: 700, minHeight: 62, minWidth: 90, textAlign: "center", transition: "border-color 0.15s" }}
                      aria-label={`Lagerplatz ${p.code.replace(/-/g, " ")}, Reihe ${p.reihe}, Ebene ${p.ebene}, Fach ${p.fach}${p.hersteller ? `, ${p.hersteller}-Bereich` : ""}, ${p.belegt} von 4 belegt`}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--afb-navy)")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                    >
                      {p.code}
                      <div style={{ fontSize: "0.72rem", fontWeight: 400, color: "var(--text-dim)", marginTop: 2 }}>
                        R{p.reihe}·E{p.ebene}·F{p.fach} · {p.belegt}/4
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: "1.2rem" }}>
              <button
                onClick={() => setBrowserAuf(true)}
                style={{ flex: 1, minHeight: 62, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontWeight: 600, fontSize: "0.9rem" }}
              >
                🔍 Anderen Platz suchen
              </button>
              <button
                onClick={() => onWeiter(null)}
                style={{ flex: 1, minHeight: 62, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontWeight: 600, fontSize: "0.9rem" }}
              >
                Später zuweisen →
              </button>
            </div>
          </div>
        )}
      </div>

      {browserAuf && (
        <LagerplatzBrowser
          standortId={standortId}
          onWaehlen={(id, code) => { onWeiter(id, id === null ? code : undefined); setBrowserAuf(false); }}
          onSchliessen={() => setBrowserAuf(false)}
        />
      )}
    </div>
  );
}

// ── Step 3: Teile auswählen ───────────────────────────────────────────────────

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

        <WizardProgress current={3} total={4} />

        {/* Gerät-Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.5rem", padding: "0.9rem 1.2rem", background: "var(--afb-navy)", borderRadius: 12, color: "white" }}>
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
                    border:         `2px solid ${sel ? "var(--afb-green)" : "var(--border)"}`,
                    background:     sel ? "rgba(4,180,117,0.08)" : "var(--card-bg)",
                    cursor:         "pointer",
                    fontFamily:     "'Ubuntu', sans-serif",
                    transition:     "all 0.15s",
                    position:       "relative",
                  }}
                >
                  {sel && (
                    <span style={{ position: "absolute", top: 6, right: 8, fontSize: "0.75rem", color: "var(--afb-green)", fontWeight: 800 }}>✓</span>
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
                    background:  sel ? "var(--afb-green)" : "var(--border)",
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
            style={{ ...S.bigBtn("var(--afb-navy)", items.length === 0), fontSize: "1.1rem" }}
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
  standortId,
  freierLagerplatzCode,
  onBack,
  onEinbuchen,
}: {
  geraet:      GeraetState;
  standortId:  number;
  items:       AusgewaehltItem[];
  // Im Lagerplatz-Schritt gewählter manueller Platz — belegt hier die Felder vor.
  freierLagerplatzCode?: string | null;
  onBack:      () => void;
  onEinbuchen: (itemsWithLager: AusgewaehltItem[], herkunft: HerkunftArt) => void;
}) {
  const [localItems, setLocalItems] = useState<AusgewaehltItem[]>(items);
  // Standard ist der Regelfall: Teile aus einem Altgerät ausbauen.
  const [herkunft, setHerkunft] = useState<HerkunftArt>("SPENDER");

  // Bekannte Lagerplätze zur Auswahl anbieten. `lagerplaetze.getAll` führt beides
  // zusammen: manuell angelegte Plätze UND Codes, die real an Artikeln hängen —
  // genau die fehlten hier bisher komplett.
  const lagerplaetzeQ = api.lagerplaetze.getAll.useQuery(undefined, { staleTime: 60_000 });
  const bekannteLagerplaetze = (lagerplaetzeQ.data ?? []).map((l) => l.lagerplatz);

  const previewQuery = api.einlagern.preview.useQuery(
    { geraetName: geraet.name, standortId, items: localItems.map((i) => ({ teiltyp: i.teiltyp, menge: i.menge, grading: i.grading, verschiedenesText: i.verschiedenesText })) },
    { staleTime: 0 },
  );

  const neueItems    = previewQuery.data?.filter((p) => p.istNeu) ?? [];
  const neueKateg    = [...new Set(neueItems.map((p) => p.teiltyp))];

  const vorschlaegeQuery = api.einlagern.lagerplatzVorschlaegeMulti.useQuery(
    { kategorien: neueKateg, standortId },
    { enabled: neueKateg.length > 0, staleTime: 0 },
  );

  // Wurde im Lagerplatz-Schritt ein manueller Platz gewählt, gilt er für alle
  // Teile dieses Vorgangs — er hat kein ETL-Fach, also ist der Code am Artikel
  // der einzige Weg, ihn festzuhalten. Änderbar bleibt er pro Teil trotzdem.
  useEffect(() => {
    if (!freierLagerplatzCode) return;
    setLocalItems((prev) =>
      prev.map((item) => (item.lagerplatz ? item : { ...item, lagerplatz: freierLagerplatzCode })),
    );
  }, [freierLagerplatzCode]);

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

      <WizardProgress current={4} total={4} />

      <div style={S.card}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "0 0 0.5rem", color: "var(--text)" }}>
          ✅ Überprüfen
        </h2>

        {/* Gerät-Bestätigung */}
        <div style={{ padding: "0.9rem 1rem", borderRadius: 10, border: "1px solid rgba(32,47,97,0.2)", background: "rgba(32,47,97,0.04)", marginBottom: "1.2rem" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", fontWeight: 600, marginBottom: 2 }}>Gerät:</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "var(--afb-navy)" }}>{geraet.name}</div>
          {geraet.logId && (
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: 2 }}>LogID: {geraet.logId}</div>
          )}
        </div>

        {/* Herkunft — trennt echte Ernte aus Altgeräten von selbst gedruckten
            Teilen. Ohne das landen 3D-Druck-Chargen (mehrere hundert Stück aus
            EINER Buchung) in der Ernte-Auswertung und verzerren sie. */}
        <div style={{ marginBottom: "1.2rem" }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>
            Woher kommen die Teile?
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {HERKUNFT_ARTEN.map((art) => {
              const aktiv = herkunft === art;
              return (
                <button
                  key={art}
                  type="button"
                  onClick={() => setHerkunft(art)}
                  aria-pressed={aktiv}
                  style={{
                    flex: "1 1 220px", minHeight: 56, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "0.7rem 0.9rem", borderRadius: 10, textAlign: "left",
                    border: aktiv ? "2px solid var(--afb-navy)" : "1px solid var(--border)",
                    background: aktiv ? "rgba(32,47,97,0.06)" : "var(--card)",
                    color: "var(--text)",
                  }}
                >
                  <span style={{ fontSize: "1.4rem", lineHeight: 1 }} aria-hidden="true">{HERKUNFT_ICON[art]}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 800, fontSize: "0.95rem" }}>{HERKUNFT_LABEL[art]}</span>
                    <span style={{ display: "block", fontSize: "0.78rem", color: "var(--text-dim)", marginTop: 2 }}>
                      {HERKUNFT_HILFE[art]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 10, color: "var(--text)" }}>
          Diese Artikel werden eingebucht:
        </div>

        {/* Preview-Liste */}
        {isLoading ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
            <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "var(--afb-navy)", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 1rem" }} />
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
                        <div style={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.3 }}>
                          {p.menge}× <span style={{ color: "var(--afb-navy)" }}>{p.artikelName}</span>
                          {p.istNeu && (
                            <span style={{ marginLeft: 8, fontSize: "0.72rem", padding: "0.1rem 0.5rem", borderRadius: 5, background: "rgba(0,139,210,0.15)", color: "var(--afb-blue)", fontWeight: 700 }}>
                              ✨ Neu
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "var(--text-dim)", marginTop: 2 }}>
                          {teilInfo?.icon} {grOpt?.icon} {grOpt?.label} · Bestand: {p.aktuellerBestand} → <strong>{p.neuerBestand}</strong>
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
                            {/* Bekannte Lagerplätze zur Auswahl — vorher war hier nur
                                ein leeres Textfeld, man musste den Code auswendig
                                kennen. Bewusst ein <select> und KEIN <input list>:
                                Datalist filtert bei vorbelegtem Wert auf genau
                                diesen Text und sieht dann aus wie „nur 1 Option". */}
                            {bekannteLagerplaetze.length > 0 && (
                              <select
                                value={bekannteLagerplaetze.includes(item?.lagerplatz ?? "") ? item!.lagerplatz : ""}
                                onChange={(e) => setLagerplatz(p.teiltyp, e.target.value)}
                                style={{ ...S.input, minHeight: 44, fontSize: "1rem", marginBottom: 8 }}
                                aria-label={`Lagerplatz auswählen für ${teilInfo?.label ?? p.teiltyp}`}
                              >
                                <option value="">— Lagerplatz wählen —</option>
                                {bekannteLagerplaetze.map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            )}
                            <input
                              type="text"
                              value={item?.lagerplatz ?? ""}
                              onChange={(e) => setLagerplatz(p.teiltyp, e.target.value)}
                              placeholder="oder eigenen Code eingeben, z.B. L-1-3-2"
                              style={{ ...S.input, minHeight: 44, fontSize: "1rem" }}
                              onFocus={(e)  => (e.currentTarget.style.borderColor = "var(--afb-navy)")}
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
              onClick={() => onEinbuchen(localItems, herkunft)}
              disabled={!canSubmit}
              style={{ ...S.bigBtn("var(--afb-green)", !canSubmit), fontSize: "1.15rem", marginBottom: 10 }}
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
      lagerplatz:         item.etlLagerplatz ?? item.lagerplatz,
      kategorie:          item.kategorie,
      menge:              item.menge,
      neuerBestand:       item.neuerBestand,
      notiz:              item.notizText,
      grading:            item.grading,
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
            style={{ ...S.bigBtn("var(--afb-navy)"), marginBottom: 12 }}
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
                {(item.etlLagerplatz ?? item.lagerplatz) ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>Lege hier hin:</span>
                    <span style={{
                      display:      "inline-block",
                      padding:      "0.25rem 0.8rem",
                      borderRadius: 8,
                      background:   "var(--afb-navy)",
                      color:        "white",
                      fontWeight:   900,
                      fontSize:     "1rem",
                      letterSpacing: 1,
                    }}>
                      {item.etlLagerplatz ?? item.lagerplatz}
                    </span>
                    {item.grading && (
                      <span style={{
                        display:      "inline-block",
                        padding:      "0.25rem 0.6rem",
                        borderRadius: 8,
                        background:   gradingFarbe(item.grading),
                        color:        "white",
                        fontWeight:   800,
                        fontSize:     "0.9rem",
                      }}>
                        {item.grading}
                      </span>
                    )}
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
                <span style={{ fontSize: "0.85rem", color: eingelagert[idx] ? "var(--afb-green)" : "var(--text-dim)", fontWeight: 600 }}>
                  {eingelagert[idx] ? "✓ Eingelagert" : "Eingelagert?"}
                </span>
              </label>
            </div>
          ))}

          {alleEingelagert && ergebnisse.length > 0 && (
            <div style={{ textAlign: "center", padding: "0.8rem", background: "rgba(4,180,117,0.1)", borderRadius: 10, border: "1px solid rgba(4,180,117,0.3)", marginTop: 4 }}>
              <span style={{ color: "var(--afb-green)", fontWeight: 800 }}>✅ Alles eingelagert — super gemacht!</span>
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
            style={{ ...S.bigBtn("var(--afb-green)"), flex: 2 }}
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
  const { activeStandortId } = useStandortFilter();
  const einlagerStandortId   = activeStandortId ?? 1;

  const [step,              setStep]              = useState<WizardStep>(0);
  const [geraet,            setGeraet]            = useState<GeraetState | null>(null);
  const [items,             setItems]             = useState<AusgewaehltItem[]>([]);
  // Ergebnis der Foto-Erkennung, das in die Erfassung durchgereicht wird.
  const [erkannt,           setErkannt]           = useState<ErkanntesTeil | null>(null);
  const kiStatus = api.teilenummern.kiStatus.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [ergebnisse,        setErgebnisse]        = useState<ErgebnisItem[]>([]);
  const [selectedLagerplatzId, setSelectedLagerplatzId] = useState<number | null>(null);
  // Manuell angelegter Platz: hat kein ETL-Fach und damit keine Belegung — der
  // Code wird stattdessen als Lagerplatz an den einzelnen Artikeln gesetzt.
  const [freierLagerplatzCode, setFreierLagerplatzCode] = useState<string | null>(null);

  const kuerzel = (session?.user as { kuerzel?: string } | undefined)?.kuerzel ?? "";

  const { data: einlagerStandort } = api.standort.byId.useQuery(
    { id: einlagerStandortId },
    { staleTime: 300_000 },
  );

  const executeMutation = api.einlagern.execute.useMutation({
    onSuccess: (data) => {
      const results: ErgebnisItem[] = data.map((r) => {
        const teilInfo = STANDARD_TEILE.find((t) => t.id === r.teiltyp);
        return {
          teiltyp:       r.teiltyp,
          icon:          teilInfo?.icon  ?? "🔧",
          label:         teilInfo?.label ?? r.teiltyp,
          artikelName:   r.artikelName,
          kategorie:     r.kategorie,
          lagerplatz:    r.lagerplatz,
          etlLagerplatz: r.etlLagerplatz,
          menge:         r.menge,
          buchungId:     r.buchungId,
          belegNr:       r.belegNr,
          neuerBestand:  r.neuerBestand,
          grading:       r.grading,
          notizText:     r.notizText,
          eingelagert:   false,
        };
      });
      setErgebnisse(results);
      setStep(5);
      show(`✅ ${data.length} ${data.length === 1 ? "Teil" : "Teile"} eingebucht!`, "success");
    },
    onError: (e) => {
      show(`Fehler beim Einbuchen: ${e.message}`, "error");
    },
  });

  function handleEinbuchen(finalItems: AusgewaehltItem[], herkunft: HerkunftArt) {
    if (!geraet || finalItems.length === 0) return;
    executeMutation.mutate({
      geraetName:             geraet.name,
      logId:                  geraet.logId ?? undefined,
      gewaehlterLagerplatzId: selectedLagerplatzId ?? undefined,
      standortId:             einlagerStandortId,
      herkunftArt:            herkunft,
      items:                  finalItems.map((i) => ({
        teiltyp:           i.teiltyp,
        menge:             i.menge,
        grading:           i.grading,
        notiz:             i.notiz || undefined,
        lagerplatz:        i.lagerplatz || undefined,
        verschiedenesText: i.verschiedenesText || undefined,
        teilenummer:       i.teilenummer || undefined,
      })),
    });
  }

  function resetWizard() {
    setGeraet(null);
    setItems([]);
    setErgebnisse([]);
    setSelectedLagerplatzId(null);
    setFreierLagerplatzCode(null); // sonst wirkt der Platz im nächsten Vorgang weiter
    setStep(1);
  }

  // Loading overlay während execute läuft
  if (executeMutation.isPending) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 }}>
        <div style={{ width: 56, height: 56, border: "4px solid var(--border)", borderTopColor: "var(--afb-green)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>Wird eingebucht…</div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.9rem" }}>Bitte warte kurz.</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "60vh" }}>
      {/* Standort-Banner */}
      {step > 0 && step < 5 && (
        activeStandortId === null ? (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <div className="text-sm text-amber-800 dark:text-amber-200">
              ⚠️ Du hast „Alle Standorte" aktiv. Eingelagert wird nach <strong>{einlagerStandort?.name ?? "AfB Sömmerda"}</strong>.
              Andere Filiale? Wähle sie zuerst im Sidebar-Dropdown.
            </div>
          </div>
        ) : (
          <div className="mb-4 p-3 rounded-lg bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800">
            <div className="text-sm text-cyan-800 dark:text-cyan-200">
              📍 Eingelagert wird nach <strong>{einlagerStandort?.name ?? "…"}</strong>
            </div>
          </div>
        )
      )}

      {step === 0 && (
        <StepWillkommen
          onStart={() => setStep(1)}
          onKomponenten={() => setStep(6)}
          onLosesTeil={() => { setErkannt(null); setStep(7); }}
          onFoto={kiStatus.data?.eingerichtet ? () => setStep(8) : undefined}
        />
      )}

      {step === 6 && (
        <StepKomponenten standortId={einlagerStandortId} onBack={() => setStep(0)} />
      )}

      {step === 7 && (
        <StepLosesTeil
          standortId={einlagerStandortId}
          teiltypen={STANDARD_TEILE.map((t) => ({ id: t.id, label: t.label }))}
          onBack={() => { setErkannt(null); setStep(0); }}
          initial={erkannt ?? undefined}
        />
      )}

      {step === 8 && (
        <StepFotoErkennen
          onBack={() => setStep(0)}
          onWeiter={(t) => { setErkannt(t); setStep(7); }}
        />
      )}

      {step === 1 && (
        <StepGeraet
          initial={geraet}
          standortId={einlagerStandortId}
          onBack={() => setStep(0)}
          onWeiter={(g) => { setGeraet(g); setStep(2); }}
        />
      )}

      {step === 2 && geraet && (
        <StepLagerplatz
          geraet={geraet}
          standortId={einlagerStandortId}
          onBack={() => setStep(1)}
          onWeiter={(id, freierCode) => {
            setSelectedLagerplatzId(id);
            setFreierLagerplatzCode(freierCode ?? null);
            setStep(3);
          }}
        />
      )}

      {step === 3 && geraet && (
        <StepTeile
          geraet={geraet}
          items={items}
          onBack={() => setStep(2)}
          onWeiter={() => setStep(4)}
          onItemsChange={setItems}
        />
      )}

      {step === 4 && geraet && items.length > 0 && (
        <StepBestaetigung
          geraet={geraet}
          items={items}
          standortId={einlagerStandortId}
          freierLagerplatzCode={freierLagerplatzCode}
          onBack={() => setStep(3)}
          onEinbuchen={handleEinbuchen}
        />
      )}

      {step === 5 && (
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
