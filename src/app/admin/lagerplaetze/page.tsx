"use client";
import { useState } from "react";
import { useDebounce } from "use-debounce";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageLoader } from "@/components/ui/LoadingSpinner";

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function herstellerFarbe(h: string | null): { bg: string; border: string; textColor: string } {
  switch (h) {
    case "Dell":   return { bg: "rgba(0,139,210,0.12)",  border: "var(--afb-blue)",  textColor: "var(--afb-blue)" };
    case "HP":     return { bg: "rgba(32,47,97,0.12)",   border: "var(--afb-navy)",  textColor: "var(--afb-navy)" };
    case "Lenovo": return { bg: "rgba(4,180,117,0.12)",  border: "var(--afb-green)", textColor: "var(--afb-green)" };
    case "Fujitsu":return { bg: "rgba(124,58,237,0.12)", border: "#7c3aed",          textColor: "#7c3aed" };
    default:       return { bg: "rgba(0,0,0,0.03)",      border: "var(--border)",    textColor: "var(--text-dim)" };
  }
}

function gradingFarbe(g?: string | null): string {
  switch (g) {
    case "A+": return "var(--afb-green)";
    case "A":  return "var(--afb-green)";
    case "B":  return "var(--afb-blue)";
    case "C":  return "#F59E0B";
    default:   return "#94A3B8";
  }
}

// ── ETL Detail-Modal ──────────────────────────────────────────────────────────

type EtlPlatz = {
  id:         number;
  code:       string;
  regal:      number;
  reihe:      number;
  ebene:      number;
  fach:       number;
  hersteller: string | null;
  modellId:   number | null;
  modell:     { id: number; modell: string; hersteller: string } | null;
};

function EtlDetailModal({ platz, onClose }: { platz: EtlPlatz; onClose: () => void }) {
  const detailQ = api.lagerplatz.platzDetail.useQuery(
    { id: platz.id },
    { staleTime: 0 },
  );
  const d = detailQ.data;

  return (
    <Modal open onClose={onClose} title={platz.code}>
      <div style={{ minWidth: 300, maxWidth: 480 }}>
        {/* Klartext-Lage */}
        <div style={{ marginBottom: "1rem", padding: "0.6rem 0.8rem", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", fontSize: "0.85rem", color: "var(--text-dim)" }}>
          Reihe {platz.reihe} · Ebene {platz.ebene} · Fach {platz.fach}
          {platz.hersteller && (
            <span style={{ marginLeft: 8, fontWeight: 700, color: herstellerFarbe(platz.hersteller).textColor }}>
              {platz.hersteller}-Bereich
            </span>
          )}
        </div>

        {detailQ.isLoading && (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
            <div style={{ width: 32, height: 32, border: "3px solid var(--border)", borderTopColor: "var(--afb-navy)", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 0.8rem" }} />
            Lade Details…
          </div>
        )}

        {d && !d.platz?.modellId && (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: 8 }}>📭</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Dieser Platz ist leer</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
              Zuweisung erfolgt über den Einlager-Assistenten.
            </div>
          </div>
        )}

        {d?.platz?.modell && (
          <>
            <div style={{ marginBottom: "1rem", padding: "0.8rem", borderRadius: 10, border: `2px solid ${herstellerFarbe(d.platz.modell.hersteller).border}`, background: herstellerFarbe(d.platz.modell.hersteller).bg }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-dim)", marginBottom: 2 }}>Modell</div>
              <div style={{ fontWeight: 800, fontSize: "1rem", color: "var(--text)" }}>{d.platz.modell.modell}</div>
              <div style={{ fontSize: "0.8rem", color: herstellerFarbe(d.platz.modell.hersteller).textColor, fontWeight: 600 }}>{d.platz.modell.hersteller}</div>
            </div>

            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-dim)", marginBottom: 8 }}>
              Teile auf diesem Platz ({d.artikel.length})
            </div>

            {d.artikel.length === 0 ? (
              <div style={{ fontSize: "0.85rem", color: "var(--text-dim)", padding: "0.5rem" }}>Keine Artikel gefunden.</div>
            ) : (
              <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {d.artikel.map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.5rem 0.7rem", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.85rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.kategorie}
                      </div>
                    </div>
                    {a.grading ? (
                      <span style={{ background: gradingFarbe(a.grading), color: "#fff", fontWeight: 800, fontSize: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: 5, flexShrink: 0 }}>
                        {a.grading}
                      </span>
                    ) : (
                      <span style={{ background: "var(--border)", color: "var(--text-dim)", fontWeight: 700, fontSize: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: 5, flexShrink: 0 }}>
                        —
                      </span>
                    )}
                    <span style={{ fontSize: "0.8rem", color: a.bestand > 0 ? "var(--afb-green)" : "var(--text-dim)", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {a.bestand} Stk
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: "1.2rem" }}>
          <button
            onClick={onClose}
            style={{ width: "100%", minHeight: 48, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontWeight: 700, fontSize: "0.95rem" }}
          >
            Schließen
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── ETL-Reihe ─────────────────────────────────────────────────────────────────

function EtlReihe({ reihe, plaetze, onKlick }: {
  reihe:   number;
  plaetze: EtlPlatz[];
  onKlick: (p: EtlPlatz) => void;
}) {
  if (plaetze.length === 0) return null;

  const hersteller = plaetze[0]?.hersteller ?? "";
  const regal      = plaetze[0]?.regal ?? 0;
  const ebenen     = [...new Set(plaetze.map((p) => p.ebene))].sort((a, b) => a - b);
  const faecher    = [...new Set(plaetze.map((p) => p.fach))].sort((a, b) => b - a); // 5→1

  // Lookup: code → platz
  const platzMap = new Map(plaetze.map((p) => [`${p.ebene}-${p.fach}`, p]));

  const { border: herstellerBorder, textColor: herstellerText } = herstellerFarbe(hersteller);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      {/* Reihen-Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontWeight: 800, fontSize: "0.9rem", color: "var(--text)" }}>
          <span style={{ color: herstellerText }}>{hersteller}</span> Reihe {reihe}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
          Regal {regal} · {plaetze.filter((p) => p.modellId).length}/{plaetze.length} belegt
        </span>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>

      {/* Ebenen-Header + Grid — horizontal scrollbar auf Mobile */}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ minWidth: `calc(80px + ${ebenen.length} * 96px + ${ebenen.length * 4}px)` }}>

      {/* Ebenen-Header */}
      <div style={{ display: "grid", gridTemplateColumns: `80px repeat(${ebenen.length}, minmax(88px, 1fr))`, gap: 4, marginBottom: 2 }}>
        <div />
        {ebenen.map((e) => (
          <div key={e} style={{ textAlign: "center", fontSize: "0.7rem", fontWeight: 700, color: "var(--text-dim)" }}>
            Ebene {e}
          </div>
        ))}
      </div>

      {/* Grid */}
      {faecher.map((fach) => (
        <div key={fach} style={{ display: "grid", gridTemplateColumns: `80px repeat(${ebenen.length}, minmax(88px, 1fr))`, gap: 4, marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: "0.7rem", fontWeight: 700, color: "var(--text-dim)" }}>
            Fach {fach}
          </div>
          {ebenen.map((ebene) => {
            const p = platzMap.get(`${ebene}-${fach}`);
            if (!p) return <div key={ebene} />;
            const belegt = !!p.modellId;
            const farbe  = belegt ? herstellerFarbe(p.hersteller) : { bg: "transparent", border: "var(--border)", textColor: "var(--text-dim)" };
            const kurzName = p.modell?.modell
              ? (p.modell.modell.length > 14 ? p.modell.modell.slice(0, 13) + "…" : p.modell.modell)
              : "";

            return (
              <button
                key={ebene}
                onClick={() => onKlick(p)}
                title={belegt ? `${p.code} — ${p.modell?.modell ?? ""}` : `${p.code} — leer`}
                aria-label={`Lagerplatz ${p.code}${belegt ? `, Modell: ${p.modell?.modell}` : ", leer"}`}
                style={{
                  minHeight:    62,
                  padding:      "0.4rem 0.3rem",
                  borderRadius: 8,
                  border:       `1px ${belegt ? "solid" : "dashed"} ${farbe.border}`,
                  background:   farbe.bg,
                  cursor:       "pointer",
                  fontFamily:   "'Ubuntu', sans-serif",
                  textAlign:    "center",
                  transition:   "transform 0.1s, box-shadow 0.1s",
                  display:      "flex",
                  flexDirection: "column",
                  alignItems:   "center",
                  justifyContent: "center",
                  gap:          2,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
              >
                <span style={{ fontSize: "0.65rem", fontFamily: "monospace", color: belegt ? farbe.textColor : "var(--text-dim)", fontWeight: 700, lineHeight: 1 }}>
                  {p.code.replace("ETL-", "")}
                </span>
                {kurzName && (
                  <span style={{ fontSize: "0.6rem", color: "var(--text)", lineHeight: 1.2, wordBreak: "break-word", width: "100%" }}>
                    {kurzName}
                  </span>
                )}
                {!belegt && (
                  <span style={{ fontSize: "0.6rem", color: "var(--text-dim)" }}>leer</span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      </div>{/* min-width container */}
      </div>{/* overflow-x-auto */}
    </div>
  );
}

// ── Haupt-Page ────────────────────────────────────────────────────────────────

export default function LagerplaetzePage() {
  const { show } = useToast();
  const { activeStandortId } = useStandortFilter();
  const { data: session } = useSession();
  const kuerzel = (session?.user as { kuerzel?: string })?.kuerzel ?? "ADMIN";

  // ── Legacy-Lagerplaetze State ──────────────────────────────────────────────
  const [suche,   setSuche]   = useState("");
  const [bereich, setBereich] = useState("");
  const [debouncedSuche]      = useDebounce(suche, 300);
  const [neuerCode, setNeuerCode] = useState("");
  const [verschiebeVon,  setVerschiebeVon]  = useState<string | null>(null);
  const [verschiebeNach, setVerschiebeNach] = useState("");
  const [neuLagerplatz,  setNeuLagerplatz]  = useState("");
  const [confirmOpen,    setConfirmOpen]    = useState(false);

  // ── ETL-Grid State ─────────────────────────────────────────────────────────
  const [etlFilter,      setEtlFilter]      = useState<string>("alle");
  const [etlSuche,       setEtlSuche]       = useState("");
  const [selectedPlatz,  setSelectedPlatz]  = useState<EtlPlatz | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data, isLoading, error, refetch } = api.lagerplaetze.getAll.useQuery(
    { bereich: bereich || undefined },
    { refetchOnMount: "always", staleTime: 0 },
  );
  const bereiche = api.lagerplaetze.getBereiche.useQuery();

  const etlQ = api.lagerplatz.uebersicht.useQuery(
    { standortId: activeStandortId },
    { staleTime: 30_000, refetchInterval: 30_000 },
  );

  // ── Mutations ──────────────────────────────────────────────────────────────
  const anlegen = api.lagerplaetze.create.useMutation({
    onSuccess: (lp) => { show(`✅ Lagerplatz ${lp.code} angelegt`, "success"); setNeuerCode(""); refetch(); },
    onError:   (e)  => show(e.message, "error"),
  });

  const verschiebeAlle = api.lagerplaetze.verschiebeAlle.useMutation({
    onSuccess: (r) => { show(`✅ ${r.verschoben} Artikel: ${r.von} → ${r.nach}`, "success"); setVerschiebeVon(null); setVerschiebeNach(""); setConfirmOpen(false); refetch(); },
    onError:   (e)  => show(e.message, "error"),
  });

  // ── ETL-Grid Filter ────────────────────────────────────────────────────────
  const allEtl  = (etlQ.data ?? []) as EtlPlatz[];
  const etlBelegt = allEtl.filter((p) => p.modellId).length;

  const etlPlaetze = allEtl.filter((p) => {
    if (etlFilter === "frei")   return !p.modellId;
    if (etlFilter === "belegt") return !!p.modellId;
    if (etlFilter === "Dell" || etlFilter === "HP" || etlFilter === "Lenovo" || etlFilter === "Fujitsu") {
      return p.hersteller === etlFilter;
    }
    return true;
  }).filter((p) => {
    if (!etlSuche) return true;
    const s = etlSuche.toUpperCase();
    return p.code.includes(s) || p.modell?.modell.toUpperCase().includes(s);
  });

  // Gruppiert nach Reihe
  const reihenMap = new Map<number, EtlPlatz[]>();
  for (const p of etlPlaetze) {
    if (!reihenMap.has(p.reihe)) reihenMap.set(p.reihe, []);
    reihenMap.get(p.reihe)!.push(p);
  }
  const reihen = [...reihenMap.keys()].sort((a, b) => a - b);

  const INPUT_CLS = "px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm";

  if (isLoading) return <PageLoader />;
  if (error) return (
    <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">
      Fehler: {error.message}
    </div>
  );

  const filtered  = (data ?? []).filter((l) =>
    !debouncedSuche || l.lagerplatz.toLowerCase().includes(debouncedSuche.toLowerCase()),
  );
  const alleCodes = (data ?? []).map((l) => l.lagerplatz);

  // ── Filter-Button-Helper ───────────────────────────────────────────────────
  const filterBtnStyle = (active: boolean, color?: string): React.CSSProperties => ({
    padding:      "0.4rem 0.9rem",
    borderRadius: 20,
    border:       `1px solid ${active ? (color ?? "var(--afb-navy)") : "var(--border)"}`,
    background:   active ? (color ?? "var(--afb-navy)") : "transparent",
    color:        active ? "#fff" : "var(--text-dim)",
    cursor:       "pointer",
    fontFamily:   "'Ubuntu', sans-serif",
    fontWeight:   700,
    fontSize:     "0.8rem",
    whiteSpace:   "nowrap" as const,
    transition:   "all 0.15s",
  });

  return (
    <div className="space-y-5">

      {/* ── ETL-Lager Rasteransicht ── */}
      <div>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: "1rem" }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--text)", margin: 0 }}>
              ETL-Sömmerda Lagerübersicht
            </h1>
            <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", margin: "0.2rem 0 0" }}>
              {etlBelegt} / {allEtl.length} Plätze belegt · {allEtl.length - etlBelegt} frei
            </p>
          </div>
          {etlQ.isFetching && (
            <div style={{ width: 20, height: 20, border: "2px solid var(--border)", borderTopColor: "var(--afb-navy)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          )}
        </div>

        {/* Filter + Suche */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
          {[
            { key: "alle",    label: "Alle" },
            { key: "frei",    label: "Frei",   color: undefined },
            { key: "belegt",  label: "Belegt", color: "var(--afb-green)" },
            { key: "Dell",    label: "Dell",   color: "#008BD2" },
            { key: "HP",      label: "HP",     color: "var(--afb-navy)" },
            { key: "Lenovo",  label: "Lenovo", color: "var(--afb-green)" },
            { key: "Fujitsu", label: "Fujitsu",color: "#7c3aed" },
          ].map(({ key, label, color }) => (
            <button key={key} style={filterBtnStyle(etlFilter === key, color)} onClick={() => setEtlFilter(key)}>
              {label}
            </button>
          ))}
          <input
            type="text"
            placeholder="ETL-Code oder Modell suchen…"
            value={etlSuche}
            onChange={(e) => setEtlSuche(e.target.value)}
            style={{ flex: 1, minWidth: 160, padding: "0.4rem 0.8rem", borderRadius: 20, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text)", fontFamily: "'Ubuntu', sans-serif", fontSize: "0.85rem", outline: "none" }}
          />
        </div>

        {/* Grid */}
        {etlQ.isLoading ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-dim)" }}>Lade Lagerplätze…</div>
        ) : reihen.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--text-dim)" }}>Keine Plätze gefunden.</div>
        ) : (
          <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.2rem", boxShadow: "0 4px 20px rgba(0,0,0,0.05)" }}>
            {reihen.map((reihe) => (
              <EtlReihe
                key={reihe}
                reihe={reihe}
                plaetze={reihenMap.get(reihe) ?? []}
                onKlick={setSelectedPlatz}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Legacy-Lagerplaetze (Artikel-Zuordnung) ── */}
      <div>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--text)", margin: "0.5rem 0 1rem" }}>
          Lagerplätze (Artikel-Zuordnung)
        </h2>

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{filtered.length} Lagerplätze</p>
        </div>

        {/* Neuer Lagerplatz */}
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm mb-4">
          <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-3">Neuer Lagerplatz</p>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-[180px]">
              <input
                type="text"
                placeholder="z.B. HP-1-1-3"
                value={neuerCode}
                onChange={(e) => setNeuerCode(e.target.value.toUpperCase().replace(/[^A-Z0-9\-]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter" && neuerCode) anlegen.mutate({ code: neuerCode }); }}
                className={`${INPUT_CLS} w-full font-mono tracking-wider`}
              />
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
                Format: BEREICH-REGAL-FACH-EBENE (HP, L=Lenovo, D=Dell, A=Acer)
              </p>
            </div>
            <button
              disabled={!neuerCode || anlegen.isPending}
              onClick={() => anlegen.mutate({ code: neuerCode })}
              className="px-5 py-2 bg-[#0064d2] text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm h-[38px]"
            >
              {anlegen.isPending ? "..." : "+ Anlegen"}
            </button>
          </div>
        </div>

        {/* Filter */}
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm flex gap-3 flex-wrap items-center mb-4">
          <div className="relative flex-1 min-w-[180px]">
            <input type="text" placeholder="Lagerplatz suchen..."
              value={suche} onChange={(e) => setSuche(e.target.value)}
              className={`${INPUT_CLS} w-full pr-7`}
            />
            {suche && (
              <button onClick={() => setSuche("")} aria-label="Suche leeren"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] font-bold text-sm">✕</button>
            )}
          </div>
          <select value={bereich} onChange={(e) => setBereich(e.target.value)} className={INPUT_CLS}>
            <option value="">Alle Bereiche</option>
            {bereiche.data?.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Tabelle */}
        <div className="overflow-x-auto bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                <th className="px-4 py-3 text-left">Lagerplatz</th>
                <th className="px-4 py-3 text-left">Bereich</th>
                <th className="px-4 py-3 text-center">Artikel</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.lagerplatz} className="border-b border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] text-sm">
                  <td className="px-4 py-3">
                    <span className="font-mono font-bold text-[#0064d2] dark:text-[#45bdff]">{l.lagerplatz}</span>
                    {l.artikelAnzahl === 0 && (
                      <span className="ml-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">leer</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-[#f0f2f5] dark:bg-[#3e4042] rounded text-xs">{l.bereich}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-black text-lg ${l.artikelAnzahl > 0 ? "text-[#00a400]" : "text-[#65676b] dark:text-[#b0b3b8]"}`}>
                      {l.artikelAnzahl}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.artikelAnzahl > 0 && (
                      <button
                        onClick={() => { setVerschiebeVon(l.lagerplatz); setVerschiebeNach(""); }}
                        className="px-3 py-1 text-xs font-bold rounded-lg bg-[#f7b928]/10 text-[#f7b928] border border-[#f7b928]/30 hover:bg-[#f7b928]/20"
                      >
                        📦 Alle verschieben
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={4} className="text-center py-12 text-[#65676b] dark:text-[#b0b3b8]">Keine Lagerplätze</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── ETL Detail-Modal ── */}
      {selectedPlatz && (
        <EtlDetailModal platz={selectedPlatz} onClose={() => setSelectedPlatz(null)} />
      )}

      {/* ── Legacy Verschieben-Modal ── */}
      <Modal open={!!verschiebeVon} onClose={() => setVerschiebeVon(null)} title="Alle Artikel verschieben">
        <div className="space-y-4">
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Alle Artikel von{" "}
            <span className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{verschiebeVon}</span>{" "}
            verschieben nach:
          </p>
          <select value={verschiebeNach} onChange={(e) => setVerschiebeNach(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]">
            <option value="">-- Vorhandenen Lagerplatz wählen --</option>
            {alleCodes.filter((c) => c !== verschiebeVon).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">
            <span className="flex-1 h-px bg-[#ced4da] dark:bg-[#3e4042]" />
            <span>oder neuen Lagerplatz eingeben</span>
            <span className="flex-1 h-px bg-[#ced4da] dark:bg-[#3e4042]" />
          </div>
          <input type="text" placeholder="Neuer Lagerplatz-Code z.B. HP-2-1-1"
            value={neuLagerplatz} onChange={(e) => { setNeuLagerplatz(e.target.value.toUpperCase()); setVerschiebeNach(e.target.value.toUpperCase()); }}
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] font-mono" />
          <div className="flex gap-3">
            <button onClick={() => setVerschiebeVon(null)}
              className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
              Abbrechen
            </button>
            <button disabled={!verschiebeNach} onClick={() => setConfirmOpen(true)}
              className="flex-1 py-2.5 rounded-xl bg-[#f7b928] text-black font-bold hover:bg-yellow-500 disabled:opacity-50">
              Weiter →
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          if (verschiebeVon && verschiebeNach) {
            verschiebeAlle.mutate({ alterLagerplatz: verschiebeVon, neuerLagerplatz: verschiebeNach, mitarbeiter: kuerzel });
          }
        }}
        title="Alle Artikel verschieben"
        message={
          <span>
            Alle Artikel von <strong className="font-mono">{verschiebeVon}</strong> nach{" "}
            <strong className="font-mono">{verschiebeNach}</strong> verschieben?
          </span>
        }
        confirmText="Verschieben"
        loading={verschiebeAlle.isPending}
      />
    </div>
  );
}
