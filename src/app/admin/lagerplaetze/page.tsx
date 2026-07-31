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
import { usePermissions } from "@/hooks/usePermissions";
import { UmlagernModal } from "@/components/admin/UmlagernModal";

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

const MAX_MODELLE_PRO_FACH = 4;

type EtlBelegung = { modell: { id: number; modell: string; hersteller: string } };

type EtlPlatz = {
  id:         number;
  code:       string;
  regal:      number;
  reihe:      number;
  ebene:      number;
  fach:       number;
  hersteller: string | null;
  belegungen: EtlBelegung[];
};

function EtlDetailModal({ platz, onClose, onChanged }: { platz: EtlPlatz; onClose: () => void; onChanged: () => void }) {
  const { show } = useToast();
  const detailQ = api.lagerplatz.platzDetail.useQuery(
    { id: platz.id },
    { staleTime: 0 },
  );
  const d = detailQ.data;

  const loesen = api.lagerplatz.loesen.useMutation({
    onSuccess: () => {
      show("Modell aus Fach entfernt", "success");
      detailQ.refetch();
      onChanged();
    },
    onError: (e) => show(e.message, "error"),
  });

  const [umlagern, setUmlagern] = useState<{ modellId: number; modellName: string; hersteller: string } | null>(null);

  const belegungen = d?.belegungen ?? [];

  return (
    <Modal open onClose={onClose} title={platz.code}>
      <div style={{ minWidth: 300, maxWidth: 480 }}>
        {/* Klartext-Lage + Kapazität */}
        <div style={{ marginBottom: "1rem", padding: "0.6rem 0.8rem", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", fontSize: "0.85rem", color: "var(--text-dim)" }}>
          Reihe {platz.reihe} · Ebene {platz.ebene} · Fach {platz.fach}
          {platz.hersteller && (
            <span style={{ marginLeft: 8, fontWeight: 700, color: herstellerFarbe(platz.hersteller).textColor }}>
              {platz.hersteller}-Bereich
            </span>
          )}
          {d?.platz && (
            <span style={{ marginLeft: 8, fontWeight: 700, color: "var(--text)" }}>
              · {d.platz.belegt}/{MAX_MODELLE_PRO_FACH} belegt
            </span>
          )}
        </div>

        {detailQ.isLoading && (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
            <div style={{ width: 32, height: 32, border: "3px solid var(--border)", borderTopColor: "var(--afb-navy)", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 0.8rem" }} />
            Lade Details…
          </div>
        )}

        {d && belegungen.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: 8 }}>📭</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Dieser Platz ist leer</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
              Zuweisung erfolgt über den Einlager-Assistenten.
            </div>
          </div>
        )}

        {belegungen.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxHeight: 420, overflowY: "auto" }}>
            {belegungen.map((b) => (
              <div key={b.modellId} style={{ border: `2px solid ${herstellerFarbe(b.hersteller).border}`, borderRadius: 10, background: herstellerFarbe(b.hersteller).bg, padding: "0.8rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-dim)" }}>Modell</div>
                    <div style={{ fontWeight: 800, fontSize: "1rem", color: "var(--text)", wordBreak: "break-word" }}>{b.modellName}</div>
                    <div style={{ fontSize: "0.8rem", color: herstellerFarbe(b.hersteller).textColor, fontWeight: 600 }}>{b.hersteller}</div>
                  </div>
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    <button
                      onClick={() => setUmlagern({ modellId: b.modellId, modellName: b.modellName, hersteller: b.hersteller })}
                      aria-label={`Modell ${b.modellName} umlagern`}
                      style={{ minHeight: 36, padding: "0.3rem 0.7rem", borderRadius: 8, border: "1px solid #008BD2", background: "transparent", color: "#008BD2", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontWeight: 700, fontSize: "0.78rem" }}
                    >
                      Umlagern
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Modell „${b.modellName}" aus Fach ${platz.code} entfernen?`)) loesen.mutate({ modellId: b.modellId });
                      }}
                      disabled={loesen.isPending}
                      aria-label={`Modell ${b.modellName} aus Fach entfernen`}
                      style={{ minHeight: 36, padding: "0.3rem 0.7rem", borderRadius: 8, border: "1px solid var(--afb-red, #fa3e3e)", background: "transparent", color: "var(--afb-red, #fa3e3e)", cursor: "pointer", fontFamily: "'Ubuntu', sans-serif", fontWeight: 700, fontSize: "0.78rem" }}
                    >
                      Entfernen
                    </button>
                  </div>
                </div>

                {b.artikel.length === 0 ? (
                  <div style={{ fontSize: "0.82rem", color: "var(--text-dim)" }}>Keine Artikel gefunden.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {b.artikel.map((a) => (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.4rem 0.6rem", borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border)" }}>
                        <div style={{ flex: 1, minWidth: 0, fontSize: "0.82rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.kategorie}
                        </div>
                        {a.grading ? (
                          <span style={{ background: gradingFarbe(a.grading), color: "#fff", fontWeight: 800, fontSize: "0.72rem", padding: "0.12rem 0.45rem", borderRadius: 5, flexShrink: 0 }}>{a.grading}</span>
                        ) : (
                          <span style={{ background: "var(--border)", color: "var(--text-dim)", fontWeight: 700, fontSize: "0.72rem", padding: "0.12rem 0.45rem", borderRadius: 5, flexShrink: 0 }}>—</span>
                        )}
                        <span style={{ fontSize: "0.78rem", color: a.bestand > 0 ? "var(--afb-green)" : "var(--text-dim)", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>{a.bestand} Stk</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
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

      {/* Umlagern-Dialog (über dem Fach-Detail gestapelt) */}
      {umlagern && (
        <UmlagernModal
          modellId={umlagern.modellId}
          modellName={umlagern.modellName}
          hersteller={umlagern.hersteller}
          aktuellesFachCode={platz.code}
          onClose={() => setUmlagern(null)}
          onDone={() => { detailQ.refetch(); onChanged(); }}
        />
      )}
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
          Regal {regal} · {plaetze.filter((p) => p.belegungen.length > 0).length}/{plaetze.length} belegt
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
            const anzahl = p.belegungen.length;
            const belegt = anzahl > 0;
            // Fach-Hersteller = Region-Hinweis ODER Hersteller der Belegung
            const fachHerst = p.hersteller ?? p.belegungen[0]?.modell.hersteller ?? null;
            const farbe  = belegt ? herstellerFarbe(fachHerst) : { bg: "transparent", border: "var(--border)", textColor: "var(--text-dim)" };
            const erstesModell = p.belegungen[0]?.modell.modell ?? "";
            const kurzName = anzahl === 1
              ? (erstesModell.length > 14 ? erstesModell.slice(0, 13) + "…" : erstesModell)
              : anzahl > 1
              ? `${anzahl} Modelle`
              : "";
            const modellListe = p.belegungen.map((b) => b.modell.modell).join(", ");

            return (
              <button
                key={ebene}
                onClick={() => onKlick(p)}
                title={belegt ? `${p.code} — ${modellListe} (${anzahl}/${MAX_MODELLE_PRO_FACH})` : `${p.code} — leer`}
                aria-label={`Lagerplatz ${p.code}${belegt ? `, ${anzahl} von ${MAX_MODELLE_PRO_FACH} belegt: ${modellListe}` : ", leer"}`}
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
                {belegt && (
                  <span style={{ fontSize: "0.58rem", fontWeight: 800, color: farbe.textColor, lineHeight: 1 }}>
                    {anzahl}/{MAX_MODELLE_PRO_FACH}
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
  const { has } = usePermissions();
  const canEdit = has("LAGERPLATZ_EDIT"); // Schreib-UI nur mit Permission (Server erzwingt zusätzlich)
  const { activeStandortId } = useStandortFilter();
  const { data: session } = useSession();
  const kuerzel = (session?.user as { kuerzel?: string })?.kuerzel ?? "ADMIN";

  // ── Legacy-Lagerplaetze State ──────────────────────────────────────────────
  const [suche,   setSuche]   = useState("");
  const [bereich, setBereich] = useState("");
  const [debouncedSuche]      = useDebounce(suche, 300);
  const [neuerCode, setNeuerCode] = useState("");
  const [verschiebeVon,  setVerschiebeVon]  = useState<string | null>(null);
  // Bearbeiten-Dialog: hält den Ursprungs-Code fest, damit auch das Umbenennen
  // weiß, welcher Datensatz gemeint war.
  const [bearbeite, setBearbeite] = useState<{
    code: string; neuerCode: string; beschreibung: string; bereich: string; artikelAnzahl: number;
  } | null>(null);
  const [loesche, setLoesche] = useState<string | null>(null);
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

  const bearbeiten = api.lagerplaetze.update.useMutation({
    onSuccess: (r) => {
      show(
        r.umbenannt
          ? `✅ Umbenannt in ${r.code}${r.artikelVerschoben > 0 ? ` — ${r.artikelVerschoben} Artikel mitgezogen` : ""}`
          : `✅ ${r.code} gespeichert`,
        "success",
      );
      setBearbeite(null);
      refetch();
      void bereiche.refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const loeschen = api.lagerplaetze.loeschen.useMutation({
    onSuccess: (r) => { show(`✅ Lagerplatz ${r.code} gelöscht`, "success"); setLoesche(null); refetch(); },
    onError:   (e)  => { show(e.message, "error"); setLoesche(null); },
  });

  // ── ETL-Grid Filter ────────────────────────────────────────────────────────
  const allEtl  = (etlQ.data ?? []) as EtlPlatz[];
  const etlBelegt = allEtl.filter((p) => p.belegungen.length > 0).length;

  const etlPlaetze = allEtl.filter((p) => {
    if (etlFilter === "frei")   return p.belegungen.length === 0;
    if (etlFilter === "belegt") return p.belegungen.length > 0;
    if (etlFilter === "Dell" || etlFilter === "HP" || etlFilter === "Lenovo" || etlFilter === "Fujitsu") {
      // Region-Hinweis ODER Hersteller der Belegung
      const herst = p.hersteller ?? p.belegungen[0]?.modell.hersteller ?? null;
      return herst === etlFilter;
    }
    return true;
  }).filter((p) => {
    if (!etlSuche) return true;
    const s = etlSuche.toUpperCase();
    return p.code.includes(s) || p.belegungen.some((b) => b.modell.modell.toUpperCase().includes(s));
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
        {canEdit && (
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
        )}

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
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end flex-wrap">
                      {l.artikelAnzahl > 0 && (
                        <button
                          onClick={() => { setVerschiebeVon(l.lagerplatz); setVerschiebeNach(""); }}
                          className="px-3 py-1 text-xs font-bold rounded-lg bg-[#f7b928]/10 text-[#f7b928] border border-[#f7b928]/30 hover:bg-[#f7b928]/20"
                        >
                          📦 Alle verschieben
                        </button>
                      )}
                      <button
                        onClick={() => setBearbeite({
                          code: l.lagerplatz, neuerCode: l.lagerplatz,
                          beschreibung: l.beschreibung ?? "", bereich: l.bereich ?? "",
                          artikelAnzahl: l.artikelAnzahl,
                        })}
                        className="px-3 py-1 text-xs font-bold rounded-lg bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] border border-[#0064d2]/30 hover:bg-[#0064d2]/20"
                      >
                        ✏️ Bearbeiten
                      </button>
                      {/* Löschen nur anbieten, wenn der Platz leer ist — sonst
                          verlören die Artikel ihren Bezug. Server prüft das nochmal. */}
                      {l.artikelAnzahl === 0 && (
                        <button
                          onClick={() => setLoesche(l.lagerplatz)}
                          className="px-3 py-1 text-xs font-bold rounded-lg bg-[#fa3e3e]/10 text-[#fa3e3e] border border-[#fa3e3e]/30 hover:bg-[#fa3e3e]/20"
                        >
                          🗑️ Löschen
                        </button>
                      )}
                    </div>
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
        <EtlDetailModal platz={selectedPlatz} onClose={() => setSelectedPlatz(null)} onChanged={() => etlQ.refetch()} />
      )}

      {/* ── Bearbeiten-Modal ── */}
      <Modal open={!!bearbeite} onClose={() => setBearbeite(null)} title="Lagerplatz bearbeiten">
        {bearbeite && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1 text-[#1a1a1a] dark:text-[#e4e6eb]">Code</label>
              <input
                type="text" value={bearbeite.neuerCode}
                onChange={(e) => setBearbeite({ ...bearbeite, neuerCode: e.target.value.toUpperCase() })}
                className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] font-mono"
              />
              {bearbeite.neuerCode !== bearbeite.code && bearbeite.artikelAnzahl > 0 && (
                <p className="text-xs text-[#f7b928] mt-1.5">
                  ⚠️ {bearbeite.artikelAnzahl} Artikel stehen auf {bearbeite.code} — sie werden beim
                  Umbenennen automatisch auf {bearbeite.neuerCode || "…"} umgezogen.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1 text-[#1a1a1a] dark:text-[#e4e6eb]">Bereich</label>
              <input
                type="text" value={bearbeite.bereich} placeholder="z.B. Regal 1"
                onChange={(e) => setBearbeite({ ...bearbeite, bereich: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1 text-[#1a1a1a] dark:text-[#e4e6eb]">Beschreibung</label>
              <input
                type="text" value={bearbeite.beschreibung} placeholder="optional"
                onChange={(e) => setBearbeite({ ...bearbeite, beschreibung: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBearbeite(null)}
                className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
                Abbrechen
              </button>
              <button
                disabled={!bearbeite.neuerCode.trim() || bearbeiten.isPending}
                onClick={() => bearbeiten.mutate({
                  code:         bearbeite.code,
                  neuerCode:    bearbeite.neuerCode.trim(),
                  beschreibung: bearbeite.beschreibung.trim() || null,
                  bereich:      bearbeite.bereich.trim() || null,
                })}
                className="flex-1 py-2.5 rounded-xl bg-[#0064d2] text-white font-bold hover:bg-[#0057b8] disabled:opacity-50">
                {bearbeiten.isPending ? "Speichert…" : "Speichern"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Löschen-Bestätigung ── */}
      <Modal open={!!loesche} onClose={() => setLoesche(null)} title="Lagerplatz löschen">
        <div className="space-y-4">
          <p className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
            Lagerplatz <span className="font-mono font-bold">{loesche}</span> wirklich löschen?
          </p>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
            Der Platz ist leer — es gehen keine Artikel oder Buchungen verloren.
            Nur der Eintrag selbst verschwindet aus der Liste.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setLoesche(null)}
              className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
              Abbrechen
            </button>
            <button
              disabled={loeschen.isPending}
              onClick={() => loesche && loeschen.mutate({ code: loesche })}
              className="flex-1 py-2.5 rounded-xl bg-[#fa3e3e] text-white font-bold hover:bg-red-600 disabled:opacity-50">
              {loeschen.isPending ? "Löscht…" : "Ja, löschen"}
            </button>
          </div>
        </div>
      </Modal>

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
