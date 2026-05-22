"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useSession }     from "next-auth/react";
import { api }            from "@/trpc/react";
import { useToast }       from "@/components/ui/Toast";
import { useSocket }      from "@/hooks/useSocket";
import { EVENTS }         from "@/modules/realtime/events";
import GruppenNachrichten from "./components/GruppenNachrichten";
import { type AnfrageRow, type GruppeData } from "./components/constants";
import {
  Cpu, Monitor, MonitorSmartphone, Mouse, Square, Keyboard,
  Volume2, CircleDot, Power, Usb, Network, Wifi,
  Battery, Box, Plug, Loader2, MessageCircle, type LucideIcon,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionUser = { name?: string; kuerzel?: string; rolle?: string };
type GeraetInfo  = { logId: string; bereinigt: string };

// ── Constants & design tokens ─────────────────────────────────────────────────

const CYAN    = "#008BD2";
const PRIMARY = "#202F61";
const GREEN   = "#04B475";

// Status in leichter Sprache
const STATUS_CFG: Record<string, { text: string; color: string; bg: string }> = {
  NEU:            { text: "Neu",            color: "#005fa3", bg: "#dbeafe" },
  BEDARF:         { text: "Wird bestellt",  color: "#92400e", bg: "#fef3c7" },
  IN_BEARBEITUNG: { text: "In Bearbeitung", color: "#92400e", bg: "#fef3c7" },
  ABGESCHLOSSEN:  { text: "Abgeschlossen",  color: "#15803d", bg: "#dcfce7" },
  STORNIERT:      { text: "Storniert",      color: "#6b7280", bg: "#f3f4f6" },
};

// Icon-Mapping für die 17 Standard-Teiltypen
const TEIL_ICON: Record<string, LucideIcon> = {
  "Mainboard":        Cpu,
  "Display":          Monitor,
  "Displaymodul":     MonitorSmartphone,
  "Touchpad":         Mouse,
  "Touchpad Buttons": Square,
  "Tastatur":         Keyboard,
  "Lautsprecher":     Volume2,
  "Füße vorne":       CircleDot,
  "Füße hinten":      CircleDot,
  "Power Button":     Power,
  "USB Board":        Usb,
  "LAN Board":        Network,
  "WLAN/UMTS Karte":  Wifi,
  "Akku":             Battery,
  "D-Cover":          Box,
  "DC IN":            Plug,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeZeit(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60)   return "gerade eben";
  const m = Math.floor(s / 60);
  if (m < 60)   return `vor ${m} Minute${m !== 1 ? "n" : ""}`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `vor ${h} Stunde${h !== 1 ? "n" : ""}`;
  const d = Math.floor(h / 24);
  if (d === 1)  return "gestern";
  if (d < 7)    return `vor ${d} Tagen`;
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function gruppeStatus(g: GruppeData): string {
  const ss = g.anfragen.map(a => a.status);
  if (ss.every(s => s === "ABGESCHLOSSEN" || s === "STORNIERT")) return "ABGESCHLOSSEN";
  if (ss.some(s => s === "IN_BEARBEITUNG"))                       return "IN_BEARBEITUNG";
  if (ss.some(s => s === "BEDARF"))                               return "BEDARF";
  return "NEU";
}

function buildGruppen(anfragen: AnfrageRow[]): GruppeData[] {
  const map = new Map<string, GruppeData>();
  for (const a of anfragen) {
    const raw = (a.logId ?? "").trim();
    const key = raw && raw !== "unbekannt"
      ? raw
      : (a as { gruppenNr?: string | null }).gruppenNr ?? `datum-${new Date(a.datum).toISOString().slice(0, 10)}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        logId:       raw || null,
        gruppenNr:   (a as { gruppenNr?: string | null }).gruppenNr ?? null,
        geraeteName: a.geraeteName ?? null,
        datum:       new Date(a.datum),
        anfragen:    [],
      });
    }
    const g = map.get(key)!;
    if (!g.anfragen.some(x => x.teil === a.teil && x.status === a.status)) {
      g.anfragen.push(a as AnfrageRow);
    }
    if (new Date(a.datum) > g.datum) g.datum = new Date(a.datum);
  }
  return Array.from(map.values()).sort((a, b) => b.datum.getTime() - a.datum.getTime());
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TechnikerPage() {
  const { data: session } = useSession();
  const user     = session?.user as SessionUser | undefined;
  const kuerzel  = user?.kuerzel ?? "";
  const vorname  = user?.name?.split(" ")[0] ?? kuerzel;
  const { on, off } = useSocket();

  const [showFlow,     setShowFlow]     = useState(false);
  const [detailGruppe, setDetailGruppe] = useState<GruppeData | null>(null);

  // ── Anfragen ───────────────────────────────────────────────────────────────

  const anfragenQuery = api.anfragen.getByTechniker.useQuery(
    { kuerzel, showAll: true, limit: 100 },
    { enabled: !!kuerzel, staleTime: 4_000 },
  );

  useEffect(() => {
    if (!kuerzel) return;
    const refresh = () => anfragenQuery.refetch();
    on(EVENTS.ANFRAGE_UPDATED, refresh);
    on(EVENTS.ANFRAGE_NEU,     refresh);
    const iv = setInterval(refresh, 5_000);
    return () => { off(EVENTS.ANFRAGE_UPDATED); off(EVENTS.ANFRAGE_NEU); clearInterval(iv); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kuerzel]);

  const alleAnfragen = anfragenQuery.data?.anfragen ?? [];
  const gruppen      = useMemo(() => buildGruppen(alleAnfragen), [alleAnfragen]);

  // Keep detail modal in sync when live data arrives
  useEffect(() => {
    if (!detailGruppe) return;
    const updated = gruppen.find(g => g.key === detailGruppe.key);
    if (updated) setDetailGruppe(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gruppen]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.5rem 1.25rem 3rem" }}>

      {/* ── Begrüßung ── */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: "0 0 0.1rem", fontSize: "1.6rem", fontWeight: 800, lineHeight: 1.2 }}>
          Hallo {vorname || kuerzel || "…"},
        </h1>
        <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "1rem" }}>
          hier ist deine Übersicht.
        </p>
      </div>

      {/* ── Two-column grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Left: Aktions-Card ── */}
        <div>
          <button
            onClick={() => setShowFlow(true)}
            style={{
              display:       "flex",
              flexDirection: "column",
              alignItems:    "flex-start",
              width:         "100%",
              padding:       "1.5rem 1.75rem",
              background:    CYAN,
              color:         "white",
              border:        "none",
              borderRadius:  16,
              cursor:        "pointer",
              textAlign:     "left",
              boxShadow:     "0 4px 20px rgba(0,139,210,0.30)",
              fontFamily:    "'Ubuntu', sans-serif",
              minHeight:     100,
              transition:    "transform 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(0,139,210,0.45)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,139,210,0.30)"; }}
          >
            <span style={{ fontSize: "1.375rem", fontWeight: 800, lineHeight: 1.2 }}>
              Ersatzteile anfragen
            </span>
            <span style={{ fontSize: "1rem", opacity: 0.9, marginTop: "0.4rem" }}>
              Tippen oder Gerät scannen
            </span>
          </button>
        </div>

        {/* ── Right: Anfragen-Liste ── */}
        <div>
          <h2 style={{ margin: "0 0 0.875rem", fontSize: "1.2rem", fontWeight: 700 }}>
            Deine Anfragen
          </h2>

          {anfragenQuery.isLoading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "3rem 0", color: "var(--text-dim)" }}>
              <Loader2 size={20} style={{ animation: "tkSpin 0.8s linear infinite" }} />
              Wird geladen
              <style>{`@keyframes tkSpin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          {!anfragenQuery.isLoading && gruppen.length === 0 && (
            <div style={{ padding: "1.5rem", background: "var(--card-bg)", borderRadius: 12, border: "1px solid var(--border)", color: "var(--text-dim)", textAlign: "center" }}>
              Du hast noch keine Anfragen gestellt.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {gruppen.map(g => (
              <AnfrageKarte
                key={g.key}
                gruppe={g}
                onClick={() => setDetailGruppe(g)}
              />
            ))}
          </div>
        </div>

      </div>{/* end grid */}

      {/* ── Modals ── */}
      {showFlow && (
        <AnfrageFlow
          kuerzel={kuerzel}
          onClose={() => setShowFlow(false)}
          onSuccess={() => { setShowFlow(false); anfragenQuery.refetch(); }}
        />
      )}
      {detailGruppe && (
        <AnfrageDetailModal
          gruppe={detailGruppe}
          kuerzel={kuerzel}
          onClose={() => { setDetailGruppe(null); anfragenQuery.refetch(); }}
        />
      )}
    </div>
  );
}

// ── AnfrageKarte ──────────────────────────────────────────────────────────────

function ChatBadge({ anfrageId }: { anfrageId: number }) {
  const { data } = api.chat.getStatsForAnfrage.useQuery(
    { anfrageId },
    { refetchInterval: 5_000, staleTime: 3_000 },
  );
  const n = data?.ungelesen ?? 0;
  if (n === 0) return null;
  return (
    <span style={{
      display:      "inline-flex",
      alignItems:   "center",
      gap:          5,
      background:   "rgba(0,139,210,0.10)",
      color:        "#005fa3",
      borderRadius: 20,
      padding:      "3px 10px",
      fontSize:     "0.82rem",
      fontWeight:   700,
    }}>
      <MessageCircle size={13} />
      {n === 1 ? "1 neue Nachricht" : `${n} neue Nachrichten`}
    </span>
  );
}

function AnfrageKarte({ gruppe, onClick }: { gruppe: GruppeData; onClick: () => void }) {
  const status   = gruppeStatus(gruppe);
  const cfg      = STATUS_CFG[status] ?? STATUS_CFG.NEU!;
  const teileAnz = gruppe.anfragen.length;
  const hasLogId = !!(gruppe.logId && gruppe.logId !== "unbekannt");
  const geraet   = gruppe.geraeteName ?? (hasLogId ? gruppe.logId! : "Unbekanntes Gerät");
  const firstId  = gruppe.anfragen[0]?.id;

  return (
    <button
      onClick={onClick}
      className="block w-full text-left transition-all duration-200 hover:border-[#008BD2] hover:shadow-md active:scale-[0.99]"
      style={{
        padding:      "1.1rem 1.25rem",
        background:   "var(--card-bg)",
        border:       "1.5px solid var(--border)",
        borderRadius: 16,
        cursor:       "pointer",
        fontFamily:   "'Ubuntu', sans-serif",
        color:        "var(--text)",
        minHeight:    72,
        boxShadow:    "0 1px 4px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: "0.3rem" }}>
        <span style={{ fontWeight: 700, fontSize: "1.05rem", lineHeight: 1.3, flex: 1 }}>
          {geraet}
        </span>
        <span style={{
          background:   cfg.bg,
          color:        cfg.color,
          borderRadius: 20,
          padding:      "3px 11px",
          fontSize:     "0.8rem",
          fontWeight:   700,
          flexShrink:   0,
        }}>
          {cfg.text}
        </span>
      </div>

      <div style={{ fontSize: "0.875rem", color: "var(--text-dim)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span>{teileAnz} {teileAnz === 1 ? "Teil" : "Teile"} angefragt</span>
        <span aria-hidden>·</span>
        <span>{relativeZeit(new Date(gruppe.datum))}</span>
      </div>

      {firstId !== undefined && (
        <div style={{ marginTop: "0.5rem" }}>
          <ChatBadge anfrageId={firstId} />
        </div>
      )}
    </button>
  );
}

// ── AnfrageFlow (Modal) ───────────────────────────────────────────────────────

type FlowStep = "logid" | "teile" | "sending" | "done";

function AnfrageFlow({
  kuerzel,
  onClose,
  onSuccess,
}: {
  kuerzel:   string;
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const { show } = useToast();

  const [step,           setStep]           = useState<FlowStep>("logid");
  const [logIdInput,     setLogIdInput]     = useState("");
  const [logIdQuery,     setLogIdQuery]     = useState<string | null>(null);
  const [selectedGeraet, setSelectedGeraet] = useState<GeraetInfo | null>(null);
  const [selectedTeile,  setSelectedTeile]  = useState<Set<string>>(new Set());
  const [sonderBeschr,   setSonderBeschr]   = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const logIdLookup = api.geraeteLookup.byLogId.useQuery(
    { logId: logIdQuery ?? "" },
    { enabled: !!logIdQuery, retry: false, staleTime: 0 },
  );

  const teileQuery = api.kompatibilitaet.getByGeraetMitStandard.useQuery(
    { geraet: selectedGeraet?.bereinigt ?? "" },
    { enabled: !!selectedGeraet, staleTime: 60_000 },
  );

  const addItemMutation   = api.warenkorb.addItem.useMutation();
  const addSonderMutation = api.warenkorb.addSonderAnfrage.useMutation();
  const submitMutation    = api.warenkorb.submitAlle.useMutation();

  // Step 1 result → Step 2
  useEffect(() => {
    if (!logIdLookup.data) return;
    if (logIdLookup.data.gefunden) {
      setSelectedGeraet({ logId: logIdLookup.data.logId, bereinigt: logIdLookup.data.bereinigt });
      setStep("teile");
    } else {
      show(`LogID „${logIdQuery}" nicht gefunden. Bitte erneut versuchen.`, "error");
    }
    setLogIdQuery(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logIdLookup.data]);

  // Autofocus on logid step
  useEffect(() => {
    if (step === "logid") setTimeout(() => inputRef.current?.focus(), 80);
  }, [step]);

  function handleLogIdSubmit() {
    const clean = logIdInput.trim().replace(/\./g, "");
    if (!clean || !/^\d{5,}$/.test(clean)) {
      show("Bitte eine gültige LogID eingeben (nur Ziffern)", "error");
      return;
    }
    setLogIdQuery(clean);
  }

  function toggleTeil(teiltyp: string) {
    setSelectedTeile(prev => {
      const next = new Set(prev);
      if (next.has(teiltyp)) next.delete(teiltyp); else next.add(teiltyp);
      return next;
    });
  }

  function resetFlow() {
    setStep("logid");
    setLogIdInput("");
    setLogIdQuery(null);
    setSelectedGeraet(null);
    setSelectedTeile(new Set());
    setSonderBeschr("");
  }

  async function handleSenden() {
    if (!selectedGeraet || !kuerzel) return;
    if (selectedTeile.size === 0 && !sonderBeschr.trim()) {
      show("Bitte mindestens ein Teil auswählen", "warning");
      return;
    }
    setStep("sending");
    try {
      const logId = selectedGeraet.logId === "---" ? "unbekannt" : selectedGeraet.logId;
      const teile = teileQuery.data?.teile ?? [];

      for (const teiltyp of Array.from(selectedTeile)) {
        const info = teile.find(t => t.teiltyp === teiltyp);
        await addItemMutation.mutateAsync({
          techniker:   kuerzel,
          logId,
          geraeteName: selectedGeraet.bereinigt,
          artikelId:   info?.artikelId ?? null,
          teiltyp,
        });
      }

      if (sonderBeschr.trim()) {
        await addSonderMutation.mutateAsync({
          techniker:       kuerzel,
          logId,
          geraeteName:     selectedGeraet.bereinigt,
          beschreibung:    sonderBeschr.trim(),
          sonderKategorie: "Sonstiges",
        });
      }

      await submitMutation.mutateAsync({ techniker: kuerzel });
      setStep("done");
    } catch (e) {
      show(`Fehler: ${(e as { message?: string }).message ?? "Unbekannt"}`, "error");
      setStep("teile");
    }
  }

  const teile    = teileQuery.data?.teile ?? [];
  const canSend  = selectedTeile.size > 0 || sonderBeschr.trim().length > 0;
  const sendLabel = (() => {
    const n = selectedTeile.size + (sonderBeschr.trim() ? 1 : 0);
    if (n === 0) return "Bitte mindestens ein Teil auswählen";
    return `Anfrage senden (${n} ${n === 1 ? "Teil" : "Teile"})`;
  })();

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={step === "done" || step === "sending" ? undefined : onClose}
    >
      <div
        className="modal-enter"
        style={{ width: "100%", maxWidth: 680, background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto", color: "var(--text)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Step 1: LogID ── */}
        {step === "logid" && (
          <div key="logid" className="step-enter" style={{ padding: "1.5rem 1.5rem 2rem" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
              <button onClick={onClose} aria-label="Schließen" style={closeBtn}>✕</button>
            </div>
            <p style={{ margin: "0 0 1.2rem", fontSize: "1.1rem", fontWeight: 600 }}>
              Scanne die LogID oder tippe sie ein
            </p>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={logIdInput}
              onChange={e => setLogIdInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleLogIdSubmit(); }}
              placeholder="z. B. 212560810"
              style={{
                width:        "100%",
                padding:      "1rem 1.2rem",
                fontSize:     "1.4rem",
                border:       "2px solid var(--border)",
                borderRadius: 12,
                background:   "var(--bg)",
                color:        "var(--text)",
                fontFamily:   "'Ubuntu', sans-serif",
                boxSizing:    "border-box",
                outline:      "none",
                marginBottom: "1rem",
              }}
              onFocus={e  => (e.currentTarget.style.borderColor = CYAN)}
              onBlur={e   => (e.currentTarget.style.borderColor = "var(--border)")}
            />
            <button
              onClick={handleLogIdSubmit}
              disabled={!logIdInput.trim() || logIdLookup.isLoading}
              style={primaryBtn(canSend || !!logIdInput.trim())}
            >
              {logIdLookup.isLoading ? "Wird gesucht…" : "Gerät suchen →"}
            </button>
          </div>
        )}

        {/* ── Step 2: Teile-Auswahl ── */}
        {step === "teile" && selectedGeraet && (
          <div key="teile" className="step-enter" style={{ padding: "1.5rem 1.5rem 2rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
              <div>
                <h2 style={{ margin: "0 0 0.2rem", fontSize: "1.25rem", fontWeight: 800, lineHeight: 1.2 }}>
                  {selectedGeraet.bereinigt}
                </h2>
                {selectedGeraet.logId !== "---" && (
                  <div style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
                    {selectedGeraet.logId}
                  </div>
                )}
              </div>
              <button onClick={() => setStep("logid")} style={backBtn}>← Zurück</button>
            </div>

            <p style={{ margin: "0 0 1rem", fontWeight: 700, fontSize: "1.05rem" }}>
              Welche Teile brauchst du?
            </p>

            {teileQuery.isLoading ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
                Teile werden geladen…
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "0.6rem", marginBottom: "1.5rem" }}>
                {teile.map(t => {
                  const sel  = selectedTeile.has(t.teiltyp);
                  const Icon = TEIL_ICON[t.teiltyp] ?? Box;
                  return (
                    <button
                      key={t.teiltyp}
                      onClick={() => toggleTeil(t.teiltyp)}
                      className="active:scale-95"
                      style={{
                        padding:        "0.9rem 0.5rem 0.75rem",
                        borderRadius:   12,
                        border:         sel ? `2px solid ${CYAN}` : "1.5px solid var(--border)",
                        background:     sel ? "rgba(0,139,210,0.08)" : "var(--card-bg)",
                        color:          sel ? "#005fa3" : "var(--text)",
                        cursor:         "pointer",
                        fontWeight:     sel ? 800 : 600,
                        fontFamily:     "'Ubuntu', sans-serif",
                        fontSize:       "0.88rem",
                        textAlign:      "center",
                        minHeight:      100,
                        lineHeight:     1.25,
                        display:        "flex",
                        flexDirection:  "column",
                        alignItems:     "center",
                        justifyContent: "center",
                        gap:            8,
                        transition:     "background 0.1s, border-color 0.1s",
                        position:       "relative",
                      }}
                    >
                      <Icon
                        size={28}
                        style={{ color: sel ? "#005fa3" : "var(--text-dim)", flexShrink: 0 }}
                      />
                      <span>{t.teiltyp}</span>
                      {sel && (
                        <span style={{
                          position:   "absolute",
                          top:        6,
                          right:      8,
                          fontSize:   "0.75rem",
                          fontWeight: 900,
                          color:      CYAN,
                        }}>✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Freitext-Sonderanfrage */}
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "0.4rem", fontSize: "0.95rem" }}>
                Etwas anderes?
              </label>
              <input
                type="text"
                value={sonderBeschr}
                onChange={e => setSonderBeschr(e.target.value)}
                placeholder="z. B. Schraube D-Cover, Spezial-Kabel…"
                style={{
                  width:        "100%",
                  padding:      "0.8rem 1rem",
                  borderRadius: 10,
                  border:       "1.5px solid var(--border)",
                  background:   "var(--bg)",
                  color:        "var(--text)",
                  fontFamily:   "'Ubuntu', sans-serif",
                  fontSize:     "0.95rem",
                  boxSizing:    "border-box",
                  outline:      "none",
                }}
                onFocus={e => (e.currentTarget.style.borderColor = CYAN)}
                onBlur={e  => (e.currentTarget.style.borderColor = "var(--border)")}
              />
            </div>

            <button
              onClick={handleSenden}
              disabled={!canSend}
              style={primaryBtn(canSend, GREEN)}
            >
              {sendLabel}
            </button>
          </div>
        )}

        {/* ── Step: Sending ── */}
        {step === "sending" && (
          <div key="sending" className="step-enter" style={{ padding: "4rem 2rem", textAlign: "center" }}>
            <div style={{ width: 44, height: 44, border: `4px solid rgba(0,139,210,0.2)`, borderTopColor: CYAN, borderRadius: "50%", animation: "tkSpin 0.7s linear infinite", margin: "0 auto 1rem" }} />
            <p style={{ color: "var(--text-dim)", fontSize: "1rem", margin: 0 }}>Anfrage wird gesendet…</p>
            <style>{`@keyframes tkSpin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === "done" && (
          <div key="done" className="step-enter" style={{ padding: "3rem 2rem", textAlign: "center" }}>
            <div style={{ fontSize: "3.5rem", marginBottom: "0.75rem", lineHeight: 1 }}>✅</div>
            <h2 style={{ margin: "0 0 0.4rem", fontSize: "1.5rem", fontWeight: 800 }}>Danke!</h2>
            <p style={{ color: "var(--text-dim)", margin: "0 0 0.25rem", fontSize: "1rem" }}>
              Deine Anfrage wurde gesendet.
            </p>
            <p style={{ color: "var(--text-dim)", margin: "0 0 2rem", fontSize: "1rem" }}>
              Wir kümmern uns darum.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={resetFlow} style={secondaryBtn}>
                Noch eine Anfrage stellen
              </button>
              <button onClick={onSuccess} style={primaryBtn(true)}>
                Zur Übersicht
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AnfrageDetailModal ────────────────────────────────────────────────────────

function AnfrageDetailModal({
  gruppe,
  kuerzel,
  onClose,
}: {
  gruppe:  GruppeData;
  kuerzel: string;
  onClose: () => void;
}) {
  const { show }             = useToast();
  const [confirmStorno, setConfirmStorno] = useState(false);
  const [stornoLoading, setStornoLoading] = useState(false);

  const storniereMutation = api.anfragen.storniere.useMutation();

  const hasLogId      = !!(gruppe.logId && gruppe.logId !== "unbekannt");
  const geraet        = gruppe.geraeteName ?? (hasLogId ? gruppe.logId! : "Unbekanntes Gerät");
  const status        = gruppeStatus(gruppe);
  const cfg           = STATUS_CFG[status] ?? STATUS_CFG.NEU!;
  const stornoItems   = gruppe.anfragen.filter(a => a.status === "NEU" || a.status === "BEDARF");
  const kannStornieren = stornoItems.length > 0;

  async function handleStornoConfirm() {
    setStornoLoading(true);
    try {
      for (const a of stornoItems) {
        await storniereMutation.mutateAsync({ techniker: kuerzel, logId: a.logId, teil: a.teil });
      }
      show("Anfrage storniert", "success");
      onClose();
    } catch (e) {
      show(`Fehler: ${(e as { message?: string }).message ?? "Unbekannt"}`, "error");
    } finally {
      setStornoLoading(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}
    >
      <div
        className="modal-enter"
        style={{ width: "100%", maxWidth: 680, background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto", color: "var(--text)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1.25rem 1.5rem 0" }}>
          <div>
            <h2 style={{ margin: "0 0 0.2rem", fontSize: "1.25rem", fontWeight: 800 }}>{geraet}</h2>
            {hasLogId && (
              <div style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>{gruppe.logId}</div>
            )}
          </div>
          <button onClick={onClose} aria-label="Schließen" style={closeBtn}>✕</button>
        </div>

        <div style={{ padding: "1rem 1.5rem 2rem" }}>

          {/* Status */}
          <div style={{ marginBottom: "1.25rem" }}>
            <span style={{
              background:   cfg.bg,
              color:        cfg.color,
              borderRadius: 20,
              padding:      "4px 14px",
              fontSize:     "0.9rem",
              fontWeight:   700,
            }}>
              Status: {cfg.text}
            </span>
          </div>

          {/* Teile-Liste */}
          <div style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ margin: "0 0 0.6rem", fontSize: "1rem", fontWeight: 700 }}>
              Du hast diese Teile angefragt:
            </h3>
            <ul style={{ margin: 0, padding: "0 0 0 1.2rem", lineHeight: 2 }}>
              {gruppe.anfragen.map(a => {
                const aCfg = STATUS_CFG[a.status] ?? STATUS_CFG.NEU!;
                return (
                  <li key={a.id} style={{ fontSize: "1rem" }}>
                    {a.teil}
                    {" "}
                    <span style={{
                      background:   aCfg.bg,
                      color:        aCfg.color,
                      borderRadius: 20,
                      padding:      "1px 8px",
                      fontSize:     "0.78rem",
                      fontWeight:   700,
                    }}>
                      {aCfg.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Nachrichten */}
          <div style={{ marginBottom: kannStornieren ? "1.5rem" : 0 }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem", fontWeight: 700 }}>
              Nachrichten
            </h3>
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <GruppenNachrichten
                anfrageId={gruppe.anfragen[0]!.id}
                kuerzel={kuerzel}
                bezugInfo={geraet}
              />
            </div>
          </div>

          {/* Storno */}
          {kannStornieren && (
            <div>
              <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "0 0 1rem" }} />
              {!confirmStorno ? (
                <button
                  onClick={() => setConfirmStorno(true)}
                  style={{
                    padding:      "0.8rem 1.4rem",
                    background:   "transparent",
                    border:       "1.5px solid #ef4444",
                    color:        "#ef4444",
                    borderRadius: 10,
                    cursor:       "pointer",
                    fontFamily:   "'Ubuntu', sans-serif",
                    fontWeight:   700,
                    minHeight:    56,
                    fontSize:     "0.95rem",
                  }}
                >
                  Anfrage stornieren
                </button>
              ) : (
                <div style={{ background: "rgba(239,68,68,0.05)", border: "1.5px solid #ef4444", borderRadius: 12, padding: "1rem" }}>
                  <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.95rem" }}>
                    Wirklich stornieren?
                  </p>
                  <p style={{ margin: "0 0 1rem", color: "var(--text-dim)", fontSize: "0.9rem" }}>
                    Diese Aktion kann nicht rückgängig gemacht werden.
                  </p>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={() => setConfirmStorno(false)}
                      style={{ ...secondaryBtn, flex: 1 }}
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={handleStornoConfirm}
                      disabled={stornoLoading}
                      style={{
                        flex:         2,
                        padding:      "0.8rem",
                        background:   "#ef4444",
                        color:        "white",
                        border:       "none",
                        borderRadius: 8,
                        cursor:       stornoLoading ? "wait" : "pointer",
                        fontFamily:   "'Ubuntu', sans-serif",
                        fontWeight:   700,
                        opacity:      stornoLoading ? 0.7 : 1,
                        minHeight:    56,
                        fontSize:     "0.95rem",
                      }}
                    >
                      {stornoLoading ? "Wird storniert…" : "Ja, stornieren"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared button styles ──────────────────────────────────────────────────────

function primaryBtn(enabled: boolean, bg = PRIMARY): React.CSSProperties {
  return {
    width:        "100%",
    padding:      "1rem",
    fontSize:     "1rem",
    background:   enabled ? bg : "var(--border)",
    color:        enabled ? "white" : "var(--text-dim)",
    border:       "none",
    borderRadius: 12,
    cursor:       enabled ? "pointer" : "not-allowed",
    fontWeight:   800,
    fontFamily:   "'Ubuntu', sans-serif",
    minHeight:    56,
    transition:   "background 0.15s",
  };
}

const secondaryBtn: React.CSSProperties = {
  padding:      "0.8rem 1.2rem",
  background:   "var(--bg)",
  border:       "1.5px solid var(--border)",
  borderRadius: 10,
  cursor:       "pointer",
  fontFamily:   "'Ubuntu', sans-serif",
  fontWeight:   700,
  color:        "var(--text)",
  minHeight:    56,
  fontSize:     "0.95rem",
};

const closeBtn: React.CSSProperties = {
  background:  "none",
  border:      "none",
  cursor:      "pointer",
  fontSize:    "1.3rem",
  color:       "var(--text-dim)",
  padding:     "4px 8px",
  lineHeight:  1,
  minHeight:   44,
  minWidth:    44,
};

const backBtn: React.CSSProperties = {
  background:  "none",
  border:      "none",
  cursor:      "pointer",
  color:       "var(--text-dim)",
  fontSize:    "0.9rem",
  padding:     "4px 8px",
  fontFamily:  "'Ubuntu', sans-serif",
  minHeight:   44,
};
