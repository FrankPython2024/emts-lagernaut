"use client";
import { useState, useEffect } from "react";
import { useSession }    from "next-auth/react";
import { api }           from "@/trpc/react";
import { useToast }      from "@/components/ui/Toast";
import { useSocket }     from "@/hooks/useSocket";
import { EVENTS }        from "@/modules/realtime/events";
import { TastaturModal } from "@/components/ui/TastaturModal";
import AnfragenBox       from "./components/AnfragenBox";
import { TEIL_ICONS }    from "./components/constants";

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
  const [pendingCartItem, setPendingCartItem] = useState<{ teil: TeilInfo; grading: string | null } | null>(null);

  // ── Cart state ─────────────────────────────────────────────────────────────
  const [cartOpen,          setCartOpen]          = useState(false);
  const [globalZusatzinfo,  setGlobalZusatzinfo]  = useState("");

  // (Storno + Anfragen-Filter → jetzt in AnfragenBox Komponente)

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

  // ── Mutations (Cart) ──────────────────────────────────────────────────────

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
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

  const submitAlleMutation = api.warenkorb.submitAlle.useMutation({
    onSuccess: (data) => {
      show(`✅ ${data.anzahl} Teile erfolgreich angefragt!`, "success");
      korbQuery.refetch();
      setCartOpen(false);
      setGlobalZusatzinfo("");
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

  // ── Socket: nur Teile-Refresh (Anfragen-Refresh ist in AnfragenBox) ───────
  useEffect(() => {
    on(EVENTS.BESTAND_UPDATED, () => { if (selectedGeraet) teileQuery.refetch(); });
    return () => { off(EVENTS.BESTAND_UPDATED); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, off]);

  // ── Auto-Refresh (5-Sekunden-Fallback wenn Socket kurz getrennt) ──────────
  // Warenkorb-Auto-Refresh (Anfragen werden von AnfragenBox selbst gepollt)
  useEffect(() => {
    const interval = setInterval(() => { korbQuery.refetch(); }, 5_000);
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
  function handleAddToCart(teil: TeilInfo, grading: string | null, zusatzinfo: string) {
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
      artikelId:   teil.artikelId,
      teiltyp:     teil.teiltyp,
      grading:     grading ?? undefined,   // null → kein Grading → bestmögliches
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
      artikelId:   teil.artikelId,
      teiltyp:     teil.teiltyp,
      grading:     grading ?? undefined,
      zusatzinfo:  kommentar,
    });
  }

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

      {/* Storno-Modal ist jetzt in AnfragenBox */}

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
                              {item.grading ? (
                                <span style={{ padding: "0.1rem 0.45rem", borderRadius: 5, background: "var(--border)", color: "var(--text-dim)", fontSize: "0.72rem", fontWeight: 700, flexShrink: 0 }}>
                                  {item.grading}
                                </span>
                              ) : (
                                <span style={{ padding: "0.1rem 0.45rem", borderRadius: 5, background: "rgba(0,100,210,0.1)", color: "var(--primary)", fontSize: "0.68rem", fontWeight: 600, flexShrink: 0 }}>
                                  Bestmöglich
                                </span>
                              )}
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

          {/* ── Meine Anfragen — in separate AnfragenBox Komponente ausgelagert ── */}
          <AnfragenBox kuerzel={kuerzel} />
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
  onCart: (t: TeilInfo, grading: string | null, zusatzinfo: string) => void;
  inCart: boolean;
}) {
  const [grading,    setGrading]    = useState<string | null>(null);
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

      {/* Grading-Auswahl (optional) */}
      {zustand !== "D" && (
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginBottom: 3, fontWeight: 600 }}>
            Grading <span style={{ fontWeight: 400, fontStyle: "italic" }}>(optional)</span>:
          </div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {(["A+", "A", "B", "C"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGrading(grading === g ? null : g)}
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
          <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", marginTop: 3, fontStyle: "italic" }}>
            ⓘ Ohne Auswahl: bestmögliches verfügbar
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
