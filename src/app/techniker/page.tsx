"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSession }  from "next-auth/react";
import { AnfrageStatus } from "@prisma/client";
import { api }          from "@/trpc/react";
import { useToast }     from "@/components/ui/Toast";
import { useSocket }    from "@/hooks/useSocket";
import { EVENTS }       from "@/modules/realtime/events";
import { TastaturModal } from "@/components/ui/TastaturModal";
import { useDebounce }  from "use-debounce";

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

// ── StatusPill ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; bg: string; color: string }> = {
  NEU:           { label: "NEU",           bg: "#dbeafe", color: "#1d4ed8" },
  BEDARF:        { label: "BEDARF",        bg: "#ede9fe", color: "#7c3aed" },
  ABGESCHLOSSEN: { label: "ERLEDIGT",      bg: "#dcfce7", color: "#15803d" },
  STORNIERT:     { label: "STORNIERT",     bg: "#f3f4f6", color: "#6b7280" },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, bg: "#f3f4f6", color: "#6b7280" };
  return (
    <span style={{
      padding:       "0.25rem 0.7rem",
      borderRadius:  12,
      fontWeight:    800,
      fontSize:      "0.75rem",
      textTransform: "uppercase",
      whiteSpace:    "nowrap",
      display:       "inline-block",
      background:    cfg.bg,
      color:         cfg.color,
      letterSpacing: "0.05em",
    }}>
      {cfg.label}
    </span>
  );
}

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
  const [recentGeraete,  setRecentGeraete]  = useState<GeraetInfo[]>([]);

  // ── Order state ────────────────────────────────────────────────────────────
  const [orderPart,      setOrderPart]      = useState<TeilInfo | null>(null);
  const [showTastatur,   setShowTastatur]   = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderLogId,     setOrderLogId]     = useState("");
  const [orderKommentar, setOrderKommentar] = useState("");

  // ── Cart state ─────────────────────────────────────────────────────────────
  const [cartOpen,       setCartOpen]       = useState(false);

  // ── Storno state ──────────────────────────────────────────────────────────
  const [stornoItem, setStornoItem] = useState<{ id: number; teil: string; techniker: string; logId: string } | null>(null);

  // ── Anfragen filter ────────────────────────────────────────────────────────
  const [showAllAnfragen, setShowAllAnfragen]   = useState(false);
  const [anfragenFilter,  setAnfragenFilter]    = useState("");
  const [nurOffene,       setNurOffene]          = useState(false);

  // ── Load recent devices ────────────────────────────────────────────────────
  useEffect(() => {
    if (!kuerzel) return;
    try {
      const s = localStorage.getItem(`lgnt_recent_${kuerzel}`);
      if (s) setRecentGeraete(JSON.parse(s));
    } catch {}
  }, [kuerzel]);

  // ── Debounce model search ──────────────────────────────────────────────────
  const [debouncedModell] = useDebounce(identInput, 400);

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

  const createAnfrage = api.anfragen.create.useMutation({
    onSuccess: () => {
      show("✅ Anfrage erfolgreich gesendet!", "success");
      anfragenQuery.refetch();
      closeOrderModal();
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

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
      show(`✅ ${data.anzahl} Anfragen abgesendet! (${data.gruppenNr})`, "success");
      korbQuery.refetch();
      anfragenQuery.refetch();
      setCartOpen(false);
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    on(EVENTS.ANFRAGE_UPDATED, () => { anfragenQuery.refetch(); });
    return () => { off(EVENTS.ANFRAGE_UPDATED); };
  }, [on, off, anfragenQuery]);

  // ── Helper functions ──────────────────────────────────────────────────────

  function selectGeraet(geraet: GeraetInfo) {
    setSelectedGeraet(geraet);
    setOrderLogId(geraet.logId === "---" ? "" : geraet.logId);
    setIdentInput("");

    const next = [geraet, ...recentGeraete.filter((g) => g.logId !== geraet.logId)].slice(0, 5);
    setRecentGeraete(next);
    try {
      if (kuerzel) localStorage.setItem(`lgnt_recent_${kuerzel}`, JSON.stringify(next));
    } catch {}

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

  function handleOrderPart(teil: TeilInfo) {
    if (!teil.artikelId) {
      show("Kein Artikel für dieses Teil verknüpft", "warning");
      return;
    }
    setOrderPart(teil);
    if (teil.teiltyp === "Tastatur") {
      setShowTastatur(true);
    } else {
      setShowOrderModal(true);
    }
  }

  function handleTastaturConfirm(kommentar: string) {
    setOrderKommentar(kommentar);
    setShowTastatur(false);
    setShowOrderModal(true);
  }

  function closeOrderModal() {
    setShowOrderModal(false);
    setShowTastatur(false);
    setOrderPart(null);
    setOrderKommentar("");
    setOrderLogId(selectedGeraet?.logId === "---" ? "" : (selectedGeraet?.logId ?? ""));
  }

  function handleOrderSubmit() {
    if (!orderPart?.artikelId || !kuerzel) return;
    const logIdFinal = orderLogId.trim() || selectedGeraet?.logId || "---";

    createAnfrage.mutate({
      techniker:    kuerzel,
      logId:        logIdFinal,
      geraeteName:  selectedGeraet?.bereinigt,
      geraet:       selectedGeraet?.bereinigt ?? orderPart.teiltyp,
      artikelId:    orderPart.artikelId,
      teil:         orderPart.teiltyp,
      kommentar:    orderKommentar || undefined,
    });
  }

  function handleAddToCart(teil: TeilInfo) {
    if (!teil.artikelId || !selectedGeraet || !kuerzel) {
      show("Bitte zuerst ein Gerät auswählen", "warning");
      return;
    }
    addToCartMutation.mutate({
      techniker:   kuerzel,
      logId:       selectedGeraet.logId === "---" ? "unbekannt" : selectedGeraet.logId,
      geraeteName: selectedGeraet.bereinigt,
      artikelId:   teil.artikelId,
    });
  }

  // ── Filtered Anfragen ──────────────────────────────────────────────────────
  const alleAnfragen = anfragenQuery.data?.anfragen ?? [];
  const filteredAnfragen = alleAnfragen
    .filter((a) => {
      if (nurOffene && a.status !== "NEU" && a.status !== "BEDARF") return false;
      if (anfragenFilter) {
        const q = anfragenFilter.toLowerCase();
        return (
          a.logId.toLowerCase().includes(q) ||
          a.teil.toLowerCase().includes(q) ||
          (a.geraet?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });

  const offeneCount = alleAnfragen.filter((a) => a.status === "NEU" || a.status === "BEDARF").length;
  const korb        = korbQuery.data;
  const korbItems   = korb?.items ?? [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Tastatur Modal ── */}
      <TastaturModal
        open={showTastatur}
        articleName={orderPart?.bezeichnung ?? orderPart?.teiltyp ?? "Tastatur"}
        onConfirm={handleTastaturConfirm}
        onClose={() => { setShowTastatur(false); setOrderPart(null); }}
      />

      {/* ── Order Confirmation Modal ── */}
      {showOrderModal && orderPart && (
        <div style={modalOverlay()} onClick={closeOrderModal}>
          <div
            style={{ ...modalContent, border: "2px solid var(--primary)", textAlign: "left" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: "var(--primary)" }}>Ersatzteilanfrage Details</h3>
            <p style={{ color: "var(--text-dim)", marginBottom: 20 }}>
              {orderPart.bezeichnung ?? orderPart.teiltyp}
              {selectedGeraet && (
                <span> — <strong style={{ color: "var(--text)" }}>{selectedGeraet.bereinigt}</strong></span>
              )}
            </p>

            {/* Tastatur info if set */}
            {orderKommentar && (
              <div style={{
                marginBottom: 15, padding: "10px 14px",
                background: "var(--bg)", borderRadius: 8,
                borderLeft: "3px solid var(--primary)",
              }}>
                <small style={{ color: "var(--text-dim)", display: "block", marginBottom: 4 }}>⌨️ Tastatur-Auswahl:</small>
                <span style={{ fontWeight: "bold", color: "var(--primary)" }}>{orderKommentar}</span>
              </div>
            )}

            {/* LogID input */}
            <label style={{ display: "block", textAlign: "center", fontSize: "0.8rem", fontWeight: "bold", marginBottom: 5 }}>
              LogID des Gerätes:
            </label>
            <input
              type="text"
              value={orderLogId}
              onChange={(e) => setOrderLogId(e.target.value)}
              placeholder="LogID scannen oder eingeben..."
              inputMode="numeric"
              style={{
                ...searchInputStyle,
                textAlign:    "center",
                fontSize:     "1.5rem",
                fontWeight:   "bold",
                letterSpacing: 4,
                borderColor:  "var(--primary)",
                marginBottom: 10,
              }}
              onKeyDown={(e) => { if (e.key === "Enter") handleOrderSubmit(); }}
            />

            {/* Kommentar */}
            {!orderKommentar && (
              <textarea
                value={orderKommentar}
                onChange={(e) => setOrderKommentar(e.target.value)}
                placeholder="Kommentar (optional)..."
                rows={2}
                style={{
                  ...searchInputStyle,
                  marginBottom: 15,
                  resize: "vertical",
                }}
              />
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              <button onClick={closeOrderModal} style={btnIconStyle}>Abbrechen</button>
              <button
                onClick={handleOrderSubmit}
                disabled={createAnfrage.isPending}
                style={{ ...btnOrderStyle, opacity: createAnfrage.isPending ? 0.7 : 1 }}
              >
                {createAnfrage.isPending ? "Wird gesendet..." : "Durchführen"}
              </button>
            </div>
          </div>
        </div>
      )}

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

            {/* Recent devices */}
            {recentGeraete.length > 0 && (
              <div>
                <small style={{ color: "var(--text-dim)", fontWeight: "bold", display: "block", marginBottom: 6 }}>
                  Zuletzt verwendet:
                </small>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {recentGeraete.map((g) => (
                    <button
                      key={g.logId}
                      onClick={() => selectGeraet(g)}
                      style={{
                        ...btnIconStyle,
                        padding:   "0.3rem 0.8rem",
                        fontSize:  "0.85rem",
                        color:     selectedGeraet?.logId === g.logId ? "var(--primary)" : "var(--text-dim)",
                        border:    `1px solid ${selectedGeraet?.logId === g.logId ? "var(--primary)" : "var(--border)"}`,
                      }}
                    >
                      {g.bereinigt.split(" ").slice(0, 3).join(" ")}
                    </button>
                  ))}
                </div>
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
                      onOrder={handleOrderPart}
                      onCart={handleAddToCart}
                      cartLoading={addToCartMutation.isPending}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* ══════════════════════════════ RIGHT COLUMN ═════════════════════════ */}
        <aside style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* ── Warenkorb ── */}
          <div style={cardStyle}>
            <div
              style={{
                display:        "flex",
                justifyContent: "space-between",
                alignItems:     "center",
                marginBottom:   korbItems.length > 0 || cartOpen ? "1rem" : 0,
                borderBottom:   korbItems.length > 0 || cartOpen ? "1px solid var(--border)" : "none",
                paddingBottom:  korbItems.length > 0 || cartOpen ? "1rem" : 0,
                cursor:         "pointer",
              }}
              onClick={() => setCartOpen(!cartOpen)}
            >
              <h3 style={{ margin: 0 }}>
                🛒 Warenkorb
                {korbItems.length > 0 && (
                  <span style={{
                    marginLeft:   8,
                    background:   "var(--warning)",
                    color:        "#000",
                    borderRadius: "50%",
                    width:        22,
                    height:       22,
                    display:      "inline-flex",
                    alignItems:   "center",
                    justifyContent: "center",
                    fontSize:     "0.75rem",
                    fontWeight:   "bold",
                  }}>
                    {korbItems.length}
                  </span>
                )}
              </h3>
              <span style={{ color: "var(--text-dim)", fontSize: "1.2rem" }}>
                {cartOpen ? "▲" : "▼"}
              </span>
            </div>

            {(cartOpen || korbItems.length > 0) && (
              <>
                {korbItems.length === 0 ? (
                  <p style={{ color: "var(--text-dim)", textAlign: "center", padding: "1rem 0" }}>
                    Warenkorb ist leer
                  </p>
                ) : (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1rem" }}>
                      {korbItems.map((item) => (
                        <div
                          key={item.id}
                          style={{
                            display:    "flex",
                            alignItems: "center",
                            gap:        8,
                            padding:    "0.5rem 0.8rem",
                            background: "var(--bg)",
                            borderRadius: 8,
                          }}
                        >
                          <span style={{ fontSize: "1.2rem" }}>
                            {TEIL_ICONS[item.artikel.kategorie] ?? "🔧"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.artikel.kategorie}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.artikel.bezeichnung}
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeFromCartMutation.mutate({ itemId: item.id }); }}
                            style={{
                              background: "none", border: "none",
                              color: "var(--danger)", cursor: "pointer",
                              fontSize: "1rem", padding: "0 4px",
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    {korb && (
                      <button
                        onClick={() => submitCartMutation.mutate({ korbId: korb.id })}
                        disabled={submitCartMutation.isPending}
                        style={{ ...btnOrderStyle, opacity: submitCartMutation.isPending ? 0.7 : 1 }}
                      >
                        {submitCartMutation.isPending ? "Wird gesendet..." : `Alle bestellen (${korbItems.length})`}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* ── Meine Anfragen ── */}
          <div style={{ ...cardStyle, flex: 1 }}>
            {/* Header */}
            <div style={{
              display:        "flex",
              justifyContent: "space-between",
              alignItems:     "center",
              marginBottom:   "1rem",
              borderBottom:   "1px solid var(--border)",
              paddingBottom:  "1rem",
            }}>
              <h3 style={{ margin: 0 }}>Meine Anfragen</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {offeneCount > 0 && (
                  <button
                    onClick={() => setNurOffene(!nurOffene)}
                    style={{
                      display:      "flex",
                      alignItems:   "center",
                      gap:          4,
                      background:   nurOffene ? "var(--warning)" : "var(--bg)",
                      color:        nurOffene ? "#000" : "var(--text)",
                      border:       `1px solid ${nurOffene ? "var(--warning)" : "var(--border)"}`,
                      padding:      "4px 10px",
                      borderRadius: 20,
                      fontWeight:   "bold",
                      cursor:       "pointer",
                      fontSize:     "0.85rem",
                    }}
                  >
                    {offeneCount} offen
                  </button>
                )}
                <button
                  onClick={() => anfragenQuery.refetch()}
                  style={{ ...btnIconStyle, padding: "4px 8px" }}
                  title="Aktualisieren"
                >
                  🔄
                </button>
              </div>
            </div>

            {/* Search */}
            <div style={{ position: "relative", marginBottom: "1rem" }}>
              <input
                type="text"
                value={anfragenFilter}
                onChange={(e) => setAnfragenFilter(e.target.value)}
                placeholder="🔍 LogID, Teil oder Gerät suchen..."
                style={{
                  width:        "100%",
                  padding:      "0.6rem 2rem 0.6rem 0.9rem",
                  borderRadius: 8,
                  border:       "1px solid var(--border)",
                  background:   "var(--bg)",
                  color:        "var(--text)",
                  boxSizing:    "border-box",
                  outline:      "none",
                  fontFamily:   "'Ubuntu', sans-serif",
                  transition:   "border-color 0.2s",
                }}
                onFocus={(e)  => (e.currentTarget.style.borderColor = "var(--primary)")}
                onBlur={(e)   => (e.currentTarget.style.borderColor = "var(--border)")}
              />
              {anfragenFilter && (
                <button
                  onClick={() => setAnfragenFilter("")}
                  style={{
                    position:  "absolute", right: 10, top: "50%",
                    transform: "translateY(-50%)",
                    background: "none", border: "none",
                    color: "var(--text-dim)", cursor: "pointer",
                    fontWeight: "bold",
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* List */}
            <div style={{ maxHeight: 620, overflowY: "auto" }}>
              {anfragenQuery.isLoading && (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
                  Laden...
                </div>
              )}
              {!anfragenQuery.isLoading && filteredAnfragen.length === 0 && (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
                  {anfragenFilter ? "Keine Treffer" : "Noch keine Anfragen"}
                </div>
              )}
              {filteredAnfragen.map((a) => (
                <AnfrageZeile
                  key={a.id}
                  anfrage={a}
                  onStorno={() => setStornoItem({
                    id:        a.id,
                    teil:      a.teil,
                    techniker: a.techniker,
                    logId:     a.logId,
                  })}
                />
              ))}
            </div>

            {/* Toggle alle/offene */}
            {alleAnfragen.length > 10 && (
              <button
                onClick={() => setShowAllAnfragen(!showAllAnfragen)}
                style={{
                  ...btnIconStyle,
                  width:    "100%",
                  marginTop: "0.8rem",
                  textAlign: "center",
                  color:    "var(--text-dim)",
                }}
              >
                {showAllAnfragen ? "▲ Weniger anzeigen" : `▼ Alle ${alleAnfragen.length} anzeigen`}
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

function TeilKarte({
  teil,
  onOrder,
  onCart,
  cartLoading,
}: {
  teil:        TeilInfo;
  onOrder:     (t: TeilInfo) => void;
  onCart:      (t: TeilInfo) => void;
  cartLoading: boolean;
}) {
  const hasArtikel  = !!teil.artikelId;
  const isAvailable = teil.verfuegbar;

  return (
    <div style={{
      border:        `1px solid var(--border)`,
      borderRadius:  10,
      padding:       "1rem 0.8rem",
      display:       "flex",
      flexDirection: "column",
      gap:           "0.5rem",
      background:    "var(--card-bg)",
      opacity:       hasArtikel ? 1 : 0.55,
      transition:    "box-shadow 0.2s",
      boxShadow:     hasArtikel ? "0 2px 8px rgba(0,0,0,0.05)" : "none",
    }}>
      {/* Icon */}
      <div style={{ fontSize: "1.8rem", textAlign: "center", lineHeight: 1 }}>
        {TEIL_ICONS[teil.teiltyp] ?? "🔧"}
      </div>

      {/* Name */}
      <div style={{ fontWeight: 700, fontSize: "0.85rem", textAlign: "center", lineHeight: 1.3 }}>
        {teil.teiltyp}
      </div>

      {/* Artikel name */}
      {teil.bezeichnung && (
        <div style={{
          fontSize:     "0.7rem",
          color:        "var(--text-dim)",
          textAlign:    "center",
          overflow:     "hidden",
          textOverflow: "ellipsis",
          display:      "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          lineHeight:   1.3,
        }}>
          {teil.bezeichnung}
        </div>
      )}

      {/* Bestand badge */}
      <div style={{ textAlign: "center" }}>
        {hasArtikel ? (
          <span style={{
            padding:       "0.2rem 0.7rem",
            borderRadius:  12,
            fontWeight:    800,
            fontSize:      "0.75rem",
            textTransform: "uppercase",
            display:       "inline-block",
            background:    isAvailable ? "#dcfce7" : "#ede9fe",
            color:         isAvailable ? "#15803d"  : "#7c3aed",
          }}>
            {isAvailable ? `✓ ${teil.bestand}×` : "Bedarf"}
          </span>
        ) : (
          <span style={{
            padding:    "0.2rem 0.7rem",
            borderRadius: 12,
            background: "#f3f4f6",
            color:      "#9ca3af",
            fontSize:   "0.75rem",
            fontWeight: "bold",
          }}>
            —
          </span>
        )}
      </div>

      {/* Bestellen button */}
      <button
        onClick={() => onOrder(teil)}
        disabled={!hasArtikel}
        style={{
          background:   hasArtikel ? "var(--primary)" : "var(--border)",
          color:        hasArtikel ? "white"          : "var(--text-dim)",
          border:       "none",
          padding:      "0.6rem",
          borderRadius: 8,
          fontWeight:   "bold",
          cursor:       hasArtikel ? "pointer" : "not-allowed",
          fontFamily:   "'Ubuntu', sans-serif",
          fontSize:     "0.85rem",
        }}
      >
        Bestellen
      </button>

      {/* Cart button */}
      <button
        onClick={() => onCart(teil)}
        disabled={!hasArtikel || cartLoading}
        style={{
          background:   "var(--bg)",
          color:        hasArtikel ? "var(--text)" : "var(--text-dim)",
          border:       `1px solid var(--border)`,
          padding:      "0.4rem",
          borderRadius: 6,
          cursor:       hasArtikel ? "pointer" : "not-allowed",
          fontFamily:   "'Ubuntu', sans-serif",
          fontSize:     "0.8rem",
          fontWeight:   600,
        }}
      >
        🛒 Warenkorb
      </button>
    </div>
  );
}

// ── AnfrageZeile sub-component ────────────────────────────────────────────────

type AnfrageRow = {
  id:          number;
  techniker:   string;
  logId:       string;
  geraet:      string;
  geraeteName: string | null;
  teil:        string;
  status:      string;
  datum:       Date;
  kommentar?:  string | null;
  gruppenNr?:  string | null;
};

const STATUS_CFG_PILL: Record<string, { bg: string; color: string; label: string }> = {
  NEU:           { bg: "#dbeafe", color: "#1d4ed8", label: "Neu" },
  BEDARF:        { bg: "#ede9fe", color: "#7c3aed", label: "Bedarf" },
  ABGESCHLOSSEN: { bg: "#dcfce7", color: "#15803d", label: "Erledigt" },
  STORNIERT:     { bg: "#f3f4f6", color: "#9ca3af", label: "Storniert" },
};

function AnfrageZeile({ anfrage, onStorno }: { anfrage: AnfrageRow; onStorno: () => void }) {
  const cfg      = STATUS_CFG_PILL[anfrage.status] ?? STATUS_CFG_PILL.STORNIERT;
  const canStorno = anfrage.status === "NEU" || anfrage.status === "BEDARF";
  const datum    = new Date(anfrage.datum);
  const dateStr  = datum.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const timeStr  = datum.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{
      padding:      "0.8rem",
      borderBottom: "1px solid var(--border)",
      display:      "flex",
      gap:          12,
      alignItems:   "flex-start",
    }}>
      {/* Icon */}
      <span style={{ fontSize: "1.3rem", marginTop: 2, flexShrink: 0 }}>
        {TEIL_ICONS[anfrage.teil] ?? "🔧"}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
          <strong style={{ fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {anfrage.teil}
          </strong>
          <span style={{
            padding:       "0.2rem 0.6rem",
            borderRadius:  10,
            fontWeight:    800,
            fontSize:      "0.7rem",
            textTransform: "uppercase",
            whiteSpace:    "nowrap",
            flexShrink:    0,
            background:    cfg.bg,
            color:         cfg.color,
          }}>
            {cfg.label}
          </span>
        </div>

        <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: 2 }}>
          <span style={{ fontWeight: 600 }}>#{anfrage.logId}</span>
          {anfrage.geraeteName && (
            <span style={{ marginLeft: 6 }}>— {anfrage.geraeteName}</span>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <small style={{ color: "var(--text-dim)" }}>
            {dateStr} {timeStr}
          </small>
          {canStorno && (
            <button
              onClick={onStorno}
              style={{
                background: "none",
                border:     "1px solid var(--danger)",
                color:      "var(--danger)",
                padding:    "0.15rem 0.5rem",
                borderRadius: 6,
                cursor:     "pointer",
                fontSize:   "0.75rem",
                fontWeight: "bold",
                fontFamily: "'Ubuntu', sans-serif",
              }}
            >
              Storno
            </button>
          )}
        </div>

        {anfrage.kommentar && (
          <div style={{
            fontSize: "0.75rem", color: "var(--text-dim)",
            marginTop: 4, fontStyle: "italic",
          }}>
            💬 {anfrage.kommentar}
          </div>
        )}
      </div>
    </div>
  );
}
