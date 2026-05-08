"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter }     from "next/navigation";
import { useSession }    from "next-auth/react";
import { AnfrageStatus } from "@prisma/client";
import { api }           from "@/trpc/react";
import { useToast }      from "@/components/ui/Toast";
import { useSocket }     from "@/hooks/useSocket";
import { EVENTS }        from "@/modules/realtime/events";
import { TastaturModal } from "@/components/ui/TastaturModal";

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionUser = { name?: string; kuerzel?: string; rolle?: string };

type GeraetInfo = { logId: string; bereinigt: string };

type TeilInfo = {
  teiltyp:    string;
  artikelId:  number | null;
  bezeichnung: string | null;
  bestand:    number;
  verfuegbar: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TEIL_ICONS: Record<string, string> = {
  Displaymodul:    "🖥️",
  Tastatur:        "⌨️",
  Touchpad:        "🖱️",
  "Füße vorne":   "🦶",
  "Füße hinten":  "🦶",
  "D Cover":       "🔲",
  "USB Board":     "🔌",
  "Power Button":  "⏻",
  Lautsprecher:    "🔊",
  Lüfter:          "💨",
  Thermalmodul:    "🌡️",
  "BIOS Batterie": "🔋",
  Akku:            "🔋",
};

// ── Inline style helpers ──────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background:   "var(--card-bg)",
  padding:      "1.5rem",
  borderRadius: "12px",
  border:       "1px solid var(--border)",
  boxShadow:    "0 4px 12px rgba(0,0,0,0.08)",
};

const btnOrderStyle: React.CSSProperties = {
  background:   "var(--primary)",
  color:        "white",
  border:       "none",
  padding:      "0.7rem 1.2rem",
  borderRadius: "8px",
  fontWeight:   "bold",
  cursor:       "pointer",
  fontFamily:   "'Ubuntu', sans-serif",
  width:        "100%",
};

const btnIconStyle: React.CSSProperties = {
  background:   "var(--bg)",
  border:       "1px solid var(--border)",
  color:        "var(--text)",
  padding:      "0.4rem 0.8rem",
  borderRadius: "6px",
  cursor:       "pointer",
  fontWeight:   600,
  transition:   "all 0.2s",
  fontFamily:   "'Ubuntu', sans-serif",
};

const searchInputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "0.8rem 1.2rem",
  borderRadius: "10px",
  border:       "2px solid var(--border)",
  background:   "var(--bg)",
  color:        "var(--text)",
  boxSizing:    "border-box",
  outline:      "none",
  transition:   "border-color 0.2s",
  fontFamily:   "'Ubuntu', sans-serif",
};

function modalOverlay(onClick?: () => void): React.CSSProperties {
  return {
    display:        "flex",
    position:       "fixed",
    top: 0, left: 0,
    width: "100%", height: "100%",
    background:     "rgba(0,0,0,0.7)",
    backdropFilter: "blur(4px)",
    zIndex:         10000,
    justifyContent: "center",
    alignItems:     "center",
  };
}

const modalContent: React.CSSProperties = {
  background:   "var(--card-bg)",
  width:        420,
  padding:      "2.5rem",
  borderRadius: "15px",
  boxShadow:    "0 20px 40px rgba(0,0,0,0.3)",
  textAlign:    "center",
  color:        "var(--text)",
};


// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TechnikerPage() {
  const { data: session } = useSession();
  const user    = session?.user as SessionUser | undefined;
  const kuerzel = user?.kuerzel ?? "";
  const { show } = useToast();
  const { on, off } = useSocket();

  // ── Device identification ──────────────────────────────────────────────────
  const [identMode,      setIdentMode]      = useState<"logid" | "modell">("logid");
  const [identInput,     setIdentInput]     = useState("");
  const [logIdQuery,     setLogIdQuery]     = useState<string | null>(null);
  const [selectedGeraet, setSelectedGeraet] = useState<GeraetInfo | null>(null);

  // ── Tastatur / Cart pending ────────────────────────────────────────────────
  const [showTastatur,    setShowTastatur]    = useState(false);
  const [pendingCartItem, setPendingCartItem] = useState<{ teil: TeilInfo; grading: string } | null>(null);

  // ── Cart state ─────────────────────────────────────────────────────────────
  const [cartOpen,          setCartOpen]          = useState(false);
  const [globalZusatzinfo,  setGlobalZusatzinfo]  = useState("");

  // ── Storno state ──────────────────────────────────────────────────────────
  const [stornoItem, setStornoItem] = useState<{ id: number; teil: string; techniker: string; logId: string } | null>(null);

  // ── Anfragen filter & Gruppen ─────────────────────────────────────────────
  const [filterTab,      setFilterTab]      = useState<"alle" | "aktiv" | "erledigt">("alle");
  const [logIdSearch,    setLogIdSearch]    = useState("");
  const [showAllAnfragen, setShowAllAnfragen] = useState(false);
  const [lastRefresh,    setLastRefresh]    = useState<Date>(new Date());

  // ── tRPC Queries ──────────────────────────────────────────────────────────

  // LogID lookup (on demand)
  const logIdLookup = api.geraeteLookup.byLogId.useQuery(
    { logId: logIdQuery ?? "" },
    { enabled: !!logIdQuery, retry: false, staleTime: 0 },
  );

  // Compatible parts (when device selected)
  const teileQuery = api.kompatibilitaet.getByGeraetMitStandard.useQuery(
    { geraet: selectedGeraet?.bereinigt ?? "" },
    { enabled: !!selectedGeraet, staleTime: 60_000 },
  );

  // My Anfragen
  const anfragenQuery = api.anfragen.getByTechniker.useQuery(
    { kuerzel, showAll: true, limit: 50 },
    { enabled: !!kuerzel, refetchInterval: 20_000 },
  );

  // Warenkorb
  const korbQuery = api.warenkorb.getAktiv.useQuery(
    { techniker: kuerzel },
    { enabled: !!kuerzel },
  );


  // ── Handle LogID lookup result ────────────────────────────────────────────
  useEffect(() => {
    if (!logIdLookup.data) return;
    if (logIdLookup.data.gefunden) {
      selectGeraet({ logId: logIdLookup.data.logId, bereinigt: logIdLookup.data.bereinigt });
    } else {
      show(`LogID "${logIdQuery}" nicht gefunden`, "error");
    }
    setLogIdQuery(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logIdLookup.data]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const storniereMutation = api.anfragen.storniere.useMutation({
    onSuccess: () => {
      show("Anfrage storniert", "success");
      anfragenQuery.refetch();
      setStornoItem(null);
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

  const addToCartMutation = api.warenkorb.addItem.useMutation({
    onSuccess: () => {
      show("✅ In Warenkorb gelegt", "success");
      korbQuery.refetch();
      setCartOpen(true);
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

  const removeFromCartMutation = api.warenkorb.removeItem.useMutation({
    onSuccess: () => { korbQuery.refetch(); },
  });

  const submitCartMutation = api.warenkorb.submit.useMutation({
    onSuccess: (data) => {
      show(`✅ ${data.anzahl} Teile angefragt! (${data.gruppenNr})`, "success");
      korbQuery.refetch();
      anfragenQuery.refetch();
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

  const submitAlleMutation = api.warenkorb.submitAlle.useMutation({
    onSuccess: (data) => {
      show(`✅ ${data.anzahl} Teile erfolgreich angefragt!`, "success");
      korbQuery.refetch();
      anfragenQuery.refetch();
      setCartOpen(false);
      setGlobalZusatzinfo("");
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const doRefreshAnfragen = () => { anfragenQuery.refetch(); setLastRefresh(new Date()); };
    on(EVENTS.ANFRAGE_UPDATED, doRefreshAnfragen);
    on(EVENTS.ANFRAGE_NEU,     doRefreshAnfragen);
    on(EVENTS.BESTAND_UPDATED, () => { if (selectedGeraet) teileQuery.refetch(); });
    // NACHRICHT_NEU wird von AnfrageGruppe per eigenem getByLogId-Query behandelt
    return () => {
      off(EVENTS.ANFRAGE_UPDATED);
      off(EVENTS.ANFRAGE_NEU);
      off(EVENTS.BESTAND_UPDATED);
      off(EVENTS.NACHRICHT_NEU);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, off]);

  // ── Auto-Refresh (5-Sekunden-Fallback wenn Socket kurz getrennt) ──────────
  useEffect(() => {
    const interval = setInterval(() => {
      anfragenQuery.refetch();
      korbQuery.refetch();
      setLastRefresh(new Date());
    }, 5_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helper functions ──────────────────────────────────────────────────────

  function selectGeraet(geraet: GeraetInfo) {
    setSelectedGeraet(geraet);
    setIdentInput("");
    show(`💻 ${geraet.bereinigt}`, "success");
  }

  function handleIdentSubmit() {
    const val = identInput.trim();
    if (!val) return;

    if (identMode === "logid") {
      const clean = val.replace(/\./g, "");
      if (!/^\d+$/.test(clean)) {
        show("LogID muss aus Ziffern bestehen", "error");
        return;
      }
      setLogIdQuery(val);
    } else {
      selectGeraet({ logId: "---", bereinigt: val });
    }
  }

  // Haupt-Handler: Teil in Warenkorb legen (alle 4 Zustände)
  // artikelId kann null sein — KEIN Fallback auf anderen Artikel!
  function handleAddToCart(teil: TeilInfo, grading: string, zusatzinfo: string) {
    if (!selectedGeraet || !kuerzel) {
      show("Bitte zuerst ein Gerät auswählen", "warning");
      return;
    }

    // Tastatur → zuerst TastaturModal öffnen
    if (teil.teiltyp === "Tastatur") {
      setPendingCartItem({ teil, grading });
      setShowTastatur(true);
      return;
    }

    addToCartMutation.mutate({
      techniker:   kuerzel,
      logId:       selectedGeraet.logId === "---" ? "unbekannt" : selectedGeraet.logId,
      geraeteName: selectedGeraet.bereinigt,
      artikelId:   teil.artikelId,   // null erlaubt (ZUSTAND C)
      teiltyp:     teil.teiltyp,
      grading:     grading || "A+",
      zusatzinfo:  zusatzinfo || undefined,
    });
  }

  // Nach Tastatur-Auswahl: in Warenkorb
  function handleTastaturConfirm(kommentar: string) {
    setShowTastatur(false);
    if (!pendingCartItem || !selectedGeraet || !kuerzel) { setPendingCartItem(null); return; }

    const { teil, grading } = pendingCartItem;
    setPendingCartItem(null);

    addToCartMutation.mutate({
      techniker:   kuerzel,
      logId:       selectedGeraet.logId === "---" ? "unbekannt" : selectedGeraet.logId,
      geraeteName: selectedGeraet.bereinigt,
      artikelId:   teil.artikelId,   // null wenn ZUSTAND C
      teiltyp:     teil.teiltyp,
      grading:     grading || "A+",
      zusatzinfo:  kommentar,
    });
  }

  // ── Anfragen ───────────────────────────────────────────────────────────────
  const alleAnfragen = anfragenQuery.data?.anfragen ?? [];
  const offeneCount  = alleAnfragen.filter((a) => a.status === "NEU" || a.status === "BEDARF").length;

  // Gruppen nach logId (FIX 1: robuster Key; FIX 3: Teil-Deduplizierung)
  const gruppen = useMemo(() => {
    type GruppeEntry = { key: string; logId: string | null; gruppenNr: string | null; geraeteName: string | null; datum: Date; anfragen: typeof alleAnfragen };
    const map = new Map<string, GruppeEntry>();

    for (const a of alleAnfragen) {
      const rawLogId  = (a.logId ?? "").trim();
      const cleanLogId = rawLogId.replace(/\./g, "");
      const key =
        rawLogId && rawLogId !== "unbekannt" ? rawLogId
        : (a as { gruppenNr?: string | null }).gruppenNr         ? (a as { gruppenNr?: string | null }).gruppenNr!
        : `datum-${new Date(a.datum).toISOString().slice(0, 10)}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          logId:       rawLogId || null,
          gruppenNr:   (a as { gruppenNr?: string | null }).gruppenNr ?? null,
          geraeteName: a.geraeteName ?? null,
          datum:       new Date(a.datum),
          anfragen:    [],
        });
      }
      const gruppe = map.get(key)!;

      // FIX 3: Deduplizierung — gleicher Teil + gleicher Status wird nur einmal gezeigt
      const isDuplicate = gruppe.anfragen.some(
        (existing) => existing.teil === a.teil && existing.status === a.status
      );
      if (!isDuplicate) {
        gruppe.anfragen.push(a);
      }
      // Datum auf neueste Anfrage der Gruppe aktualisieren
      if (new Date(a.datum) > gruppe.datum) gruppe.datum = new Date(a.datum);
    }

    return Array.from(map.values()).sort((a, b) => b.datum.getTime() - a.datum.getTime());
  }, [alleAnfragen]);

  const gefilterteGruppen = useMemo(() => {
    return gruppen.filter((g) => {
      if (logIdSearch) {
        const q = logIdSearch.toLowerCase();
        if (!(g.logId ?? "").toLowerCase().includes(q) && !(g.geraeteName ?? "").toLowerCase().includes(q)) return false;
      }
      if (filterTab === "aktiv")    return g.anfragen.some((a) => a.status === "NEU" || a.status === "BEDARF");
      if (filterTab === "erledigt") return g.anfragen.every((a) => a.status === "ABGESCHLOSSEN" || a.status === "STORNIERT");
      return true;
    });
  }, [gruppen, filterTab, logIdSearch]);
  const koerbe       = korbQuery.data ?? [];
  const alleKorbItems = koerbe.flatMap((k) => k.items);
  const totalKorbTeile = alleKorbItems.length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Tastatur Modal (für Warenkorb-Flow) ── */}
      <TastaturModal
        open={showTastatur}
        articleName={pendingCartItem?.teil.bezeichnung ?? pendingCartItem?.teil.teiltyp ?? "Tastatur"}
        onConfirm={handleTastaturConfirm}
        onClose={() => { setShowTastatur(false); setPendingCartItem(null); }}
      />

      {/* ── Storno Modal ── */}
      {stornoItem && (
        <div style={modalOverlay()} onClick={() => setStornoItem(null)}>
          <div
            style={{ ...modalContent, border: "2px solid var(--danger)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🗑️</div>
            <h3 style={{ margin: "0 0 8px", color: "var(--danger)" }}>Anfrage stornieren</h3>
            <p style={{ color: "var(--text-dim)", margin: "0 0 1.5rem" }}>
              Möchtest du <strong style={{ color: "var(--text)" }}>{stornoItem.teil}</strong> wirklich stornieren?
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button onClick={() => setStornoItem(null)} style={btnIconStyle}>Abbrechen</button>
              <button
                onClick={() => {
                  storniereMutation.mutate({
                    techniker: stornoItem.techniker,
                    logId:     stornoItem.logId,
                    teil:      stornoItem.teil,
                  });
                }}
                disabled={storniereMutation.isPending}
                style={{ ...btnOrderStyle, background: "var(--danger)" }}
              >
                Ja, stornieren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Grid ── */}
      <main style={{
        maxWidth:  1450,
        margin:    "2rem auto",
        display:   "grid",
        gridTemplateColumns: "1fr 420px",
        gap:       "1.5rem",
        padding:   "0 1.2rem",
      }} className="techniker-grid">

        {/* ══════════════════════════════ LEFT COLUMN ══════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* ── Gerät identifizieren ── */}
          <section style={cardStyle}>
            <h3 style={{ marginTop: 0, borderBottom: "1px solid var(--border)", paddingBottom: "1rem" }}>
              Gerät identifizieren
            </h3>

            {/* Mode selector */}
            <div style={{ display: "flex", gap: 8, marginBottom: "1rem" }}>
              {(["logid", "modell"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => { setIdentMode(mode); setIdentInput(""); }}
                  style={{
                    ...btnIconStyle,
                    background:  identMode === mode ? "var(--primary)" : "var(--bg)",
                    color:       identMode === mode ? "white"          : "var(--text)",
                    border:      `1px solid ${identMode === mode ? "var(--primary)" : "var(--border)"}`,
                    padding:     "0.5rem 1.2rem",
                  }}
                >
                  {mode === "logid" ? "📡 LogID" : "🔍 Modell"}
                </button>
              ))}
            </div>

            {/* Input row */}
            <div style={{ display: "flex", gap: 8, marginBottom: "0.8rem" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  type="text"
                  value={identInput}
                  onChange={(e) => setIdentInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleIdentSubmit(); }}
                  placeholder={identMode === "logid" ? "LogID scannen oder eingeben..." : "Modell oder Hersteller eingeben..."}
                  inputMode={identMode === "logid" ? "numeric" : "text"}
                  style={{
                    ...searchInputStyle,
                    marginBottom: 0,
                    fontSize: identMode === "logid" ? "1.3rem" : "1rem",
                    fontWeight:   identMode === "logid" ? "bold" : "normal",
                    letterSpacing: identMode === "logid" ? 3 : 0,
                  }}
                  autoFocus
                />
                {identInput && (
                  <button
                    onClick={() => setIdentInput("")}
                    style={{
                      position:  "absolute", right: 12, top: "50%",
                      transform: "translateY(-50%)",
                      background: "none", border: "none",
                      color:     "var(--text-dim)", cursor: "pointer",
                      fontSize:  "1.2rem", padding: "4px",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                onClick={handleIdentSubmit}
                disabled={!identInput.trim() || logIdLookup.isFetching}
                style={{
                  ...btnOrderStyle,
                  width:  "auto",
                  padding: "0.8rem 1.5rem",
                  opacity: (!identInput.trim() || logIdLookup.isFetching) ? 0.6 : 1,
                }}
              >
                {logIdLookup.isFetching ? "⏳" : "Suchen"}
              </button>
            </div>

            {/* Selected device badge */}
            {selectedGeraet && (
              <div style={{
                display:      "flex",
                alignItems:   "center",
                gap:          10,
                padding:      "0.7rem 1rem",
                background:   "var(--primary)",
                color:        "white",
                borderRadius: 10,
                marginBottom: "0.8rem",
                fontWeight:   "bold",
              }}>
                <span>💻</span>
                <span style={{ flex: 1 }}>{selectedGeraet.bereinigt}</span>
                {selectedGeraet.logId !== "---" && (
                  <span style={{ opacity: 0.8, fontSize: "0.85rem" }}>#{selectedGeraet.logId}</span>
                )}
                <button
                  onClick={() => { setSelectedGeraet(null); }}
                  style={{
                    background: "none", border: "none", color: "white",
                    cursor: "pointer", fontSize: "1.2rem", padding: "0 4px",
                    lineHeight: 1,
                  }}
                  title="Gerät abwählen"
                >
                  ✕
                </button>
              </div>
            )}

          </section>

          {/* ── Ersatzteile Grid ── */}
          {selectedGeraet && (
            <section style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", borderBottom: "1px solid var(--border)", paddingBottom: "1rem" }}>
                <h3 style={{ margin: 0 }}>Ersatzteile</h3>
                {teileQuery.data && !teileQuery.data.kompatibilitaetVorhanden && (
                  <span style={{
                    padding:      "0.25rem 0.8rem",
                    background:   "#fef3c7",
                    color:        "#92400e",
                    borderRadius: 8,
                    fontSize:     "0.8rem",
                    fontWeight:   "bold",
                  }}>
                    ⚠️ Keine Kompatibilität hinterlegt
                  </span>
                )}
              </div>

              {teileQuery.isLoading && (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
                  <div style={{
                    width: 32, height: 32,
                    border: "3px solid var(--border)",
                    borderTopColor: "var(--primary)",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                    margin: "0 auto 1rem",
                  }} />
                  Teile werden geladen...
                </div>
              )}

              {teileQuery.data && (
                <div style={{
                  display:             "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))",
                  gap:                 "0.75rem",
                }}>
                  {teileQuery.data.teile.map((teil) => (
                    <TeilKarte
                      key={teil.teiltyp}
                      teil={teil}
                      onCart={handleAddToCart}
                      inCart={alleKorbItems.some((i) => i.artikelId === teil.artikelId && teil.artikelId !== null)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* ══════════════════════════════ RIGHT COLUMN ═════════════════════════ */}
        <aside style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* ── Warenkorb (gruppiert nach logId) ── */}
          <div style={cardStyle}>
            {/* Header */}
            <div
              style={{
                display:       "flex",
                justifyContent:"space-between",
                alignItems:    "center",
                marginBottom:  totalKorbTeile > 0 || cartOpen ? "1rem" : 0,
                borderBottom:  totalKorbTeile > 0 || cartOpen ? "1px solid var(--border)" : "none",
                paddingBottom: totalKorbTeile > 0 || cartOpen ? "1rem" : 0,
                cursor:        "pointer",
              }}
              onClick={() => setCartOpen(!cartOpen)}
            >
              <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                🛒 Warenkorb
                {totalKorbTeile > 0 && (
                  <span style={{
                    background:     "var(--warning)",
                    color:          "#000",
                    borderRadius:   "50%",
                    width:          22,
                    height:         22,
                    display:        "inline-flex",
                    alignItems:     "center",
                    justifyContent: "center",
                    fontSize:       "0.75rem",
                    fontWeight:     "bold",
                  }}>
                    {totalKorbTeile}
                  </span>
                )}
              </h3>
              <span style={{ color: "var(--text-dim)", fontSize: "1.2rem" }}>
                {cartOpen ? "▲" : "▼"}
              </span>
            </div>

            {(cartOpen || totalKorbTeile > 0) && (
              <>
                {koerbe.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "1.5rem 0", color: "var(--text-dim)" }}>
                    <div style={{ fontSize: "2rem", marginBottom: 8 }}>🛒</div>
                    <div style={{ fontWeight: 600 }}>Warenkorb ist leer</div>
                    <div style={{ fontSize: "0.85rem", marginTop: 4 }}>Wähle Ersatzteile auf der linken Seite</div>
                  </div>
                ) : (
                  <>
                    {/* Gruppen-Karten */}
                    {koerbe.map((korb) => (
                      <div
                        key={korb.id}
                        style={{
                          border:       "1px solid var(--border)",
                          borderRadius: 10,
                          overflow:     "hidden",
                          marginBottom: "0.75rem",
                        }}
                      >
                        {/* Gruppen-Header */}
                        <div style={{
                          background:     "var(--primary)",
                          color:          "white",
                          padding:        "0.55rem 1rem",
                          display:        "flex",
                          justifyContent: "space-between",
                          alignItems:     "center",
                          gap:            8,
                        }}>
                          <span style={{ fontSize: "0.85rem", opacity: 0.9 }}>
                            🖥️ LogID: <strong>{korb.logId}</strong>
                          </span>
                          <span style={{ fontSize: "0.85rem", fontWeight: 700, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                            {korb.geraeteName ?? "Gerät"}
                          </span>
                        </div>

                        {/* Items (Zebra-Muster) */}
                        {korb.items.map((item, idx) => {
                          const teilName  = item.artikel?.kategorie ?? item.teiltyp ?? "Unbekannt";
                          const artName   = item.artikel?.bezeichnung ?? "—";
                          const isNeu     = (item.artikel?.bestand ?? 0) > 0;
                          const odd       = idx % 2 === 1;
                          return (
                            <div
                              key={item.id}
                              style={{
                                display:    "flex",
                                alignItems: "center",
                                gap:        8,
                                padding:    "0.45rem 0.8rem",
                                background: odd ? "var(--card-bg)" : "var(--bg)",
                              }}
                            >
                              <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>
                                {TEIL_ICONS[teilName] ?? "🔧"}
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {teilName}
                                </div>
                                <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {artName}
                                </div>
                              </div>
                              {/* Grading badge */}
                              <span style={{
                                padding:     "0.1rem 0.45rem",
                                borderRadius: 5,
                                background:  "var(--border)",
                                color:       "var(--text-dim)",
                                fontSize:    "0.72rem",
                                fontWeight:  700,
                                flexShrink:  0,
                              }}>
                                {item.grading}
                              </span>
                              {/* Status prediction */}
                              <span style={{
                                padding:     "0.1rem 0.45rem",
                                borderRadius: 10,
                                background:  isNeu ? "#dbeafe" : "#ede9fe",
                                color:       isNeu ? "#1d4ed8" : "#7c3aed",
                                fontSize:    "0.68rem",
                                fontWeight:  800,
                                flexShrink:  0,
                              }}>
                                {isNeu ? "NEU" : "BEDARF"}
                              </span>
                              {/* Entfernen */}
                              <button
                                onClick={() => removeFromCartMutation.mutate({ itemId: item.id })}
                                style={{
                                  background: "none",
                                  border:     "none",
                                  color:      "var(--danger)",
                                  cursor:     "pointer",
                                  fontSize:   "1rem",
                                  padding:    "0 2px",
                                  flexShrink: 0,
                                }}
                                title="Entfernen"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}

                        {/* Gruppen-Footer */}
                        <div style={{
                          padding:    "0.3rem 1rem",
                          background: "var(--bg)",
                          fontSize:   "0.75rem",
                          color:      "var(--text-dim)",
                          textAlign:  "right",
                          borderTop:  "1px solid var(--border)",
                        }}>
                          {korb.items.length} {korb.items.length === 1 ? "Teil" : "Teile"}
                        </div>
                      </div>
                    ))}

                    {/* Globale Optionen + Submit */}
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.8rem", marginTop: "0.4rem" }}>
                      <textarea
                        value={globalZusatzinfo}
                        onChange={(e) => setGlobalZusatzinfo(e.target.value)}
                        placeholder="Kommentar für alle Teile (optional)..."
                        rows={2}
                        style={{
                          ...searchInputStyle,
                          marginBottom: "0.75rem",
                          resize:       "vertical",
                          fontSize:     "0.85rem",
                          padding:      "0.5rem 0.8rem",
                        }}
                      />
                      <button
                        onClick={() => submitAlleMutation.mutate({
                          techniker:  kuerzel,
                          zusatzinfo: globalZusatzinfo || undefined,
                        })}
                        disabled={submitAlleMutation.isPending || totalKorbTeile === 0}
                        style={{
                          background:   "#16a34a",
                          color:        "white",
                          border:       "none",
                          padding:      "0.9rem 1.2rem",
                          borderRadius: "10px",
                          fontWeight:   "bold",
                          cursor:       "pointer",
                          fontFamily:   "'Ubuntu', sans-serif",
                          width:        "100%",
                          fontSize:     "1rem",
                          opacity:      submitAlleMutation.isPending ? 0.7 : 1,
                          boxShadow:    "0 3px 8px rgba(22,163,74,0.3)",
                        }}
                      >
                        {submitAlleMutation.isPending
                          ? "⏳ Wird gesendet..."
                          : `✓ Alle ${totalKorbTeile} Teile anfragen`}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* ── Meine Anfragen (gruppiert nach LogID) ── */}
          <div style={{ ...cardStyle, flex: 1 }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", borderBottom: "1px solid var(--border)", paddingBottom: "1rem" }}>
              <h3 style={{ margin: 0 }}>
                Meine Anfragen
                {offeneCount > 0 && (
                  <span style={{ marginLeft: 8, background: "var(--warning)", color: "#000", borderRadius: 20, padding: "2px 8px", fontSize: "0.75rem", fontWeight: "bold" }}>
                    {offeneCount} offen
                  </span>
                )}
              </h3>
              <small style={{ color: "var(--text-dim)", fontSize: "0.72rem" }}>
                🔄 {lastRefresh.toLocaleTimeString("de-DE")}
              </small>
            </div>

            {/* Filter-Tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: "0.75rem", flexWrap: "wrap" }}>
              {(["alle", "aktiv", "erledigt"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  style={{
                    padding:      "0.3rem 0.8rem",
                    borderRadius: 20,
                    border:       `1px solid ${filterTab === tab ? "var(--primary)" : "var(--border)"}`,
                    background:   filterTab === tab ? "var(--primary)" : "var(--bg)",
                    color:        filterTab === tab ? "white" : "var(--text-dim)",
                    cursor:       "pointer",
                    fontWeight:   filterTab === tab ? 700 : 500,
                    fontSize:     "0.82rem",
                    fontFamily:   "'Ubuntu', sans-serif",
                    transition:   "all 0.15s",
                  }}
                >
                  {tab === "alle" ? "Alle" : tab === "aktiv" ? "Aktiv" : "Erledigt"}
                </button>
              ))}
              {/* LogID-Scan */}
              <div style={{ position: "relative", flex: 1, minWidth: 100 }}>
                <input
                  type="text"
                  value={logIdSearch}
                  onChange={(e) => setLogIdSearch(e.target.value)}
                  placeholder="🔍 LogID..."
                  style={{
                    width:        "100%",
                    padding:      "0.3rem 1.8rem 0.3rem 0.7rem",
                    borderRadius: 20,
                    border:       "1px solid var(--border)",
                    background:   "var(--bg)",
                    color:        "var(--text)",
                    boxSizing:    "border-box",
                    outline:      "none",
                    fontSize:     "0.82rem",
                    fontFamily:   "'Ubuntu', sans-serif",
                  }}
                  onFocus={(e)  => (e.currentTarget.style.borderColor = "var(--primary)")}
                  onBlur={(e)   => (e.currentTarget.style.borderColor = "var(--border)")}
                />
                {logIdSearch && (
                  <button onClick={() => setLogIdSearch("")} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}>✕</button>
                )}
              </div>
            </div>

            {/* Gruppen-Liste */}
            <div style={{ maxHeight: 580, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {anfragenQuery.isLoading && (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>Laden...</div>
              )}
              {!anfragenQuery.isLoading && gefilterteGruppen.length === 0 && (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
                  {logIdSearch ? "Keine Treffer" : "Noch keine Anfragen"}
                </div>
              )}
              {gefilterteGruppen.map((g) => (
                <AnfrageGruppe
                  key={g.key}
                  gruppe={g}
                  kuerzel={kuerzel}
                  onStorno={(item) => setStornoItem(item)}
                />
              ))}
            </div>

            {gruppen.length > 5 && (
              <button
                onClick={() => setShowAllAnfragen(!showAllAnfragen)}
                style={{ ...btnIconStyle, width: "100%", marginTop: "0.8rem", textAlign: "center", color: "var(--text-dim)" }}
              >
                {showAllAnfragen ? "▲ Weniger" : `▼ Alle ${gruppen.length} Gruppen`}
              </button>
            )}
          </div>
        </aside>
      </main>

      {/* Responsive grid override */}
      <style>{`
        @media (max-width: 1100px) {
          .techniker-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}

// ── TeilKarte sub-component ───────────────────────────────────────────────────
// 4 Zustände:
//   A — artikelId vorhanden + bestand > 0  → blau  "🛒 In Warenkorb"
//   B — artikelId vorhanden + bestand = 0  → lila  "📋 Als Bedarf anfragen"
//   C — artikelId null                     → orange "📋 Trotzdem anfragen"
//   D — bereits im Warenkorb               → grün  "✓ Im Warenkorb" (disabled)

const MAX_BESTAND = 10;

function TeilKarte({
  teil,
  onCart,
  inCart,
}: {
  teil:   TeilInfo;
  onCart: (t: TeilInfo, grading: string, zusatzinfo: string) => void;
  inCart: boolean;
}) {
  const [grading,    setGrading]    = useState("A+");
  const [zusatzinfo, setZusatzinfo] = useState("");

  const hasArtikel  = !!teil.artikelId;
  const isAvailable = teil.verfuegbar;

  // Zustand bestimmen
  const zustand: "A" | "B" | "C" | "D" =
    inCart       ? "D" :
    !hasArtikel  ? "C" :
    isAvailable  ? "A" : "B";

  const BTN: Record<"A"|"B"|"C"|"D", { bg: string; label: string; cursor: string }> = {
    A: { bg: "var(--primary)", label: "🛒 In Warenkorb",       cursor: "pointer"     },
    B: { bg: "var(--purple)",  label: "📋 Als Bedarf anfragen", cursor: "pointer"     },
    C: { bg: "#f97316",        label: "📋 Trotzdem anfragen",   cursor: "pointer"     },
    D: { bg: "#16a34a",        label: "✓ Im Warenkorb",         cursor: "not-allowed" },
  };

  const btn = BTN[zustand];

  // Bestandsbalken
  const pct      = Math.min(100, (teil.bestand / MAX_BESTAND) * 100);
  const barColor = teil.bestand > 5 ? "#22c55e" : teil.bestand > 0 ? "#f97316" : "#ef4444";

  return (
    <div style={{
      border:        "1px solid var(--border)",
      borderRadius:  12,
      padding:       "1rem 0.8rem",
      display:       "flex",
      flexDirection: "column",
      gap:           "0.5rem",
      background:    "var(--card-bg)",
      boxShadow:     "0 2px 8px rgba(0,0,0,0.06)",
      transition:    "box-shadow 0.2s",
    }}>
      {/* Icon */}
      <div style={{ fontSize: "1.8rem", textAlign: "center", lineHeight: 1 }}>
        {TEIL_ICONS[teil.teiltyp] ?? "🔧"}
      </div>

      {/* Teiltyp name */}
      <div style={{ fontWeight: 700, fontSize: "0.85rem", textAlign: "center", lineHeight: 1.3 }}>
        {teil.teiltyp}
      </div>

      {/* Artikel-Bezeichnung */}
      <div style={{
        fontSize:        "0.7rem",
        color:           "var(--text-dim)",
        textAlign:       "center",
        overflow:        "hidden",
        textOverflow:    "ellipsis",
        display:         "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        lineHeight:      1.3,
        minHeight:       "2.2em",
      }}>
        {teil.bezeichnung ?? "(kein spezifischer Artikel)"}
      </div>

      {/* Bestand-Anzeige */}
      {zustand === "A" && (
        <>
          <div style={{
            textAlign:  "center",
            fontWeight: 800,
            fontSize:   "0.8rem",
            color:      "#15803d",
          }}>
            ✅ {teil.bestand} Stück verfügbar
          </div>
          <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 3, transition: "width 0.4s" }} />
          </div>
        </>
      )}
      {zustand === "B" && (
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: "0.8rem", color: "#7c3aed" }}>
          ❌ Nicht auf Lager
        </div>
      )}
      {zustand === "C" && (
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: "0.75rem", color: "#f97316" }}>
          ⚠️ Nicht im Lager erfasst
        </div>
      )}
      {zustand === "D" && (
        <div style={{ textAlign: "center", fontWeight: 800, fontSize: "0.8rem", color: "#16a34a" }}>
          ✓ Hinzugefügt
        </div>
      )}

      {/* Grading-Auswahl */}
      {zustand !== "D" && (
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginBottom: 3, fontWeight: 600 }}>
            Grading:
          </div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {(["A+", "A", "B", "C"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGrading(g)}
                style={{
                  padding:      "0.15rem 0.45rem",
                  borderRadius: 5,
                  border:       `1px solid ${grading === g ? "var(--primary)" : "var(--border)"}`,
                  background:   grading === g ? "var(--primary)" : "var(--bg)",
                  color:        grading === g ? "white" : "var(--text)",
                  cursor:       "pointer",
                  fontSize:     "0.72rem",
                  fontWeight:   700,
                  fontFamily:   "'Ubuntu', sans-serif",
                  transition:   "all 0.15s",
                }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Zusatzinfo (außer bei Tastatur und D) */}
      {zustand !== "D" && teil.teiltyp !== "Tastatur" && (
        <input
          type="text"
          value={zusatzinfo}
          onChange={(e) => setZusatzinfo(e.target.value)}
          placeholder="Zusatzinfo..."
          style={{
            padding:      "0.3rem 0.5rem",
            borderRadius: 6,
            border:       "1px solid var(--border)",
            background:   "var(--bg)",
            color:        "var(--text)",
            fontSize:     "0.75rem",
            fontFamily:   "'Ubuntu', sans-serif",
            outline:      "none",
            width:        "100%",
            boxSizing:    "border-box",
          }}
          onFocus={(e)  => (e.currentTarget.style.borderColor = "var(--primary)")}
          onBlur={(e)   => (e.currentTarget.style.borderColor = "var(--border)")}
        />
      )}
      {zustand !== "D" && teil.teiltyp === "Tastatur" && (
        <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", fontStyle: "italic", textAlign: "center" }}>
          ⌨️ Tastatur-Auswahl folgt…
        </div>
      )}

      {/* Haupt-Button */}
      <button
        onClick={() => zustand !== "D" && onCart(teil, grading, zusatzinfo)}
        disabled={zustand === "D"}
        style={{
          background:   btn.bg,
          color:        "white",
          border:       "none",
          padding:      "0.6rem",
          borderRadius: 8,
          fontWeight:   "bold",
          cursor:       btn.cursor,
          fontFamily:   "'Ubuntu', sans-serif",
          fontSize:     "0.82rem",
          opacity:      zustand === "D" ? 0.85 : 1,
          marginTop:    "auto",
        }}
      >
        {btn.label}
      </button>
    </div>
  );
}

// ── AnfrageGruppe sub-component ──────────────────────────────────────────────

type AnfrageRow = {
  id:          number;
  techniker:   string;
  logId:       string;
  geraet:      string;
  geraeteName: string | null;
  teil:        string;
  status:      string;
  datum:       Date;
  grading?:    string | null;
  kommentar?:  string | null;
};

type GruppeData = {
  key:         string;
  logId:       string | null;
  gruppenNr:   string | null;
  geraeteName: string | null;
  datum:       Date;
  anfragen:    AnfrageRow[];
};

type StornoPayload = { id: number; teil: string; techniker: string; logId: string };


const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  NEU:           { bg: "#dbeafe", color: "#1d4ed8", label: "NEU" },
  BEDARF:        { bg: "#ede9fe", color: "#7c3aed", label: "BEDARF" },
  ABGESCHLOSSEN: { bg: "#dcfce7", color: "#15803d", label: "ERLEDIGT ✅" },
  STORNIERT:     { bg: "#f3f4f6", color: "#9ca3af", label: "STORNIERT" },
};

function AnfrageGruppe({
  gruppe,
  kuerzel,
  onStorno,
}: {
  gruppe:   GruppeData;
  kuerzel:  string;
  onStorno: (item: StornoPayload) => void;
}) {
  const router = useRouter();

  // Eigener Query für Nachrichten zu dieser LogID
  // Nur wenn echte LogID vorhanden (nicht "unbekannt" aus Modell-Suche)
  const hasRealLogId = !!(gruppe.logId && gruppe.logId !== "unbekannt");
  const nachrichtenQuery = api.nachrichten.getByLogId.useQuery(
    { kuerzel, logId: gruppe.logId ?? "" },
    { enabled: !!(kuerzel && hasRealLogId), refetchInterval: 5_000, staleTime: 4_000 },
  );
  const nachrichten = nachrichtenQuery.data ?? [];

  const markGelesenMutation = api.nachrichten.markGelesen.useMutation({
    onSuccess: () => nachrichtenQuery.refetch(),
  });
  const anfragen = gruppe.anfragen;

  const alleErledigt   = anfragen.every((a) => a.status === "ABGESCHLOSSEN" || a.status === "STORNIERT");
  const irgendErledigt = anfragen.some((a) => a.status === "ABGESCHLOSSEN");
  const hatBedarf      = anfragen.some((a) => a.status === "BEDARF");

  const headerBg         = alleErledigt ? "#16a34a" : "var(--primary)";
  const headerBorderLeft = !alleErledigt && irgendErledigt
    ? "5px solid #16a34a"
    : !alleErledigt && hatBedarf
    ? "5px solid #f97316"
    : undefined;

  const datum    = new Date(gruppe.datum);
  const datumStr = datum.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

  // Header-Text: echte LogID > GeräteNameName > kurze GruppenNr > Datum
  const headerLogIdText = hasRealLogId
    ? `LogID: ${gruppe.logId}`
    : gruppe.geraeteName
    ? gruppe.geraeteName
    : gruppe.gruppenNr
    ? `Anfrage ${gruppe.gruppenNr.slice(-6)}`
    : `Anfrage ${datumStr}`;

  const headerIcon = hasRealLogId ? "📡" : "🔍";

  return (
    // FIX 2: width 100% + overflow hidden verhindert Abschneiden
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", width: "100%", minWidth: 0 }}>
      {/* Gruppen-Header */}
      <div style={{
        background:     headerBg,
        borderLeft:     headerBorderLeft,
        color:          "white",
        padding:        "0.5rem 0.8rem",
        display:        "flex",
        justifyContent: "space-between",
        alignItems:     "center",
        gap:            6,
        minWidth:       0,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: "0.78rem", opacity: 0.9, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {headerIcon} <strong>{headerLogIdText}</strong>
          </span>
          {/* Zeige GeräteNamen zusätzlich wenn echte LogID vorhanden */}
          {hasRealLogId && gruppe.geraeteName && (
            <span style={{ fontSize: "0.75rem", fontWeight: 700, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.92 }}>
              {gruppe.geraeteName}
            </span>
          )}
        </div>
        <small style={{ opacity: 0.85, flexShrink: 0, fontSize: "0.72rem" }}>{datumStr}</small>
      </div>

      {/* Anfragen-Zeilen (Zebra) */}
      {anfragen.map((a, idx) => {
        const cfg             = STATUS_CFG[a.status] ?? STATUS_CFG.STORNIERT;
        const canStorno       = a.status === "NEU" || a.status === "BEDARF";
        const isAbgeschlossen = a.status === "ABGESCHLOSSEN";
        const odd             = idx % 2 === 1;

        return (
          <div key={a.id} style={{
            padding:   "0.45rem 0.8rem",
            background: odd ? "var(--card-bg)" : "var(--bg)",
            borderTop: idx > 0 ? "1px solid var(--border)" : "none",
            minWidth:  0,
          }}>
            {/* Zeile 1: Icon + Teilname + Grading + Status */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <span style={{ fontSize: "1rem", flexShrink: 0 }}>{TEIL_ICONS[a.teil] ?? "🔧"}</span>
              <strong style={{ flex: 1, fontSize: "0.82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {a.teil}
              </strong>
              {a.grading && (
                <span style={{ padding: "0.1rem 0.4rem", borderRadius: 4, background: "var(--border)", color: "var(--text-dim)", fontSize: "0.68rem", fontWeight: 700, flexShrink: 0 }}>
                  {a.grading}
                </span>
              )}
              <span style={{
                padding:       "0.12rem 0.5rem",
                borderRadius:  10,
                fontWeight:    800,
                fontSize:      "0.65rem",
                textTransform: "uppercase",
                whiteSpace:    "nowrap",
                flexShrink:    0,
                background:    cfg.bg,
                color:         cfg.color,
              }}>
                {cfg.label}
              </span>
            </div>

            {/* Zeile 2: Info + Storno */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2, minWidth: 0 }}>
              <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                {isAbgeschlossen
                  ? <span style={{ color: "#15803d", fontStyle: "normal", fontWeight: 700 }}>✅ Bereit zur Abholung!</span>
                  : a.kommentar
                  ? <span>💬 {a.kommentar}</span>
                  : null
                }
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                {isAbgeschlossen && (
                  <small style={{ color: "var(--text-dim)", fontSize: "0.68rem" }}>
                    {new Date(a.datum).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                  </small>
                )}
                {canStorno && (
                  <button
                    onClick={() => onStorno({ id: a.id, teil: a.teil, techniker: a.techniker, logId: a.logId })}
                    style={{
                      background: "none", border: "1px solid var(--danger)", color: "var(--danger)",
                      padding: "0.1rem 0.45rem", borderRadius: 5, cursor: "pointer",
                      fontSize: "0.68rem", fontWeight: "bold", fontFamily: "'Ubuntu', sans-serif",
                    }}
                  >
                    Storno
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Nachrichten-Panel (falls Nachrichten für diese LogID vorhanden) */}
      {nachrichten.length > 0 && (
        <div style={{ borderTop: "2px solid var(--primary)" }}>
          {nachrichten.slice(0, 2).map((r) => (
            <div key={r.id} style={{
              background:   "rgba(0, 100, 210, 0.07)",
              borderLeft:   "4px solid var(--primary)",
              padding:      "0.6rem 0.8rem",
              borderBottom: "1px solid var(--border)",
            }}>
              <div style={{ fontWeight: 800, fontSize: "0.8rem", color: "var(--primary)", marginBottom: 3, display: "flex", alignItems: "center", gap: 5 }}>
                <span>📬</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.nachricht.betreff}
                </span>
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.nachricht.inhalt.substring(0, 80)}{r.nachricht.inhalt.length > 80 ? "…" : ""}
              </div>
              <button
                onClick={() => {
                  markGelesenMutation.mutate({ nachrichtId: r.nachrichtId, kuerzel });
                  router.push("/techniker/nachrichten");
                }}
                style={{
                  display:      "inline-block",
                  background:   "var(--primary)",
                  color:        "white",
                  padding:      "0.2rem 0.6rem",
                  borderRadius: 6,
                  fontSize:     "0.72rem",
                  fontWeight:   700,
                  fontFamily:   "'Ubuntu', sans-serif",
                  border:       "none",
                  cursor:       "pointer",
                }}
              >
                📖 Lesen & Antworten
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Gruppen-Footer */}
      <div style={{ padding: "0.28rem 0.8rem", background: "var(--bg)", fontSize: "0.68rem", color: "var(--text-dim)", textAlign: "right", borderTop: "1px solid var(--border)" }}>
        {anfragen.length} {anfragen.length === 1 ? "Teil" : "Teile"}
        {nachrichten.length > 0 && (
          <span style={{ marginLeft: 8, color: "var(--primary)", fontWeight: 700 }}>
            · {nachrichten.length} Nachricht{nachrichten.length > 1 ? "en" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
