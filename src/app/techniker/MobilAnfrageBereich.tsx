"use client";

import { useEffect, useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

// Mobil-Ersatzteil-Anfrage für Techniker: Bereich → Hersteller → Modell. Ein Klick
// aufs Modell öffnet ein POP-UP (Teiltypen mit NEU/BEDARF) — analog zur Admin-Mobil-
// Übersicht, kein Runterscrollen. Teiltyp antippen → Anfrage-Dialog (Menge/Kommentar).
// Kein LogID-Scan (mobile Geräte haben keine modell-auflösbare LogID).
// Rechte-Gate (ANFRAGE_MOBIL_CREATE) liegt in der Eltern-Seite.

const CYAN  = "#008BD2";
const GREEN = "#04B475";

type Bereich = "STANDARD" | "DIGITAL_EDUCATION";
const BEREICH_TABS: { key: Bereich; label: string }[] = [
  { key: "STANDARD",          label: "Standard" },
  { key: "DIGITAL_EDUCATION", label: "digital Education" },
];

const STATUS_CFG: Record<string, { text: string; color: string; bg: string }> = {
  NEU:            { text: "Neu",            color: "#005fa3", bg: "#dbeafe" },
  BEDARF:         { text: "Bedarf",         color: "#92400e", bg: "#fef3c7" },
  IN_BEARBEITUNG: { text: "In Bearbeitung", color: "#92400e", bg: "#fef3c7" },
  ABGESCHLOSSEN:  { text: "Abgeschlossen",  color: "#15803d", bg: "#dcfce7" },
  STORNIERT:      { text: "Storniert",      color: "#b91c1c", bg: "#fee2e2" },
};

const BEREICH_LABEL = (b: string) => (b === "DIGITAL_EDUCATION" ? "digital Education" : "Standard");

const card: React.CSSProperties = {
  background: "var(--card-bg)", border: "1.5px solid var(--border)",
  borderRadius: 16, color: "var(--text)", fontFamily: "'Ubuntu', sans-serif",
};

export default function MobilAnfrageBereich({ kuerzel }: { kuerzel: string }) {
  const { show } = useToast();
  const utils = api.useUtils();

  const [bereich, setBereich]             = useState<Bereich>("STANDARD");
  const [selHersteller, setSelHersteller] = useState<string | null>(null);
  const [selModell, setSelModell]         = useState<{ id: number; name: string } | null>(null);

  const herstellerQ = api.mobilAnfrage.hersteller.useQuery({ bereich });
  const modelleQ    = api.mobilAnfrage.modelle.useQuery(
    { bereich, hersteller: selHersteller ?? "" },
    { enabled: !!selHersteller },
  );
  const meineQ      = api.mobilAnfrage.meine.useQuery(undefined, { enabled: !!kuerzel });

  function bereichWechseln(b: Bereich) {
    setBereich(b);
    setSelHersteller(null);
    setSelModell(null);
  }

  return (
    <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "1fr", maxWidth: 900, margin: "0 auto" }}>

      {/* Bereich-Umschalter */}
      <div style={{ display: "flex", gap: 6, ...card, borderRadius: 14, padding: 6, width: "fit-content" }}>
        {BEREICH_TABS.map(({ key, label }) => {
          const aktiv = bereich === key;
          return (
            <button key={key} type="button" aria-pressed={aktiv} onClick={() => bereichWechseln(key)}
              style={{
                minHeight: 48, padding: "0 1.1rem", borderRadius: 10, border: "none", cursor: "pointer",
                fontWeight: 700, fontFamily: "'Ubuntu', sans-serif", fontSize: "1rem",
                background: aktiv ? CYAN : "transparent", color: aktiv ? "white" : "var(--text)",
              }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* Schritt 1: Hersteller */}
      <section>
        <h2 style={{ margin: "0 0 0.6rem", fontSize: "1.1rem", fontWeight: 800 }}>1 · Hersteller wählen</h2>
        {herstellerQ.isLoading ? (
          <Hint>Wird geladen…</Hint>
        ) : !herstellerQ.data?.length ? (
          <Hint>Keine Teile in diesem Bereich.</Hint>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.6rem" }}>
            {herstellerQ.data.map((h) => {
              const aktiv = selHersteller === h.hersteller;
              return (
                <button key={h.hersteller} type="button" aria-pressed={aktiv}
                  onClick={() => { setSelHersteller(h.hersteller); setSelModell(null); }}
                  style={{ ...card, textAlign: "left", padding: "1rem", minHeight: 80, cursor: "pointer",
                    border: aktiv ? `2px solid ${CYAN}` : "1.5px solid var(--border)",
                    background: aktiv ? "rgba(0,139,210,0.08)" : "var(--card-bg)" }}>
                  <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>{h.hersteller}</div>
                  <div style={{ marginTop: 4, fontSize: "0.85rem", color: "var(--text-dim)" }}>
                    {h.modelle} {h.modelle === 1 ? "Modell" : "Modelle"} · {h.teile} Teile
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Schritt 2: Modell — Klick öffnet das Pop-up */}
      {selHersteller && (
        <section>
          <h2 style={{ margin: "0 0 0.6rem", fontSize: "1.1rem", fontWeight: 800 }}>2 · Modell wählen — {selHersteller}</h2>
          {modelleQ.isLoading ? (
            <Hint>Wird geladen…</Hint>
          ) : !modelleQ.data?.length ? (
            <Hint>Keine Modelle mit Teilen.</Hint>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.5rem" }}>
              {modelleQ.data.map((m) => (
                <button key={m.id} type="button" aria-haspopup="dialog"
                  onClick={() => setSelModell({ id: m.id, name: m.modell })}
                  style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                    padding: "0 1rem", minHeight: 56, cursor: "pointer" }}>
                  <span style={{ fontWeight: 700 }}>{m.modell}</span>
                  <span style={{ flexShrink: 0, fontSize: "0.82rem", fontWeight: 700, color: CYAN,
                    background: "rgba(0,139,210,0.12)", borderRadius: 8, padding: "2px 8px" }}>
                    {m.stueck} Stück
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Meine Mobil-Anfragen */}
      <section>
        <h2 style={{ margin: "0 0 0.6rem", fontSize: "1.1rem", fontWeight: 800 }}>Meine Mobil-Anfragen</h2>
        {meineQ.isLoading ? (
          <Hint>Wird geladen…</Hint>
        ) : !meineQ.data?.length ? (
          <Hint>Noch keine Mobil-Anfragen.</Hint>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {meineQ.data.map((a) => {
              const cfg = STATUS_CFG[a.status] ?? STATUS_CFG.NEU!;
              return (
                <div key={a.id} style={{ ...card, padding: "0.85rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>
                      {a.modell} <span style={{ color: "var(--text-dim)", fontWeight: 500 }}>· {a.teiltyp}{a.farbe ? ` · 🎨 ${a.farbe}` : ""}{a.menge > 1 ? ` ×${a.menge}` : ""}</span>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
                      {BEREICH_LABEL(a.bereich)} · {new Date(a.datum).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                      {a.kommentar ? ` · ${a.kommentar}` : ""}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: "0.8rem", fontWeight: 700, color: cfg.color, background: cfg.bg, borderRadius: 20, padding: "3px 11px" }}>
                    {cfg.text}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Pop-up: Teiltypen des gewählten Modells */}
      {selModell && (
        <ModellAnfrageModal
          bereich={bereich}
          modellId={selModell.id}
          modellName={selModell.name}
          onClose={() => setSelModell(null)}
          onDone={() => { void utils.mobilAnfrage.meine.invalidate(); }}
          show={show}
        />
      )}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "1rem 1.25rem", background: "var(--card-bg)", border: "1px dashed var(--border)", borderRadius: 12, color: "var(--text-dim)", fontSize: "0.95rem" }}>
      {children}
    </div>
  );
}

// Pop-up mit den Teiltypen. Antippen legt sie in den WARENKORB (Menge/Kommentar je
// Teil); „Anfrage senden" schickt alle als EINE Anfrage (gemeinsame gruppenNr).
function ModellAnfrageModal({
  bereich, modellId, modellName, onClose, onDone, show,
}: {
  bereich: Bereich;
  modellId: number;
  modellName: string;
  onClose: () => void;
  onDone: () => void;
  show: (msg: string, typ?: "success" | "error" | "info" | "warning") => void;
}) {
  const teiltypenQ = api.mobilAnfrage.teiltypen.useQuery({ bereich, modellId });

  // Jede Teiltyp-Farbe-Kombination ist eine eigene Kachel (z.B. „Backcover · schwarz").
  // key = teiltyp +   + (farbe ?? "") → im Warenkorb eindeutig.
  const kombiKey = (teiltyp: string, farbe: string | null) => `${teiltyp} ${farbe ?? ""}`;
  type Option = { key: string; teiltyp: string; farbe: string | null; label: string; bestand: number };
  const optionen: Option[] = (teiltypenQ.data ?? []).flatMap((t) => {
    const echte = t.farben.filter((f) => f.farbe);
    if (echte.length === 0) {
      return [{ key: kombiKey(t.teiltyp, null), teiltyp: t.teiltyp, farbe: null, label: t.teiltyp, bestand: t.bestand }];
    }
    const opts: Option[] = echte.map((f) => ({
      key: kombiKey(t.teiltyp, f.farbe), teiltyp: t.teiltyp, farbe: f.farbe,
      label: `${t.teiltyp} · ${f.farbe}`, bestand: f.anzahl,
    }));
    const ohne = t.farben.find((f) => !f.farbe);
    if (ohne) opts.push({ key: kombiKey(t.teiltyp, null), teiltyp: t.teiltyp, farbe: null, label: `${t.teiltyp} · ohne Farbe`, bestand: ohne.anzahl });
    return opts;
  });

  // Warenkorb: key → { teiltyp, farbe, label, menge, kommentar }.
  type KorbEintrag = { teiltyp: string; farbe: string | null; label: string; menge: number; kommentar: string };
  const [korb, setKorb] = useState<Record<string, KorbEintrag>>({});
  const korbListe = Object.entries(korb);

  // Detail-Klick: zeigt die ReForm-Bezeichnung(en) hinter einer Kachel.
  const [detailOpt, setDetailOpt] = useState<Option | null>(null);

  const senden = api.mobilAnfrage.erstellenSammel.useMutation({
    onSuccess: (r) => {
      if (r.erstellt > 0) {
        show(`✅ Anfrage gesendet (${r.erstellt} Teil${r.erstellt !== 1 ? "e" : ""})${r.abgelehnt.length ? ` — ${r.abgelehnt.length} nicht mehr auf Lager` : ""}`, r.abgelehnt.length ? "warning" : "success");
      } else {
        show("Nichts gesendet — Teile nicht mehr auf Lager.", "warning");
      }
      onDone();
      onClose();
    },
    onError: (e) => show(e.message, "error"),
  });

  function toggle(opt: Option) {
    setKorb((prev) => {
      const next = { ...prev };
      if (next[opt.key]) delete next[opt.key];
      else next[opt.key] = { teiltyp: opt.teiltyp, farbe: opt.farbe, label: opt.label, menge: 1, kommentar: "" };
      return next;
    });
  }
  const entfernen    = (key: string) => setKorb((p) => { const n = { ...p }; delete n[key]; return n; });
  const setMenge     = (key: string, menge: number) => setKorb((p) => ({ ...p, [key]: { ...p[key]!, menge } }));
  const setKommentar = (key: string, kommentar: string) => setKorb((p) => ({ ...p, [key]: { ...p[key]!, kommentar } }));

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <>
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Teile für ${modellName}`} onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 620, background: "var(--card-bg)", color: "var(--text)", borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.3)", fontFamily: "'Ubuntu', sans-serif", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800 }}>{modellName}</h2>
            <div style={{ marginTop: 2, fontSize: "0.85rem", color: "var(--text-dim)" }}>
              {BEREICH_LABEL(bereich)} · Teile antippen, dann senden
            </div>
          </div>
          <button onClick={onClose} aria-label="Schließen"
            style={{ width: 44, height: 44, borderRadius: 10, border: "none", background: "transparent", color: "var(--text-dim)", fontSize: "1.5rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem", overflowY: "auto", flex: 1 }}>
          {teiltypenQ.isLoading ? (
            <Hint>Wird geladen…</Hint>
          ) : optionen.length === 0 ? (
            <Hint>Für dieses Modell ist aktuell kein Teil auf Lager.</Hint>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.6rem" }}>
              {optionen.map((opt) => {
                const drin = !!korb[opt.key];
                return (
                  // Wrapper (position:relative), damit der ⓘ-Detail-Knopf NEBEN dem
                  // Warenkorb-Button liegt (verschachtelte <button> wären ungültig).
                  <div key={opt.key} style={{ position: "relative" }}>
                    <button type="button" aria-pressed={drin}
                      onClick={() => toggle(opt)}
                      style={{ ...card, width: "100%", padding: "0.85rem 0.75rem", minHeight: 84, cursor: "pointer", textAlign: "center",
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                        border: drin ? `2px solid ${CYAN}` : "1.5px solid var(--border)",
                        background: drin ? "rgba(0,139,210,0.08)" : "var(--card-bg)" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{drin ? "✓ " : ""}{opt.teiltyp}</span>
                      {opt.farbe && (
                        <span style={{ fontSize: "0.82rem", fontWeight: 700, color: CYAN }}>🎨 {opt.farbe}</span>
                      )}
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: 20, padding: "2px 10px" }}>
                        {opt.bestand} verfügbar
                      </span>
                    </button>
                    <button type="button"
                      aria-label={`ReForm-Bezeichnung für ${opt.label} anzeigen`}
                      title="ReForm-Bezeichnung anzeigen"
                      onClick={() => setDetailOpt(opt)}
                      style={{ position: "absolute", top: 6, right: 6, width: 30, height: 30, borderRadius: 8,
                        border: "1.5px solid var(--border)", background: "var(--card-bg)", color: "var(--text-dim)",
                        fontSize: "0.9rem", fontWeight: 800, cursor: "pointer", lineHeight: 1,
                        display: "flex", alignItems: "center", justifyContent: "center" }}>
                      ℹ
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {korbListe.length > 0 && (
            <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <div style={{ fontSize: "0.95rem", fontWeight: 800, marginBottom: "0.6rem" }}>Warenkorb ({korbListe.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {korbListe.map(([key, e]) => (
                  <div key={key} style={{ ...card, padding: "0.75rem 0.9rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, fontWeight: 700 }}>
                        {e.teiltyp}{e.farbe ? <span style={{ color: CYAN }}> · 🎨 {e.farbe}</span> : null}
                      </span>
                      <button type="button" aria-label="weniger" onClick={() => setMenge(key, Math.max(1, e.menge - 1))} style={stepBtnKlein}>−</button>
                      <span style={{ minWidth: 28, textAlign: "center", fontSize: "1.1rem", fontWeight: 800 }}>{e.menge}</span>
                      <button type="button" aria-label="mehr" onClick={() => setMenge(key, Math.min(99, e.menge + 1))} style={stepBtnKlein}>+</button>
                      <button type="button" aria-label="entfernen" onClick={() => entfernen(key)} style={{ ...stepBtnKlein, color: "#b91c1c", borderColor: "#b91c1c55" }}>✕</button>
                    </div>
                    <input type="text" value={e.kommentar} onChange={(ev) => setKommentar(key, ev.target.value)}
                      placeholder="Kommentar (optional)"
                      style={{ width: "100%", marginTop: 8, padding: "0.55rem 0.75rem", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.9rem", boxSizing: "border-box", outline: "none" }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid var(--border)" }}>
          <button type="button" disabled={korbListe.length === 0 || senden.isPending}
            onClick={() => senden.mutate({
              bereich, modellId,
              items: korbListe.map(([, e]) => ({ teiltyp: e.teiltyp, farbe: e.farbe, menge: e.menge, kommentar: e.kommentar.trim() || undefined })),
            })}
            style={{ width: "100%", minHeight: 56, borderRadius: 14, border: "none", background: GREEN, color: "white", fontWeight: 800, fontSize: "1.05rem",
              cursor: korbListe.length === 0 ? "default" : "pointer", opacity: korbListe.length === 0 || senden.isPending ? 0.5 : 1, fontFamily: "'Ubuntu', sans-serif" }}>
            {senden.isPending ? "Sende…" : korbListe.length === 0 ? "Teile antippen…" : `Anfrage senden (${korbListe.length} Teil${korbListe.length !== 1 ? "e" : ""})`}
          </button>
        </div>
      </div>
    </div>
    {detailOpt && (
      <TeilDetailModal
        bereich={bereich}
        modellId={modellId}
        teiltyp={detailOpt.teiltyp}
        farbe={detailOpt.farbe}
        label={detailOpt.label}
        onClose={() => setDetailOpt(null)}
      />
    )}
    </>
  );
}

// ── Detail-Pop-up: ReForm-Bezeichnung(en) hinter einer Teiltyp/Farbe-Kachel ─────
// Rein lesend; distinct Wortlaute mit Anzahl. Kein Lagerplatz/LogID (Techniker-Sicht).
function TeilDetailModal({
  bereich, modellId, teiltyp, farbe, label, onClose,
}: {
  bereich:  Bereich;
  modellId: number;
  teiltyp:  string;
  farbe:    string | null;
  label:    string;
  onClose:  () => void;
}) {
  const q = api.mobilAnfrage.teilBezeichnungen.useQuery({ bereich, modellId, teiltyp, farbe });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`ReForm-Bezeichnung — ${label}`} onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 560, background: "var(--card-bg)", color: "var(--text)", borderRadius: 18, boxShadow: "0 8px 40px rgba(0,0,0,0.35)", fontFamily: "'Ubuntu', sans-serif", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "1.1rem 1.35rem", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800 }}>{label}</h3>
            <div style={{ marginTop: 2, fontSize: "0.82rem", color: "var(--text-dim)" }}>Bezeichnung aus ReForm</div>
          </div>
          <button onClick={onClose} aria-label="Schließen"
            style={{ width: 40, height: 40, borderRadius: 10, border: "none", background: "transparent", color: "var(--text-dim)", fontSize: "1.4rem", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "1.1rem 1.35rem", overflowY: "auto" }}>
          {q.isLoading ? (
            <Hint>Wird geladen…</Hint>
          ) : !q.data?.length ? (
            <Hint>Keine ReForm-Bezeichnung hinterlegt.</Hint>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {q.data.map((r, i) => (
                <li key={i} style={{ ...card, padding: "0.65rem 0.85rem", display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "'Ubuntu Mono', monospace", fontSize: "0.9rem", wordBreak: "break-word" }}>{r.bezeichnung}</span>
                  {r.anzahl > 1 && (
                    <span style={{ flexShrink: 0, fontSize: "0.78rem", fontWeight: 700, color: CYAN, background: "rgba(0,139,210,0.12)", borderRadius: 8, padding: "2px 8px" }}>×{r.anzahl}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const stepBtnKlein: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 10, border: "1.5px solid var(--border)",
  background: "var(--card-bg)", color: "var(--text)", fontSize: "1.2rem", fontWeight: 800,
  cursor: "pointer", lineHeight: 1, flexShrink: 0, fontFamily: "'Ubuntu', sans-serif",
};
