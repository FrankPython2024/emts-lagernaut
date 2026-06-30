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
                      {a.modell} <span style={{ color: "var(--text-dim)", fontWeight: 500 }}>· {a.teiltyp}{a.menge > 1 ? ` ×${a.menge}` : ""}</span>
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

// Pop-up mit den Teiltypen (NEU/BEDARF). Teiltyp antippen → Anfrage-Dialog darüber.
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
  const [dialog, setDialog] = useState<{ teiltyp: string; bestand: number } | null>(null);
  const teiltypenQ = api.mobilAnfrage.teiltypen.useQuery({ bereich, modellId });

  // Escape schließt (nur wenn kein Anfrage-Dialog offen ist).
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !dialog) onClose(); };
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = prev; };
  }, [onClose, dialog]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Teile für ${modellName}`} onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 620, background: "var(--card-bg)", color: "var(--text)", borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.3)", fontFamily: "'Ubuntu', sans-serif", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800 }}>{modellName}</h2>
            <div style={{ marginTop: 2, fontSize: "0.85rem", color: "var(--text-dim)" }}>
              {BEREICH_LABEL(bereich)} · Teil zum Anfragen wählen
            </div>
          </div>
          <button onClick={onClose} aria-label="Schließen"
            style={{ width: 44, height: 44, borderRadius: 10, border: "none", background: "transparent", color: "var(--text-dim)", fontSize: "1.5rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem", overflowY: "auto" }}>
          {teiltypenQ.isLoading ? (
            <Hint>Wird geladen…</Hint>
          ) : (teiltypenQ.data ?? []).length === 0 ? (
            <Hint>Für dieses Modell ist aktuell kein Teil auf Lager.</Hint>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.6rem" }}>
              {(teiltypenQ.data ?? []).map((t) => (
                <button key={t.teiltyp} type="button"
                  onClick={() => setDialog({ teiltyp: t.teiltyp, bestand: t.bestand })}
                  style={{ ...card, padding: "0.85rem 0.75rem", minHeight: 84, cursor: "pointer", textAlign: "center",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{t.teiltyp}</span>
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: 20, padding: "2px 10px" }}>
                    {t.bestand} verfügbar
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Anfrage-Dialog (Menge + Kommentar) — über dem Modell-Pop-up */}
      {dialog && (
        <AnfrageDialog
          bereich={bereich}
          modellId={modellId}
          modellName={modellName}
          teiltyp={dialog.teiltyp}
          bestand={dialog.bestand}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); onDone(); }}
          show={show}
        />
      )}
    </div>
  );
}

// Dialog: Menge + optionaler Kommentar, dann anfragen.
function AnfrageDialog({
  bereich, modellId, modellName, teiltyp, bestand, onClose, onDone, show,
}: {
  bereich: Bereich;
  modellId: number;
  modellName: string;
  teiltyp: string;
  bestand: number;
  onClose: () => void;
  onDone: () => void;
  show: (msg: string, typ?: "success" | "error" | "info" | "warning") => void;
}) {
  const [menge, setMenge]         = useState(1);
  const [kommentar, setKommentar] = useState("");
  const erstellen = api.mobilAnfrage.erstellen.useMutation({
    onSuccess: () => { show("Anfrage gesendet ✅", "success"); onDone(); },
    onError: (e) => show(e.message, "error"),
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, background: "var(--card-bg)", color: "var(--text)", borderRadius: 18, boxShadow: "0 8px 40px rgba(0,0,0,0.3)", fontFamily: "'Ubuntu', sans-serif", padding: "1.5rem" }}>
        <div style={{ fontSize: "1.25rem", fontWeight: 800 }}>{teiltyp}</div>
        <div style={{ marginTop: 2, color: "var(--text-dim)", fontSize: "0.9rem" }}>
          {modellName} · {BEREICH_LABEL(bereich)}
          <span style={{ marginLeft: 8, fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: 20, padding: "1px 9px", fontSize: "0.8rem" }}>{bestand} verfügbar</span>
        </div>

        <label style={{ display: "block", marginTop: "1.25rem", fontWeight: 700, fontSize: "0.95rem" }}>Menge</label>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
          <button type="button" aria-label="weniger" onClick={() => setMenge((m) => Math.max(1, m - 1))} style={stepBtn}>−</button>
          <span style={{ minWidth: 40, textAlign: "center", fontSize: "1.3rem", fontWeight: 800 }}>{menge}</span>
          <button type="button" aria-label="mehr" onClick={() => setMenge((m) => Math.min(99, m + 1))} style={stepBtn}>+</button>
        </div>

        <label style={{ display: "block", marginTop: "1.25rem", fontWeight: 700, fontSize: "0.95rem" }}>Kommentar (optional)</label>
        <input type="text" value={kommentar} onChange={(e) => setKommentar(e.target.value)}
          placeholder="z. B. Defekt, Farbe, Besonderheit"
          style={{ width: "100%", marginTop: 6, padding: "0.75rem 0.9rem", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.95rem", boxSizing: "border-box", outline: "none" }} />

        <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.5rem", justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}
            style={{ minHeight: 52, padding: "0 1.2rem", borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--card-bg)", color: "var(--text)", fontWeight: 700, cursor: "pointer", fontFamily: "'Ubuntu', sans-serif" }}>
            Abbrechen
          </button>
          <button type="button" disabled={erstellen.isPending}
            onClick={() => erstellen.mutate({ bereich, modellId, teiltyp, menge, kommentar: kommentar.trim() || undefined })}
            style={{ minHeight: 52, padding: "0 1.5rem", borderRadius: 12, border: "none", background: GREEN, color: "white", fontWeight: 800, cursor: "pointer", opacity: erstellen.isPending ? 0.6 : 1, fontFamily: "'Ubuntu', sans-serif" }}>
            {erstellen.isPending ? "Sende…" : "Anfrage senden"}
          </button>
        </div>
      </div>
    </div>
  );
}

const stepBtn: React.CSSProperties = {
  width: 52, height: 52, borderRadius: 12, border: "1.5px solid var(--border)",
  background: "var(--card-bg)", color: "var(--text)", fontSize: "1.5rem", fontWeight: 800,
  cursor: "pointer", lineHeight: 1, fontFamily: "'Ubuntu', sans-serif",
};
