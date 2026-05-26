"use client";
import { useState, useEffect, useMemo } from "react";
import { api }       from "@/trpc/react";
import { useToast }  from "@/components/ui/Toast";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS }    from "@/modules/realtime/events";
import AnfragenGruppe from "./AnfragenGruppe";
import { type AnfrageRow, type GruppeData, type StornoPayload } from "./constants";

interface Props { kuerzel: string }

// ── Styles ────────────────────────────────────────────────────────────────────

const TAB_BASE: React.CSSProperties = {
  padding:      "4px 12px",
  borderRadius: 20,
  border:       "1px solid var(--border)",
  background:   "var(--bg)",
  color:        "var(--text-dim)",
  cursor:       "pointer",
  fontWeight:   500,
  fontSize:     "0.82rem",
  fontFamily:   "'Ubuntu', sans-serif",
  transition:   "all 0.15s",
};

const TAB_ACTIVE: React.CSSProperties = {
  ...TAB_BASE,
  background:  "var(--primary)",
  color:       "white",
  border:      "1px solid var(--primary)",
  fontWeight:  700,
};

const BTN: React.CSSProperties = {
  background:   "var(--bg)",
  border:       "1px solid var(--border)",
  color:        "var(--text)",
  padding:      "0.5rem 1rem",
  borderRadius: 8,
  cursor:       "pointer",
  fontFamily:   "'Ubuntu', sans-serif",
  fontWeight:   600,
  fontSize:     "0.85rem",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AnfragenBox({ kuerzel }: Props) {
  const { show }    = useToast();
  const { on, off } = useSocket();

  // State
  const [filterTab,   setFilterTab]   = useState<"alle" | "aktiv" | "erledigt">("alle");
  const [logIdSearch, setLogIdSearch] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [stornoItem,  setStornoItem]  = useState<StornoPayload | null>(null);

  // ── Query ──────────────────────────────────────────────────────────────────
  const anfragenQuery = api.anfragen.getByTechniker.useQuery(
    { kuerzel, showAll: true, limit: 100 },
    { enabled: !!kuerzel, staleTime: 4_000 },
  );

  // ── Mutation ───────────────────────────────────────────────────────────────
  const storniereMutation = api.anfragen.storniere.useMutation({
    onSuccess: () => {
      show("Anfrage storniert", "success");
      setStornoItem(null);
      anfragenQuery.refetch();
      setLastRefresh(new Date());
    },
    onError: (e) => show(e.message, "error"),
  });

  // ── Socket + Auto-Refresh ──────────────────────────────────────────────────
  useEffect(() => {
    const refresh = () => {
      anfragenQuery.refetch();
      setLastRefresh(new Date());
    };
    on(EVENTS.ANFRAGE_UPDATED, refresh);
    on(EVENTS.ANFRAGE_NEU,     refresh);

    const interval = setInterval(refresh, 5_000);

    return () => {
      off(EVENTS.ANFRAGE_UPDATED);
      off(EVENTS.ANFRAGE_NEU);
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Gruppen berechnen ──────────────────────────────────────────────────────
  const alleAnfragen = anfragenQuery.data?.anfragen ?? [];
  const offeneCount  = alleAnfragen.filter((a) => a.status === "NEU" || a.status === "BEDARF").length;

  const gruppen = useMemo<GruppeData[]>(() => {
    const map = new Map<string, GruppeData>();

    for (const a of alleAnfragen) {
      const raw = (a.logId ?? "").trim();
      const key =
        raw && raw !== "unbekannt"
          ? raw
          : (a as { gruppenNr?: string | null }).gruppenNr
          ? (a as { gruppenNr?: string | null }).gruppenNr!
          : `datum-${new Date(a.datum).toISOString().slice(0, 10)}`;

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

      // FIX 3: Deduplizierung — selber Teil + selber Status nur einmal
      if (!g.anfragen.some((x) => x.teil === a.teil && x.status === a.status)) {
        g.anfragen.push(a as AnfrageRow);
      }

      // Neueste Anfrage bestimmt Gruppen-Datum
      if (new Date(a.datum) > g.datum) g.datum = new Date(a.datum);
    }

    return Array.from(map.values()).sort((a, b) => b.datum.getTime() - a.datum.getTime());
  }, [alleAnfragen]);

  const gefiltert = useMemo(() => {
    return gruppen.filter((g) => {
      if (logIdSearch) {
        const q = logIdSearch.toLowerCase();
        if (
          !(g.logId ?? "").toLowerCase().includes(q) &&
          !(g.geraeteName ?? "").toLowerCase().includes(q)
        ) return false;
      }
      if (filterTab === "aktiv")    return g.anfragen.some((a) => a.status === "NEU" || a.status === "BEDARF");
      if (filterTab === "erledigt") return g.anfragen.every((a) => a.status === "ABGESCHLOSSEN" || a.status === "STORNIERT");
      return true;
    });
  }, [gruppen, filterTab, logIdSearch]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      background:   "var(--card-bg)",
      padding:      "1.5rem",
      borderRadius: "12px",
      border:       "1px solid var(--border)",
      boxShadow:    "0 4px 12px rgba(0,0,0,0.08)",
    }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", borderBottom: "1px solid var(--border)", paddingBottom: "1rem" }}>
        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          Meine Anfragen
          {offeneCount > 0 && (
            <span style={{ background: "var(--warning)", color: "#000", borderRadius: 20, padding: "2px 8px", fontSize: "0.75rem", fontWeight: "bold" }}>
              {offeneCount} offen
            </span>
          )}
        </h3>
        <small style={{ color: "var(--text-dim)", fontSize: "0.72rem" }}>
          🔄 {lastRefresh.toLocaleTimeString("de-DE")}
        </small>
      </div>

      {/* ── Filter Tabs + LogID Suche ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {(["alle", "aktiv", "erledigt"] as const).map((tab) => (
          <button key={tab} onClick={() => setFilterTab(tab)} style={filterTab === tab ? TAB_ACTIVE : TAB_BASE}>
            {tab === "alle" ? "Alle" : tab === "aktiv" ? "Aktiv" : "Erledigt"}
          </button>
        ))}

        <div style={{ position: "relative", flex: 1, minWidth: 100 }}>
          <input
            type="text"
            value={logIdSearch}
            onChange={(e) => setLogIdSearch(e.target.value)}
            placeholder="🔍 LogID oder Gerät..."
            style={{
              width:        "100%",
              padding:      "4px 24px 4px 8px",
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
            <button
              onClick={() => setLogIdSearch("")}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "0.9rem" }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Gruppen-Liste ──
           KEIN max-height auf dem Container selbst!
           Jede Karte wird so hoch wie nötig.
           Die rechte Spalte scrollt über den Browser-Viewport.
      ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {anfragenQuery.isLoading && (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>Laden...</div>
        )}
        {anfragenQuery.isError && (
          <div style={{ textAlign: "center", padding: "1rem", color: "var(--danger)", fontSize: "0.85rem" }}>
            Fehler beim Laden — {anfragenQuery.error.message}
          </div>
        )}
        {!anfragenQuery.isLoading && !anfragenQuery.isError && gefiltert.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
            {logIdSearch ? "Keine Treffer für diese Suche" : "Noch keine Anfragen vorhanden"}
          </div>
        )}
        {gefiltert.map((g) => (
          <AnfragenGruppe key={g.key} gruppe={g} kuerzel={kuerzel} onStorno={setStornoItem} />
        ))}
      </div>

      {/* ── Storno-Bestätigungs-Modal ── */}
      {stornoItem && (
        <div
          style={{
            position:       "fixed",
            top: 0, left: 0,
            width: "100%", height: "100%",
            background:     "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            zIndex:         10000,
            display:        "flex",
            justifyContent: "center",
            alignItems:     "center",
          }}
          onClick={() => setStornoItem(null)}
        >
          <div
            style={{
              background:   "var(--card-bg)",
              width:        400,
              padding:      "2.5rem",
              borderRadius: "15px",
              boxShadow:    "0 20px 40px rgba(0,0,0,0.3)",
              textAlign:    "center",
              color:        "var(--text)",
              border:       "2px solid var(--danger)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🗑️</div>
            <h3 style={{ margin: "0 0 8px", color: "var(--danger)" }}>Anfrage stornieren</h3>
            <p style={{ color: "var(--text-dim)", margin: "0 0 1.5rem" }}>
              Möchtest du <strong style={{ color: "var(--text)" }}>{stornoItem.teil}</strong> wirklich stornieren?
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button onClick={() => setStornoItem(null)} style={BTN}>
                Abbrechen
              </button>
              <button
                onClick={() => storniereMutation.mutate({ id: stornoItem.id, techniker: stornoItem.techniker })}
                disabled={storniereMutation.isPending}
                style={{ ...BTN, background: "var(--danger)", color: "white", border: "none", opacity: storniereMutation.isPending ? 0.7 : 1 }}
              >
                Ja, stornieren
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
