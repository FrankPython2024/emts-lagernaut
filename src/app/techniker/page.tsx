"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { useSession }     from "next-auth/react";
import FocusTrap          from "focus-trap-react";
import { api }            from "@/trpc/react";
import { useToast }       from "@/components/ui/Toast";
import { useSocket }      from "@/hooks/useSocket";
import { EVENTS }         from "@/modules/realtime/events";
import GruppenNachrichten from "./components/GruppenNachrichten";
import { type AnfrageRow, type GruppeData } from "./components/constants";
import { Loader2, MessageCircle } from "lucide-react";
import { getLucideIcon } from "@/lib/icons/getLucideIcon";

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
  BEDARF:         { text: "Bedarf",          color: "#92400e", bg: "#fef3c7" },
  IN_BEARBEITUNG: { text: "In Bearbeitung", color: "#92400e", bg: "#fef3c7" },
  ABGESCHLOSSEN:  { text: "Abgeschlossen",  color: "#15803d", bg: "#dcfce7" },
  STORNIERT:      { text: "Storniert",      color: "#6b7280", bg: "#f3f4f6" },
};

// Icon-Mapping wird zur Laufzeit aus der Teiltyp-Tabelle aufgebaut
// (api.teiltypen.list → name → icon-Name → LucideIcon via getLucideIcon).

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLogId(logId: string): string {
  const clean = logId.replace(/\D/g, "");
  return clean.replace(/(\d{3})(?=\d)/g, "$1.");
}

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
  if (ss.every(s => s === "STORNIERT"))                           return "STORNIERT";
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
    if (!g.anfragen.some(x => x.id === a.id)) {
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
  const { on, off } = useSocket();

  const [showFlow,         setShowFlow]         = useState(false);
  const [flowInitialLogId, setFlowInitialLogId] = useState<string | null>(null);
  const [cardLogId,        setCardLogId]        = useState("");
  const [detailGruppe,     setDetailGruppe]     = useState<GruppeData | null>(null);
  const [suchTerm,         setSuchTerm]         = useState("");

  function startFlow(logId: string | null) {
    setFlowInitialLogId(logId);
    setShowFlow(true);
  }

  function handleCardLogIdSubmit() {
    const clean = cardLogId.replace(/\D/g, "");
    if (clean.length < 5) return;
    startFlow(clean);
    setCardLogId("");
  }

  // ── Anfragen ───────────────────────────────────────────────────────────────

  const anfragenQuery = api.anfragen.getByTechniker.useQuery(
    { kuerzel, showAll: true, limit: 100 },
    { enabled: !!kuerzel, staleTime: 60_000 },
  );

  // Socket-Events sind die alleinige Update-Quelle — kein setInterval-Polling mehr
  useEffect(() => {
    if (!kuerzel) return;
    const refresh = () => anfragenQuery.refetch();
    on(EVENTS.ANFRAGE_UPDATED, refresh);
    on(EVENTS.ANFRAGE_NEU,     refresh);
    return () => { off(EVENTS.ANFRAGE_UPDATED); off(EVENTS.ANFRAGE_NEU); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kuerzel]);

  const alleAnfragen = anfragenQuery.data?.anfragen ?? [];
  const gruppen      = useMemo(() => buildGruppen(alleAnfragen), [alleAnfragen]);

  const gefilterteGruppen = useMemo(() => {
    const term = suchTerm.trim().replace(/\./g, "").toLowerCase();
    if (!term) return gruppen;
    return gruppen.filter(g =>
      (g.logId   ?? "").replace(/\./g, "").toLowerCase().includes(term) ||
      (g.geraeteName ?? "").toLowerCase().includes(term),
    );
  }, [gruppen, suchTerm]);

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

      {/* ── Two-column grid (kein Begrüßungs-Header) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* ── Left: Aktions-Card mit eingebettetem LogID-Input ── */}
        <div
          className="rounded-2xl"
          style={{
            padding:    "1.75rem 2.25rem 2rem",
            background: `linear-gradient(135deg, ${CYAN} 0%, #0676AD 100%)`,
            color:      "white",
            fontFamily: "'Ubuntu', sans-serif",
            boxShadow:  "0 4px 14px rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ fontSize: "1.75rem", fontWeight: 800, lineHeight: 1.2, marginBottom: "0.5rem" }}>
            Ersatzteile anfragen
          </div>
          <div style={{ fontSize: "1rem", opacity: 0.88, lineHeight: 1.5, marginBottom: "1.1rem" }}>
            LogID scannen oder eintippen
          </div>

          <input
            type="text"
            inputMode="numeric"
            value={cardLogId}
            onChange={e => setCardLogId(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCardLogIdSubmit(); }}
            placeholder="z. B. 212.560.810"
            autoFocus
            style={{
              width:        "100%",
              padding:      "1rem 1.2rem",
              fontSize:     "1.2rem",
              borderRadius: 12,
              border:       "none",
              background:   "rgba(255,255,255,0.96)",
              color:        "#1a1a1a",
              fontFamily:   "'Ubuntu', sans-serif",
              boxSizing:    "border-box",
              outline:      "none",
              minHeight:    56,
              marginBottom: "0.75rem",
            }}
          />
          <button
            onClick={handleCardLogIdSubmit}
            disabled={cardLogId.replace(/\D/g, "").length < 5}
            className="active:scale-[0.99] transition-transform"
            style={{
              width:        "100%",
              padding:      "0.95rem 1rem",
              fontSize:     "1.05rem",
              fontWeight:   700,
              borderRadius: 12,
              border:       "none",
              background:   "white",
              color:        CYAN,
              cursor:       cardLogId.replace(/\D/g, "").length < 5 ? "not-allowed" : "pointer",
              opacity:      cardLogId.replace(/\D/g, "").length < 5 ? 0.6 : 1,
              fontFamily:   "'Ubuntu', sans-serif",
              minHeight:    56,
            }}
          >
            Gerät suchen →
          </button>
        </div>

        {/* ── Right: Anfragen-Liste ── */}
        <div>
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.2rem", fontWeight: 700 }}>
            Deine Anfragen
          </h2>

          {/* Such-Input */}
          <div style={{ marginBottom: "0.75rem" }}>
            <input
              type="text"
              value={suchTerm}
              onChange={e => setSuchTerm(e.target.value)}
              placeholder="LogID oder Modell suchen…"
              style={{
                width:        "100%",
                padding:      "0.7rem 1rem",
                borderRadius: 12,
                border:       "1.5px solid var(--border)",
                background:   "var(--card-bg)",
                color:        "var(--text)",
                fontFamily:   "'Ubuntu', sans-serif",
                fontSize:     "0.95rem",
                boxSizing:    "border-box",
                outline:      "none",
              }}
              onFocus={e  => (e.currentTarget.style.borderColor = CYAN)}
              onBlur={e   => (e.currentTarget.style.borderColor = "var(--border)")}
            />
          </div>

          {anfragenQuery.isLoading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "3rem 0", color: "var(--text-dim)" }}>
              <Loader2 size={20} style={{ animation: "tkSpin 0.8s linear infinite" }} />
              Wird geladen
              <style>{`@keyframes tkSpin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          {!anfragenQuery.isLoading && gefilterteGruppen.length === 0 && (
            <div style={{ padding: "1.5rem", background: "var(--card-bg)", borderRadius: 12, border: "1px solid var(--border)", color: "var(--text-dim)", textAlign: "center" }}>
              {suchTerm.trim() ? "Keine Anfragen gefunden." : "Du hast noch keine Anfragen gestellt."}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {gefilterteGruppen.map(g => (
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
          initialLogId={flowInitialLogId}
          onClose={() => { setShowFlow(false); setFlowInitialLogId(null); }}
          onSuccess={() => { setShowFlow(false); setFlowInitialLogId(null); anfragenQuery.refetch(); }}
          onOpenGruppe={(g) => {
            setShowFlow(false);
            setFlowInitialLogId(null);
            // Aktuellen Snapshot der Gruppe aus der Anfragen-Liste nehmen (wenn vorhanden),
            // sonst die übergebene Gruppe direkt verwenden.
            const aktuell = gruppen.find(x => x.key === g.key);
            setDetailGruppe(aktuell ?? g);
          }}
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

function ChatBadge({ anfrageIds }: { anfrageIds: number[] }) {
  // Stats für ALLE Anfragen der Gruppe holen — sonst zeigt der Badge nur
  // ungelesene Nachrichten zur ersten Anfrage und verpasst Chats zu den anderen.
  const { data } = api.chat.getStatsBatch.useQuery(
    { anfrageIds },
    { enabled: anfrageIds.length > 0, refetchInterval: 5_000, staleTime: 3_000 },
  );
  const n = (data ?? []).reduce((sum, s) => sum + (s.ungelesen ?? 0), 0);
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
  const hasLogId   = !!(gruppe.logId && gruppe.logId !== "unbekannt");
  const geraet     = gruppe.geraeteName ?? (hasLogId ? gruppe.logId! : "Unbekanntes Gerät");
  const anfrageIds = gruppe.anfragen.map(a => a.id);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: "0.2rem" }}>
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

      {hasLogId && (
        <div style={{ fontSize: "0.82rem", color: "var(--text-dim)", fontFamily: "monospace", marginBottom: "0.25rem" }}>
          {formatLogId(gruppe.logId!)}
        </div>
      )}

      <div style={{ fontSize: "0.875rem", color: "var(--text-dim)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span>{teileAnz} {teileAnz === 1 ? "Teil" : "Teile"} angefragt</span>
        <span aria-hidden>·</span>
        <span>{relativeZeit(new Date(gruppe.datum))}</span>
      </div>

      {anfrageIds.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <ChatBadge anfrageIds={anfrageIds} />
        </div>
      )}
    </button>
  );
}

// ── AnfrageFlow (Modal) ───────────────────────────────────────────────────────

type FlowStep = "logid" | "pruefen" | "teile" | "sending" | "done";

function AnfrageFlow({
  kuerzel,
  initialLogId,
  onClose,
  onSuccess,
  onOpenGruppe,
}: {
  kuerzel:      string;
  initialLogId: string | null;
  onClose:      () => void;
  onSuccess:    () => void;
  onOpenGruppe: (g: GruppeData) => void;
}) {
  const { show } = useToast();

  // Card-Scan startet direkt im neutralen Lade-Step — verhindert das kurze
  // Aufblitzen der LogID-Such-UI (Bug 2), während Lookup + Offene-Check laufen.
  const [step,               setStep]               = useState<FlowStep>(initialLogId ? "pruefen" : "logid");
  const [logIdInput,         setLogIdInput]         = useState(initialLogId ?? "");
  const [logIdQuery,         setLogIdQuery]         = useState<string | null>(initialLogId);
  const [selectedGeraet,     setSelectedGeraet]     = useState<GeraetInfo | null>(null);
  const [selectedTeile,      setSelectedTeile]      = useState<Set<string>>(new Set());
  const [anmerkungen,        setAnmerkungen]        = useState<Record<string, string>>({});
  const [sonderBeschr,       setSonderBeschr]       = useState("");
  const [tastaturModalOffen, setTastaturModalOffen] = useState(false);
  const [tastaturBeschr,     setTastaturBeschr]     = useState("");
  const [pruefeOffene,       setPruefeOffene]       = useState(false);
  const [zeigeOffene,        setZeigeOffene]        = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const logIdLookup = api.geraeteLookup.byLogId.useQuery(
    { logId: logIdQuery ?? "" },
    { enabled: !!logIdQuery, retry: false, staleTime: 0 },
  );

  const teileQuery = api.kompatibilitaet.getByGeraetMitStandard.useQuery(
    { geraet: selectedGeraet?.bereinigt ?? "" },
    { enabled: !!selectedGeraet, staleTime: 60_000 },
  );

  const addItemsBulkMutation = api.warenkorb.addItemsBulk.useMutation();
  const addSonderMutation    = api.warenkorb.addSonderAnfrage.useMutation();
  const submitMutation       = api.warenkorb.submitAlle.useMutation();

  // Teiltypen-Icons aus DB — Map: teiltyp-name → Lucide-Icon-Name
  const teiltypenListe = api.teiltypen.list.useQuery({ nurAktive: true }, { staleTime: 5 * 60_000 });
  const iconMap = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const t of teiltypenListe.data ?? []) m.set(t.name, t.icon);
    return m;
  }, [teiltypenListe.data]);

  // Check auf offene Anfragen für dieselbe LogID (wird nach erfolgreichem
  // Geräte-Lookup aktiviert, blockiert kurzzeitig den Sprung in Step "teile")
  const offeneCheck = api.anfragen.offeneFuerLogId.useQuery(
    { kuerzel, logId: selectedGeraet?.logId ?? "" },
    { enabled: pruefeOffene && !!selectedGeraet && !!kuerzel, staleTime: 0 },
  );

  // Step 1 result → Offene-Check anstoßen, dann ggf. Step 2.
  // Gate auf `!isFetching`: bei wiederholtem Lookup derselben LogID liefert
  // React-Query (staleTime:0) zuerst den stale Cache-Wert und refetcht im
  // Hintergrund — wir warten auf das frische Ergebnis, bevor wir reagieren.
  useEffect(() => {
    if (!logIdQuery || logIdLookup.isFetching) return;
    if (logIdLookup.isSuccess && logIdLookup.data) {
      if (logIdLookup.data.gefunden) {
        setSelectedGeraet({ logId: logIdLookup.data.logId, bereinigt: logIdLookup.data.bereinigt });
        setPruefeOffene(true);
      } else {
        show(`LogID „${logIdQuery}" nicht gefunden. Bitte erneut versuchen.`, "error");
        setStep("logid");
      }
      setLogIdQuery(null);
    } else if (logIdLookup.isError) {
      show("Fehler bei der Geräte-Suche. Bitte erneut versuchen.", "error");
      setStep("logid");
      setLogIdQuery(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logIdQuery, logIdLookup.isFetching, logIdLookup.isSuccess, logIdLookup.isError, logIdLookup.data]);

  // Offene-Check abgeschlossen → entweder Hinweis-Modal oder direkt Step 2.
  // Gate auf `!isFetching` (statt nur auf `data`): sonst greift der stale
  // Cache-Wert eines früheren Checks derselben LogID (vor Anlage der Anfrage)
  // und der Hinweis würde nie erscheinen (Bug 1). Bei Fehler: fail-open → Teile.
  useEffect(() => {
    if (!pruefeOffene || offeneCheck.isFetching) return;
    if (offeneCheck.isSuccess && offeneCheck.data) {
      if (offeneCheck.data.gruppen.length > 0) {
        setZeigeOffene(true);
      } else {
        setStep("teile");
      }
      setPruefeOffene(false);
    } else if (offeneCheck.isError) {
      setStep("teile");
      setPruefeOffene(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pruefeOffene, offeneCheck.isFetching, offeneCheck.isSuccess, offeneCheck.isError, offeneCheck.data]);

  // Autofocus on logid step
  useEffect(() => {
    if (step === "logid") setTimeout(() => inputRef.current?.focus(), 80);
  }, [step]);

  // Escape schließt — aber nicht während Sending/Done und nicht wenn ein
  // verschachteltes Modal (Tastatur, Offene-Hinweis) offen ist (dort hat
  // dessen eigener Handler Vorrang)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (tastaturModalOffen || zeigeOffene) return;
      if (step === "sending" || step === "done") return;
      onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, step, tastaturModalOffen, zeigeOffene]);

  function handleLogIdSubmit() {
    const clean = logIdInput.trim().replace(/\./g, "");
    if (!clean || !/^\d{5,}$/.test(clean)) {
      show("Bitte eine gültige LogID eingeben (nur Ziffern)", "error");
      return;
    }
    // Sauberer Übergang: voriges Gerät verwerfen, in neutralen Lade-Step gehen,
    // dann Lookup auslösen. Kein Zwischen-Render der Such-UI mehr (Bug 2).
    setSelectedGeraet(null);
    setZeigeOffene(false);
    setStep("pruefen");
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
    setAnmerkungen({});
    setSonderBeschr("");
    setTastaturBeschr("");
    setTastaturModalOffen(false);
    setPruefeOffene(false);
    setZeigeOffene(false);
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

      // Alle Standard-Teile in einer einzigen Transaktion — entweder alle oder keiner.
      // Verhindert halb-befüllten Korb wenn Client zwischen N Calls crasht.
      const items = Array.from(selectedTeile).map(teiltyp => {
        const info        = teile.find(t => t.teiltyp === teiltyp);
        const tastaturInf = teiltyp === "Tastatur" && tastaturBeschr ? tastaturBeschr : null;
        const anmerkung   = anmerkungen[teiltyp]?.trim() || null;
        const zusatzinfo  = [tastaturInf, anmerkung].filter(Boolean).join(" — ") || undefined;
        return {
          logId,
          artikelId: info?.artikelId ?? null,
          teiltyp,
          zusatzinfo,
        };
      });

      if (items.length > 0) {
        await addItemsBulkMutation.mutateAsync({
          techniker:   kuerzel,
          geraeteName: selectedGeraet.bereinigt,
          items,
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
      <FocusTrap
        active={!tastaturModalOffen && !zeigeOffene}
        focusTrapOptions={{
          escapeDeactivates:       false,
          allowOutsideClick:       true,
          returnFocusOnDeactivate: true,
          fallbackFocus:           "[aria-labelledby='anfrage-flow-title']",
          initialFocus:            false,
        }}
      >
      <div
        className="modal-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="anfrage-flow-title"
        tabIndex={-1}
        style={{ width: "100%", maxWidth: 680, background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto", color: "var(--text)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* visually-hidden default title for screen-readers — wird pro Step ggf. überschrieben */}
        <h2 id="anfrage-flow-title" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", margin: -1, padding: 0, border: 0 }}>
          Ersatzteile anfragen
        </h2>

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
              disabled={!logIdInput.trim()}
              style={primaryBtn(canSend || !!logIdInput.trim())}
            >
              Gerät suchen →
            </button>
          </div>
        )}

        {/* ── Step: Prüfen (neutraler Lade-Zustand zwischen LogID und Teile) ── */}
        {step === "pruefen" && (
          <div key="pruefen" className="step-enter" style={{ padding: "4rem 2rem", textAlign: "center" }}>
            <div style={{ width: 44, height: 44, border: `4px solid rgba(0,139,210,0.2)`, borderTopColor: CYAN, borderRadius: "50%", animation: "tkSpin 0.7s linear infinite", margin: "0 auto 1rem" }} />
            <p style={{ color: "var(--text-dim)", fontSize: "1rem", margin: 0 }}>Gerät wird gesucht…</p>
            <style>{`@keyframes tkSpin { to { transform: rotate(360deg); } }`}</style>
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
                  const isTastatur = t.teiltyp === "Tastatur";
                  const sel  = selectedTeile.has(t.teiltyp);
                  const Icon = getLucideIcon(iconMap.get(t.teiltyp));
                  return (
                    <button
                      key={t.teiltyp}
                      onClick={() => isTastatur ? setTastaturModalOffen(true) : toggleTeil(t.teiltyp)}
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
                        gap:            6,
                        transition:     "background 0.1s, border-color 0.1s",
                        position:       "relative",
                      }}
                    >
                      <Icon
                        size={28}
                        style={{ color: sel ? "#005fa3" : "var(--text-dim)", flexShrink: 0 }}
                      />
                      <span>{t.teiltyp}</span>
                      {isTastatur && sel && tastaturBeschr && (
                        <span style={{ fontSize: "0.72rem", color: "#005fa3", lineHeight: 1.2 }}>
                          {tastaturBeschr.startsWith("Einzeltasten:")
                            ? tastaturBeschr.replace("Einzeltasten:", "").trim().split(",").length + " Tasten"
                            : "Komplett"}
                        </span>
                      )}
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

            {/* Anmerkungen pro ausgewähltem Teil */}
            {selectedTeile.size > 0 && (
              <div style={{ marginBottom: "1.5rem" }}>
                <h3 style={{ margin: "0 0 0.6rem", fontSize: "1rem", fontWeight: 700 }}>
                  Anmerkungen zu deinen Teilen
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  {Array.from(selectedTeile).map(teiltyp => {
                    const info = teile.find(t => t.teiltyp === teiltyp);
                    // Bei "komplett" steht das Label schon auf der Teile-Card —
                    // hier nur die Einzeltasten-Liste anzeigen (verhindert Doppel-Info).
                    const tastaturHint = teiltyp === "Tastatur"
                      && tastaturBeschr.startsWith("Einzeltasten:")
                      ? tastaturBeschr
                      : null;
                    return (
                      <div
                        key={teiltyp}
                        style={{
                          padding:      "0.75rem 0.9rem",
                          borderRadius: 12,
                          border:       "1.5px solid var(--border)",
                          background:   "var(--bg)",
                        }}
                      >
                        <label style={{
                          display:       "flex",
                          alignItems:    "baseline",
                          gap:           "0.4rem",
                          fontWeight:    700,
                          fontSize:      "0.92rem",
                          marginBottom:  "0.4rem",
                          flexWrap:      "wrap",
                          color:         "var(--text)",
                        }}>
                          <span>{teiltyp}</span>
                          {info?.bezeichnung && (
                            <span style={{ fontWeight: 500, fontSize: "0.78rem", color: "var(--text-dim)" }}>
                              ({info.bezeichnung})
                            </span>
                          )}
                          {tastaturHint && (
                            <span style={{ fontWeight: 600, fontSize: "0.78rem", color: "#005fa3" }}>
                              — {tastaturHint}
                            </span>
                          )}
                        </label>
                        <input
                          type="text"
                          value={anmerkungen[teiltyp] ?? ""}
                          onChange={e => setAnmerkungen(a => ({ ...a, [teiltyp]: e.target.value }))}
                          placeholder="Optional: Defekt, Symptome, Besonderheiten"
                          style={{
                            width:        "100%",
                            padding:      "0.65rem 0.85rem",
                            borderRadius: 10,
                            border:       "1.5px solid var(--border)",
                            background:   "var(--card-bg)",
                            color:        "var(--text)",
                            fontFamily:   "'Ubuntu', sans-serif",
                            fontSize:     "0.92rem",
                            boxSizing:    "border-box",
                            outline:      "none",
                          }}
                          onFocus={e => (e.currentTarget.style.borderColor = CYAN)}
                          onBlur={e  => (e.currentTarget.style.borderColor = "var(--border)")}
                        />
                      </div>
                    );
                  })}
                </div>
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

      </FocusTrap>

      {/* Tastatur-Auswahl Sub-Modal */}
      {tastaturModalOffen && (
        <TastenAuswahlModal
          initial={tastaturBeschr}
          onClose={() => setTastaturModalOffen(false)}
          onConfirm={(beschreibung) => {
            setTastaturBeschr(beschreibung);
            setSelectedTeile(prev => { const n = new Set(prev); n.add("Tastatur"); return n; });
            setTastaturModalOffen(false);
          }}
        />
      )}

      {/* Hinweis-Modal bei bereits offenen Anfragen für die LogID */}
      {zeigeOffene && offeneCheck.data && offeneCheck.data.gruppen.length > 0 && selectedGeraet && (
        <OffeneAnfragenHinweisModal
          gruppen={offeneCheck.data.gruppen as OffeneGruppe[]}
          geraetName={selectedGeraet.bereinigt}
          logIdFormatiert={selectedGeraet.logId === "---" ? "" : selectedGeraet.logId.replace(/(\d{3})(?=\d)/g, "$1.")}
          onOeffneAnfrage={(g) => {
            // Backend-Gruppe → GruppeData für AnfrageDetailModal
            const gruppeData: GruppeData = {
              key:         g.gruppenNr,
              logId:       selectedGeraet.logId === "---" ? null : selectedGeraet.logId,
              gruppenNr:   g.gruppenNr.startsWith("single-") ? null : g.gruppenNr,
              geraeteName: selectedGeraet.bereinigt,
              datum:       new Date(g.datum),
              anfragen:    g.anfragen.map(a => ({
                ...a,
                datum: new Date(a.datum),
              })) as AnfrageRow[],
            };
            setZeigeOffene(false);
            onOpenGruppe(gruppeData);
          }}
          onTrotzdemNeu={() => {
            setZeigeOffene(false);
            setStep("teile");
          }}
          onAbbrechen={() => {
            setZeigeOffene(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}

// ── TastenAuswahlModal ────────────────────────────────────────────────────────

const HAUPT_ROWS: string[][] = [
  ["Esc","F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"],
  ["^°","1","2","3","4","5","6","7","8","9","0","ß?","´`","Backspace"],
  ["Tab","Q","W","E","R","T","Z","U","I","O","P","Ü","+*","Enter"],
  ["Caps","A","S","D","F","G","H","J","K","L","Ö","Ä","#'"],
  ["Shift-L","<>","Y","X","C","V","B","N","M",",;",".:","-_","Shift-R"],
  ["Strg-L","Fn","Win","Alt","Space","AltGr","Menu","Strg-R"],
];

const NAV_ROWS: string[][] = [
  [],
  ["Ins","Home","PgUp"],
  ["Entf","End","PgDn"],
  [],
  ["·","↑","·"],
  ["←","↓","→"],
];

const NUMPAD_ROWS: string[][] = [
  [],
  ["NumLk","Num/","Num*","Num-"],
  ["Num7","Num8","Num9","Num+"],
  ["Num4","Num5","Num6"],
  ["Num1","Num2","Num3","NumEnter"],
  ["Num0","Num,","·"],
];

const KEY_W: Record<string, number> = {
  Backspace: 2,   Tab: 1.5,   Enter: 2,   Caps: 1.75,
  "Shift-L": 2.25, "Shift-R": 2.25,
  "Strg-L": 1.4,   "Strg-R": 1.4,
  Alt: 1.4,       AltGr: 1.4, Win: 1.4,   Fn: 1.25, Menu: 1.4,
  Space: 6,
};

const KEY_LABEL: Record<string, string> = {
  "Shift-L": "Shift", "Shift-R": "Shift",
  "Strg-L": "Strg",   "Strg-R": "Strg",
  NumLk:    "Num",
  "Num/":   "/",  "Num*":   "*",  "Num-":   "−",  "Num+":   "+",
  Num0: "0", Num1: "1", Num2: "2", Num3: "3", Num4: "4",
  Num5: "5", Num6: "6", Num7: "7", Num8: "8", Num9: "9",
  "Num,":   ",", NumEnter: "↵",
};

const KEY_UNIT = 2.2; // rem pro Einheits-Breite
const KEY_GAP  = 0.25; // rem
const ROW_H    = 2.5; // rem (auch Spacer-Höhe)

function TastenKomponente({
  gewaehlt,
  setGewaehlt,
}: {
  gewaehlt:    Set<string>;
  setGewaehlt: (s: Set<string>) => void;
}) {
  function toggle(key: string) {
    if (key === "·") return; // Layout-Spacer, nicht klickbar
    const n = new Set(gewaehlt);
    if (n.has(key)) n.delete(key); else n.add(key);
    setGewaehlt(n);
  }

  function renderTaste(key: string, ki: number) {
    if (key === "·") {
      return <div key={`sp-${ki}`} style={{ width: `${KEY_UNIT}rem`, flexShrink: 0 }} />;
    }
    const sel = gewaehlt.has(key);
    const w   = KEY_W[key] ?? 1;
    const lbl = KEY_LABEL[key] ?? key;
    return (
      <button
        key={`${key}-${ki}`}
        onClick={() => toggle(key)}
        className="active:scale-95"
        style={{
          width:        `${w * KEY_UNIT}rem`,
          minHeight:    `${ROW_H}rem`,
          borderRadius: 6,
          border:       sel ? `2px solid ${CYAN}` : "1px solid var(--border)",
          background:   sel ? CYAN : "var(--card-bg)",
          color:        sel ? "white" : "var(--text)",
          cursor:       "pointer",
          fontSize:     "0.72rem",
          fontWeight:   sel ? 700 : 500,
          fontFamily:   "'Ubuntu', sans-serif",
          transition:   "background 0.1s, border-color 0.1s",
          flexShrink:   0,
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
          padding:      "0 2px",
        }}
      >
        {lbl}
      </button>
    );
  }

  function renderBlock(rows: string[][]) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: `${KEY_GAP}rem` }}>
        {rows.map((row, ri) => (
          row.length === 0 ? (
            <div key={`empty-${ri}`} style={{ height: `${ROW_H}rem` }} />
          ) : (
            <div key={ri} style={{ display: "flex", gap: `${KEY_GAP}rem`, justifyContent: "flex-start" }}>
              {row.map((key, ki) => renderTaste(key, ki))}
            </div>
          )
        ))}
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 12, background: "var(--bg)", padding: "1rem" }}>
      <div style={{ display: "flex", gap: "1.25rem", justifyContent: "center", alignItems: "flex-start", flexWrap: "nowrap" }}>
        {renderBlock(HAUPT_ROWS)}
        {renderBlock(NAV_ROWS)}
        {renderBlock(NUMPAD_ROWS)}
      </div>
    </div>
  );
}

function TastenAuswahlModal({
  initial,
  onClose,
  onConfirm,
}: {
  initial:   string;
  onClose:   () => void;
  onConfirm: (beschreibung: string) => void;
}) {
  const isKomplettInitial = !initial.startsWith("Einzeltasten:");
  const initialTasten     = initial.startsWith("Einzeltasten:")
    ? new Set(initial.replace("Einzeltasten:", "").split(",").map(s => s.trim()).filter(Boolean))
    : new Set<string>();

  const [modus,      setModus]      = useState<"komplett" | "einzeln">(isKomplettInitial ? "komplett" : "einzeln");
  const [gewaehlt,   setGewaehlt]   = useState<Set<string>>(initialTasten);

  function confirm() {
    if (modus === "komplett") {
      onConfirm("Komplette Tastatur");
    } else {
      const tasten = Array.from(gewaehlt);
      onConfirm(`Einzeltasten: ${tasten.join(", ")}`);
    }
  }

  const canConfirm = modus === "komplett" || gewaehlt.size > 0;

  // Escape schließt — eigene Behandlung, FocusTrap macht nur Tab-Trap.
  // Damit die äußere AnfrageFlow nicht parallel auf Esc reagiert, pausiert
  // diese ihren Handler über `tastaturModalOffen`.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const modusBtn = (active: boolean): React.CSSProperties => ({
    flex:         1,
    padding:      "0.8rem",
    borderRadius: 12,
    border:       active ? `2px solid ${CYAN}` : "1.5px solid var(--border)",
    background:   active ? "rgba(0,139,210,0.08)" : "var(--card-bg)",
    color:        active ? "#005fa3" : "var(--text)",
    cursor:       "pointer",
    fontWeight:   active ? 700 : 500,
    fontFamily:   "'Ubuntu', sans-serif",
    fontSize:     "0.92rem",
    minHeight:    56,
  });

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onClose}
    >
      <FocusTrap focusTrapOptions={{
        escapeDeactivates:       false,
        allowOutsideClick:       true,
        returnFocusOnDeactivate: true,
        fallbackFocus:           "[aria-labelledby='tastatur-modal-title']",
        initialFocus:            false,
      }}>
      <div
        className="modal-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tastatur-modal-title"
        tabIndex={-1}
        style={{ width: "100%", maxWidth: 1280, background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.35)", color: "var(--text)", maxHeight: "90vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
          <h2 id="tastatur-modal-title" style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800 }}>⌨️ Tastatur</h2>
          <button onClick={onClose} aria-label="Schließen" style={closeBtn}>✕</button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem 1.5rem" }}>
          {/* Modus-Switch */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
            <button onClick={() => setModus("komplett")} style={modusBtn(modus === "komplett")}>
              Komplette Tastatur
            </button>
            <button onClick={() => setModus("einzeln")} style={modusBtn(modus === "einzeln")}>
              Einzelne Tasten
            </button>
          </div>

          {/* Keyboard */}
          {modus === "einzeln" && (
            <div style={{ marginBottom: "1.25rem" }}>
              <TastenKomponente gewaehlt={gewaehlt} setGewaehlt={setGewaehlt} />
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontSize: "0.95rem", color: "var(--text-dim)" }}>
              {modus === "komplett"
                ? "Komplette Tastatur"
                : gewaehlt.size === 0
                ? "Bitte Tasten auswählen"
                : `${gewaehlt.size} Taste${gewaehlt.size !== 1 ? "n" : ""} ausgewählt`}
            </span>
            <button
              onClick={confirm}
              disabled={!canConfirm}
              style={primaryBtn(canConfirm, CYAN)}
            >
              Übernehmen
            </button>
          </div>
        </div>
      </div>
      </FocusTrap>
    </div>
  );
}

// ── OffeneAnfragenHinweisModal ────────────────────────────────────────────────

type OffeneGruppe = {
  gruppenNr: string;
  datum:     Date;
  teile:     string[];
  status:    string;
  // anfragen-Felder werden via onOeffnen weitergegeben, hier nicht streng typisiert
  anfragen:  Array<{ id: number; teil: string; status: string; logId: string; geraet: string; geraeteName: string | null; datum: Date; techniker: string }>;
};

function OffeneAnfragenHinweisModal({
  gruppen,
  geraetName,
  logIdFormatiert,
  onOeffneAnfrage,
  onTrotzdemNeu,
  onAbbrechen,
}: {
  gruppen:         OffeneGruppe[];
  geraetName:      string;
  logIdFormatiert: string;
  onOeffneAnfrage: (g: OffeneGruppe) => void;
  onTrotzdemNeu:   () => void;
  onAbbrechen:     () => void;
}) {
  // Escape schließt
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onAbbrechen(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onAbbrechen]);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={onAbbrechen}
    >
      <FocusTrap focusTrapOptions={{
        escapeDeactivates:       false,
        allowOutsideClick:       true,
        returnFocusOnDeactivate: true,
        fallbackFocus:           "[aria-labelledby='offene-modal-title']",
        initialFocus:            false,
      }}>
      <div
        className="modal-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offene-modal-title"
        tabIndex={-1}
        style={{ width: "100%", maxWidth: 640, background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.35)", color: "var(--text)", maxHeight: "90vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1.25rem 1.5rem 0.75rem" }}>
          <div>
            <h2 id="offene-modal-title" style={{ margin: "0 0 0.3rem", fontSize: "1.2rem", fontWeight: 800 }}>
              Du hast schon offene Anfragen
            </h2>
            <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "0.92rem", lineHeight: 1.4 }}>
              Für <strong style={{ color: "var(--text)" }}>{geraetName}</strong>{" "}
              ({logIdFormatiert}) sind noch nicht alle erledigt:
            </p>
          </div>
          <button onClick={onAbbrechen} aria-label="Schließen" style={closeBtn}>✕</button>
        </div>

        <div style={{ padding: "0.5rem 1.5rem 1.25rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1rem" }}>
            {gruppen.map(g => {
              const cfg = STATUS_CFG[g.status] ?? STATUS_CFG.NEU!;
              return (
                <button
                  key={g.gruppenNr}
                  onClick={() => onOeffneAnfrage(g)}
                  className="active:scale-[0.99] transition-all"
                  style={{
                    width:        "100%",
                    textAlign:    "left",
                    padding:      "0.9rem 1rem",
                    background:   "var(--bg)",
                    border:       "1.5px solid var(--border)",
                    borderRadius: 14,
                    cursor:       "pointer",
                    fontFamily:   "'Ubuntu', sans-serif",
                    color:        "var(--text)",
                    minHeight:    72,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = CYAN)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: "0.3rem" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.98rem" }}>
                      {g.anfragen.length} {g.anfragen.length === 1 ? "Teil" : "Teile"} · {relativeZeit(new Date(g.datum))}
                    </span>
                    <span style={{
                      background:   cfg.bg,
                      color:        cfg.color,
                      borderRadius: 20,
                      padding:      "3px 11px",
                      fontSize:     "0.78rem",
                      fontWeight:   700,
                      flexShrink:   0,
                    }}>
                      {cfg.text}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.86rem", color: "var(--text-dim)", lineHeight: 1.4 }}>
                    {g.teile.join(", ")}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: "0.6rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
            <button
              onClick={onAbbrechen}
              style={{ ...secondaryBtn, flex: 1 }}
            >
              Abbrechen
            </button>
            <button
              onClick={onTrotzdemNeu}
              style={{ ...primaryBtn(true, CYAN), flex: 2, width: "auto" }}
            >
              Trotzdem neue Anfrage
            </button>
          </div>
        </div>
      </div>
      </FocusTrap>
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

  // Escape schließt
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

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
        await storniereMutation.mutateAsync({ id: a.id, techniker: kuerzel });
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
      <FocusTrap focusTrapOptions={{
        escapeDeactivates:       false,
        allowOutsideClick:       true,
        returnFocusOnDeactivate: true,
        fallbackFocus:           "[aria-labelledby='anfrage-detail-title']",
        initialFocus:            false,
      }}>
      <div
        className="modal-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="anfrage-detail-title"
        tabIndex={-1}
        style={{ width: "100%", maxWidth: 680, background: "var(--card-bg)", borderRadius: 20, boxShadow: "0 8px 40px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto", color: "var(--text)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1.25rem 1.5rem 0" }}>
          <div>
            <h2 id="anfrage-detail-title" style={{ margin: "0 0 0.2rem", fontSize: "1.25rem", fontWeight: 800 }}>{geraet}</h2>
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
      </FocusTrap>
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
