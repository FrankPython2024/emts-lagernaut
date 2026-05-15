"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";

// ── Typen ─────────────────────────────────────────────────────────────────────

type Teil = {
  teilId:         number;
  teiltyp:        string;
  artikelName:    string;
  menge:          number;
  verfuegbar:     boolean;
  bestand:        number;
  lagerplatzCode: string | null;
  grading:        string | null;
  status:         string;
};

type Gruppe = {
  gruppenKey:       string;
  gruppenNr:        string | null;
  techniker:        string;
  logId:            string;
  geraet:           string;
  geraeteName:      string | null;
  erstelltAm:       string | Date;
  teile:            Teil[];
  anzahlVerfuegbar: number;
  anzahlTotal:      number;
};

type WizardStep = 0 | 1 | 2 | 3;

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function gradingFarbe(g?: string | null): string {
  switch (g) {
    case "A+": return "var(--afb-green)";
    case "A":  return "var(--afb-green)";
    case "B":  return "var(--afb-blue)";
    case "C":  return "#F59E0B";
    default:   return "#94A3B8";
  }
}

// Gruppen nach Lagerplatz sortiert für die Bestätigungs-Übersicht
function gruppiereNachLagerplatz(teile: Teil[]): Map<string, Teil[]> {
  const m = new Map<string, Teil[]>();
  for (const t of teile) {
    const key = t.lagerplatzCode ?? "Kein Lagerplatz";
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(t);
  }
  return m;
}

// ── Shared Styles (identisch mit Einlager-Wizard) ─────────────────────────────

const S = {
  card: {
    background:   "var(--card-bg)",
    border:       "1px solid var(--border)",
    borderRadius: 16,
    padding:      "1.5rem",
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
    transition:     "transform 0.15s",
    opacity:        disabled ? 0.6 : 1,
  }),

  backBtn: {
    display:      "flex",
    alignItems:   "center",
    gap:          6,
    background:   "none",
    border:       "none",
    color:        "var(--text-dim)",
    cursor:       "pointer",
    fontSize:     "0.95rem",
    fontWeight:   600,
    fontFamily:   "'Ubuntu', sans-serif",
    padding:      "0.75rem 0.6rem",
    minHeight:    44,
    borderRadius: 8,
  } satisfies React.CSSProperties,
};

// ── WizardProgress ─────────────────────────────────────────────────────────────

function WizardProgress({ current }: { current: number }) {
  const labels = ["Anfrage wählen", "Teile wählen", "Bestätigen"];
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-dim)", marginBottom: 8 }}>
        Schritt {current} von {labels.length}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {labels.map((label, i) => {
          const step   = i + 1;
          const done   = step < current;
          const active = step === current;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width:        done || active ? 32 : 10,
                height:       10,
                borderRadius: 5,
                background:   done ? "var(--afb-green)" : active ? "var(--afb-navy)" : "var(--border)",
                transition:   "all 0.3s",
                flexShrink:   0,
              }} />
              {active && (
                <span style={{ fontSize: "0.78rem", color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</span>
              )}
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

// ── Schritt 0: Anfragen-Liste ──────────────────────────────────────────────────

function SchritAnfragen({ onWaehlen }: { onWaehlen: (g: Gruppe) => void }) {
  const query = api.auslagern.listAnfragen.useQuery(undefined, { staleTime: 30_000 });

  if (query.isLoading) return <PageLoader />;
  if (query.error) return (
    <div style={{ padding: "1.5rem", background: "rgba(250,62,62,0.1)", border: "1px solid rgba(250,62,62,0.3)", borderRadius: 12, color: "#fa3e3e" }}>
      Fehler: {query.error.message}
    </div>
  );

  const gruppen = (query.data ?? []) as Gruppe[];

  if (gruppen.length === 0) return (
    <div style={{ ...S.card, textAlign: "center", padding: "3rem" }}>
      <div style={{ fontSize: "3rem", marginBottom: 12 }}>📭</div>
      <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: 8 }}>Keine offenen Anfragen</div>
      <div style={{ color: "var(--text-dim)", fontSize: "0.9rem" }}>
        Alle verfügbaren Anfragen wurden bereits ausgelagert oder es gibt noch keine Anfragen.
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 900, margin: "0 0 0.3rem", color: "var(--text)" }}>
          📤 Teile auslagern
        </h1>
        <p style={{ color: "var(--text-dim)", fontSize: "0.95rem", margin: 0 }}>
          {gruppen.length} Anfrage{gruppen.length !== 1 ? "n" : ""} mit verfügbaren Teilen
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {gruppen.map((g) => {
          const hlCls = g.teile.some((t) => t.status === "IN_BEARBEITUNG")
            ? "anfrage-bearbeitung"
            : "anfrage-neu";

          return (
            <button
              key={g.gruppenKey}
              onClick={() => onWaehlen(g)}
              className={hlCls}
              style={{
                ...S.card,
                display:     "block",
                textAlign:   "left",
                cursor:      "pointer",
                width:       "100%",
                border:      "1px solid var(--border)",
                transition:  "transform 0.1s, box-shadow 0.1s",
                fontFamily:  "'Ubuntu', sans-serif",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
              aria-label={`Anfrage ${g.gruppenNr ?? g.logId} von ${g.techniker} auswählen`}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: "1rem", marginBottom: 2, color: "var(--text)" }}>
                    {g.geraeteName ?? g.geraet}
                    {g.gruppenNr && (
                      <span style={{ marginLeft: 8, fontSize: "0.75rem", fontFamily: "monospace", color: "var(--text-dim)", fontWeight: 400 }}>
                        {g.gruppenNr}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "var(--text-dim)", marginBottom: 6 }}>
                    👤 {g.techniker} · {new Date(g.erstelltAm).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })} · LogID {g.logId}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {g.teile.map((t) => (
                      <span
                        key={t.teilId}
                        style={{
                          padding:      "0.2rem 0.6rem",
                          borderRadius: 6,
                          fontSize:     "0.75rem",
                          fontWeight:   700,
                          background:   t.verfuegbar ? "rgba(4,180,117,0.12)" : "var(--bg)",
                          color:        t.verfuegbar ? "var(--afb-green)" : "var(--text-dim)",
                          border:       `1px solid ${t.verfuegbar ? "rgba(4,180,117,0.3)" : "var(--border)"}`,
                        }}
                      >
                        {t.verfuegbar ? "✓" : "○"} {t.teiltyp}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "var(--afb-green)" }}>
                    {g.anzahlVerfuegbar}/{g.anzahlTotal}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>verfügbar</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Schritt 1: Teile-Auswahl ──────────────────────────────────────────────────

function SchrittTeile({
  gruppe,
  ausgewaehlt,
  onToggle,
  onWeiter,
  onZurueck,
}: {
  gruppe:      Gruppe;
  ausgewaehlt: Set<number>;
  onToggle:    (id: number) => void;
  onWeiter:    () => void;
  onZurueck:   () => void;
}) {
  const verfuegbareTeile = gruppe.teile.filter((t) => t.verfuegbar);
  const anzahlAusgewaehlt = [...ausgewaehlt].filter(
    (id) => verfuegbareTeile.some((t) => t.teilId === id),
  ).length;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
        <button onClick={onZurueck} style={S.backBtn}>← Zurück</button>
      </div>

      <WizardProgress current={2} />

      <div style={S.card}>
        <div style={{ marginBottom: "1.2rem" }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 900, margin: "0 0 0.3rem", color: "var(--text)" }}>
            Teile auswählen
          </h2>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-dim)" }}>
            {gruppe.geraeteName ?? gruppe.geraet} · {gruppe.techniker}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.5rem" }}>
          {gruppe.teile.map((t) => {
            const selected = ausgewaehlt.has(t.teilId);
            return (
              <div
                key={t.teilId}
                onClick={() => t.verfuegbar && onToggle(t.teilId)}
                style={{
                  display:       "flex",
                  alignItems:    "center",
                  gap:           12,
                  padding:       "0.9rem 1rem",
                  borderRadius:  12,
                  border:        `1px solid ${selected ? "var(--afb-green)" : "var(--border)"}`,
                  background:    selected ? "rgba(4,180,117,0.06)" : t.verfuegbar ? "var(--bg)" : "var(--bg)",
                  cursor:        t.verfuegbar ? "pointer" : "default",
                  opacity:       t.verfuegbar ? 1 : 0.5,
                  transition:    "border-color 0.15s, background 0.15s",
                }}
                role="checkbox"
                aria-checked={selected}
                aria-disabled={!t.verfuegbar}
                tabIndex={t.verfuegbar ? 0 : -1}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); t.verfuegbar && onToggle(t.teilId); } }}
              >
                {/* Checkbox */}
                <div style={{
                  width:        24, height: 24, borderRadius: 6, flexShrink: 0,
                  border:       `2px solid ${selected ? "var(--afb-green)" : "var(--border)"}`,
                  background:   selected ? "var(--afb-green)" : "transparent",
                  display:      "flex", alignItems: "center", justifyContent: "center",
                  transition:   "all 0.15s",
                }}>
                  {selected && <span style={{ color: "white", fontSize: "0.85rem", fontWeight: 900 }}>✓</span>}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                    {t.teiltyp}
                    {t.grading && (
                      <span style={{
                        marginLeft: 8, fontSize: "0.75rem", padding: "0.15rem 0.5rem",
                        borderRadius: 5, background: gradingFarbe(t.grading),
                        color: "white", fontWeight: 800,
                      }}>
                        {t.grading}
                      </span>
                    )}
                    {!t.verfuegbar && (
                      <span style={{ marginLeft: 8, fontSize: "0.72rem", color: "var(--text-dim)" }}>
                        nicht auf Lager
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-dim)", marginTop: 2 }}>
                    Bestand: {t.bestand} · {t.menge}× benötigt
                  </div>
                </div>

                {/* Lagerplatz */}
                {t.lagerplatzCode && (
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "0.9rem", fontWeight: 900, color: "var(--afb-navy)", fontFamily: "monospace" }}>
                      {t.lagerplatzCode}
                    </div>
                    <div style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>Lagerplatz</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onZurueck} style={{ ...S.backBtn, flex: 1, minHeight: 60, border: "1px solid var(--border)", borderRadius: 12, justifyContent: "center" }}>
            ← Zurück
          </button>
          <button
            onClick={onWeiter}
            disabled={anzahlAusgewaehlt === 0}
            style={{ ...S.bigBtn("var(--afb-green)", anzahlAusgewaehlt === 0), flex: 2, fontSize: "1rem" }}
          >
            {anzahlAusgewaehlt} Teil{anzahlAusgewaehlt !== 1 ? "e" : ""} auslagern →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Schritt 2: Bestätigung ─────────────────────────────────────────────────────

function SchrittBestaetigung({
  gruppe,
  ausgewaehlt,
  onBestaetigen,
  onZurueck,
  isPending,
}: {
  gruppe:       Gruppe;
  ausgewaehlt:  Set<number>;
  onBestaetigen: (notiz: string) => void;
  onZurueck:    () => void;
  isPending:    boolean;
}) {
  const [notiz, setNotiz] = useState("");

  const selectedTeile = gruppe.teile.filter((t) => ausgewaehlt.has(t.teilId));
  const nachLagerplatz = gruppiereNachLagerplatz(selectedTeile);

  return (
    <div style={{ maxWidth: 580, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
        <button onClick={onZurueck} style={S.backBtn}>← Zurück</button>
      </div>

      <WizardProgress current={3} />

      <div style={S.card}>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 900, margin: "0 0 0.3rem", color: "var(--text)" }}>
          ✅ Bestätigen
        </h2>
        <p style={{ margin: "0 0 1.5rem", color: "var(--text-dim)", fontSize: "0.85rem" }}>
          {gruppe.geraeteName ?? gruppe.geraet} · {gruppe.techniker}
        </p>

        {/* Sammelliste nach Lagerplatz */}
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--text-dim)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Hol diese Teile:
          </div>
          {[...nachLagerplatz.entries()].map(([lp, teile]) => (
            <div key={lp} style={{ marginBottom: 12, padding: "0.8rem 1rem", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 900, fontSize: "1rem", fontFamily: "monospace", color: "var(--afb-navy)", marginBottom: 6 }}>
                📍 {lp}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {teile.map((t) => (
                  <span key={t.teilId} style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    {t.teiltyp}
                    {t.grading && (
                      <span style={{ marginLeft: 4, padding: "0.1rem 0.4rem", borderRadius: 4, background: gradingFarbe(t.grading), color: "white", fontSize: "0.72rem", fontWeight: 800 }}>
                        {t.grading}
                      </span>
                    )}
                    <span style={{ color: "var(--text-dim)", marginLeft: 4, fontSize: "0.75rem" }}>×{t.menge}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Optionale Notiz */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label htmlFor="auslagern-notiz" style={{ display: "block", fontSize: "0.85rem", fontWeight: 700, marginBottom: 6 }}>
            Notiz (optional)
          </label>
          <textarea
            id="auslagern-notiz"
            value={notiz}
            onChange={(e) => setNotiz(e.target.value)}
            placeholder="z.B. Abgeholt von Techniker XY"
            rows={2}
            style={{
              width: "100%", padding: "0.7rem 0.9rem", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--bg)",
              color: "var(--text)", fontFamily: "'Ubuntu', sans-serif",
              fontSize: "0.95rem", resize: "vertical", outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <button
          onClick={() => onBestaetigen(notiz)}
          disabled={isPending}
          style={{ ...S.bigBtn("var(--afb-green)", isPending), marginBottom: 10 }}
        >
          {isPending ? "Wird ausgelagert…" : `✅ ${selectedTeile.length} Teil${selectedTeile.length !== 1 ? "e" : ""} jetzt auslagern`}
        </button>
        <button onClick={onZurueck} style={{ width: "100%", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.95rem", padding: "0.5rem" }}>
          ← Doch nochmal ändern
        </button>
      </div>
    </div>
  );
}

// ── Schritt 3: Erfolg ─────────────────────────────────────────────────────────

type ErgebnisData = {
  ausgabe:        { anfrageId: number; artikel: string; lagerplatz: string | null; menge: number }[];
  ausgefuehrtVon: string;
  datum:          Date;
};

function SchrittErfolg({ ergebnis, onNochEins }: { ergebnis: ErgebnisData; onNochEins: () => void }) {
  const nachLp = new Map<string, string[]>();
  for (const a of ergebnis.ausgabe) {
    const key = a.lagerplatz ?? "—";
    if (!nachLp.has(key)) nachLp.set(key, []);
    nachLp.get(key)!.push(`${a.artikel} ×${a.menge}`);
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
      <div style={{ ...S.card }}>
        <div style={{ fontSize: "4rem", marginBottom: "0.5rem" }}>🎉</div>
        <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 0.4rem", color: "var(--text)" }}>
          Ausgelagert!
        </h1>
        <p style={{ margin: "0 0 1.5rem", color: "var(--text-dim)" }}>
          {ergebnis.ausgabe.length} Teil{ergebnis.ausgabe.length !== 1 ? "e" : ""} ausgegeben von {ergebnis.ausgefuehrtVon}
        </p>

        {/* Zusammenfassung */}
        <div style={{ textAlign: "left", marginBottom: "1.5rem" }}>
          {[...nachLp.entries()].map(([lp, teile]) => (
            <div key={lp} style={{ padding: "0.7rem 1rem", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontFamily: "monospace", color: "var(--afb-navy)", marginBottom: 4 }}>📍 {lp}</div>
              {teile.map((t, i) => (
                <div key={i} style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>✓ {t}</div>
              ))}
            </div>
          ))}
        </div>

        {/* Platzhalter für Phase C */}
        <div style={{ padding: "0.8rem", borderRadius: 10, border: "1px dashed var(--border)", color: "var(--text-dim)", fontSize: "0.8rem", marginBottom: "1rem" }}>
          📄 Auslagerbeleg — kommt in Phase C
        </div>

        <button onClick={onNochEins} style={{ ...S.bigBtn("var(--afb-navy)") }}>
          📤 Neue Auslagerung
        </button>
      </div>
    </div>
  );
}

// ── Haupt-Page ────────────────────────────────────────────────────────────────

export default function AuslagernPage() {
  const { show } = useToast();

  const [step,         setStep]         = useState<WizardStep>(0);
  const [gruppe,       setGruppe]       = useState<Gruppe | null>(null);
  const [ausgewaehlt,  setAusgewaehlt]  = useState<Set<number>>(new Set());
  const [ergebnis,     setErgebnis]     = useState<ErgebnisData | null>(null);

  const mutation = api.auslagern.teile.useMutation({
    onSuccess: (data) => {
      setErgebnis(data as ErgebnisData);
      setStep(3);
      show(`✅ ${data.ausgabe.length} Teil${data.ausgabe.length !== 1 ? "e" : ""} ausgelagert!`, "success");
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

  function waehleGruppe(g: Gruppe) {
    // Default: alle verfügbaren Teile angehakt
    setGruppe(g);
    setAusgewaehlt(new Set(g.teile.filter((t) => t.verfuegbar).map((t) => t.teilId)));
    setStep(1);
  }

  function toggleTeil(id: number) {
    setAusgewaehlt((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleBestaetigen(notiz: string) {
    if (!gruppe || ausgewaehlt.size === 0) return;
    mutation.mutate({
      anfrageIds: [...ausgewaehlt],
      notiz:      notiz || undefined,
    });
  }

  function reset() {
    setStep(0);
    setGruppe(null);
    setAusgewaehlt(new Set());
    setErgebnis(null);
  }

  if (mutation.isPending) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 }}>
        <div style={{ width: 56, height: 56, border: "4px solid var(--border)", borderTopColor: "var(--afb-green)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>Wird ausgelagert…</div>
        <div style={{ color: "var(--text-dim)", fontSize: "0.9rem" }}>Bitte warte kurz.</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "60vh" }}>
      {step === 0 && <SchritAnfragen onWaehlen={waehleGruppe} />}

      {step === 1 && gruppe && (
        <SchrittTeile
          gruppe={gruppe}
          ausgewaehlt={ausgewaehlt}
          onToggle={toggleTeil}
          onWeiter={() => setStep(2)}
          onZurueck={() => setStep(0)}
        />
      )}

      {step === 2 && gruppe && (
        <SchrittBestaetigung
          gruppe={gruppe}
          ausgewaehlt={ausgewaehlt}
          onBestaetigen={handleBestaetigen}
          onZurueck={() => setStep(1)}
          isPending={mutation.isPending}
        />
      )}

      {step === 3 && ergebnis && (
        <SchrittErfolg ergebnis={ergebnis} onNochEins={reset} />
      )}
    </div>
  );
}
