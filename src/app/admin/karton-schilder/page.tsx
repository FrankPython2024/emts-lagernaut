"use client";

import { useMemo, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { printKartonSchilder, schildAusName, type KartonSchild } from "@/lib/print/kartonSchild";
import { ERLAUBTE_HERSTELLER_LISTE } from "@/lib/geraete/herstellerFilter";
import { schildSchluessel } from "@/lib/geraete/schildName";

// ── Karton-Beschriftungen ────────────────────────────────────────────────────
//
// Schilder für die Ersatzteil-Kartons am Regal: 150 × 37 mm mit Schnittrahmen,
// Herstellerlogo links, Serie und Modell in der Mitte, AfB-Logo rechts.
//
// Zwei Wege hinein: ein Gerätemodell aus der Datenbank auswählen (dann wird der
// Name automatisch zerlegt) oder die drei Zeilen von Hand eintragen.

type Zeile = KartonSchild & { id: number };

let naechsteId = 1;

const eingabe =
  "w-full px-3 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] " +
  "bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none " +
  "focus:border-[#0064d2] min-h-[48px]";
const label = "block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1";

export default function KartonSchilderPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen = has("ARTIKEL_VIEW");
  const { show } = useToast();

  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [suche, setSuche]   = useState("");

  // Manuelle Eingabe
  const [hersteller, setHersteller] = useState<string>("");
  const [serie, setSerie]           = useState("");
  const [modell, setModell]         = useState("");
  const [zusatz, setZusatz]         = useState("");
  const [fach, setFach]             = useState("");

  // Modelle aus der Datenbank suchen
  const modelle = api.modell.suche.useQuery(
    { q: suche.trim() },
    { enabled: suche.trim().length >= 2 },
  );

  const kannDrucken = zeilen.length > 0;

  // Welche der aufgelisteten Schilder gibt es schon? Eine Abfrage für alle
  // Zeilen — je Zeile eine eigene wäre bei 30 Schildern spürbar.
  const bekannteQ = api.kartonSchild.pruefeViele.useQuery(
    { schilder: zeilen.map((z) => ({ hersteller: z.hersteller, serie: z.serie, modell: z.modell, zusatz: z.zusatz ?? "" })) },
    { enabled: zeilen.length > 0 },
  );
  const bekannt = useMemo(() => {
    const m = new Map<string, { zuletztAm: Date | string; anzahlDrucke: number; fach: string | null }>();
    for (const b of bekannteQ.data ?? []) m.set(b.schluessel, b);
    return m;
  }, [bekannteQ.data]);

  function schluesselVon(z: KartonSchild): string {
    return schildSchluessel({ hersteller: z.hersteller, serie: z.serie, modell: z.modell, zusatz: z.zusatz ?? "" });
  }

  const vermerken = api.kartonSchild.vermerkeDruck.useMutation({
    onSuccess: () => void bekannteQ.refetch(),
  });

  function drucken() {
    // Druckfenster zuerst — synchron zum Klick, sonst greift der Popup-Blocker.
    printKartonSchilder(zeilen);
    vermerken.mutate({
      schilder: zeilen.map((z) => ({
        hersteller: z.hersteller, serie: z.serie, modell: z.modell,
        zusatz: z.zusatz ?? "", fach: z.fach ?? null,
      })),
    });
  }

  const schonVorhanden = zeilen.filter((z) => bekannt.has(schluesselVon(z))).length;

  const vorschau = useMemo(
    () => schildAusName(`${hersteller} ${serie} ${modell}`.trim(), hersteller || null, fach.trim() || undefined),
    [hersteller, serie, modell, fach],
  );

  if (permsLoading) {
    return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>ARTIKEL_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  function ergaenze(s: KartonSchild) {
    setZeilen((z) => [...z, { ...s, id: naechsteId++ }]);
  }

  function ausManuell() {
    const m = modell.trim() || serie.trim();
    if (!m) { show("Bitte mindestens ein Modell eintragen.", "error"); return; }
    ergaenze({
      hersteller: hersteller || null,
      serie:      serie.trim(),
      modell:     modell.trim(),
      zusatz:     zusatz.trim() || undefined,
      fach:       fach.trim() || undefined,
    });
    setSerie(""); setModell(""); setZusatz("");
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🏷️ Karton-Beschriftungen</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Schilder für die Ersatzteil-Kartons: 150 × 37 mm mit Schnittrahmen,
          sieben Stück auf einen A4-Bogen.
        </p>
      </div>

      {/* ── Aus der Modell-Datenbank ────────────────────────────────────── */}
      <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5 space-y-3">
        <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Gerätemodell suchen</div>
        <input
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="z. B. EliteBook 840, ThinkPad T480…"
          className={eingabe}
        />
        {suche.trim().length >= 2 && (
          <div className="max-h-56 overflow-y-auto divide-y divide-[#ced4da] dark:divide-[#3e4042] rounded-lg border border-[#ced4da] dark:border-[#3e4042]">
            {modelle.isFetching && <div className="px-3 py-3 text-sm text-[#65676b] dark:text-[#b0b3b8]">Wird gesucht…</div>}
            {!modelle.isFetching && (modelle.data?.length ?? 0) === 0 && (
              <div className="px-3 py-3 text-sm text-[#65676b] dark:text-[#b0b3b8]">Nichts gefunden.</div>
            )}
            {modelle.data?.map((m) => {
              const s = schildAusName(`${m.hersteller} ${m.modell}`, m.hersteller);
              return (
                <button
                  key={m.id}
                  onClick={() => ergaenze(s)}
                  className="w-full text-left px-3 py-2.5 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]/40 flex items-center justify-between gap-3 min-h-[48px]"
                >
                  <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {m.hersteller} {m.modell}
                  </span>
                  <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] shrink-0">
                    {s.serie && <>{s.serie} · </>}<b>{s.modell}</b>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Von Hand ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5 space-y-3">
        <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Von Hand eintragen</div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <div>
            <span className={label}>Hersteller</span>
            <select value={hersteller} onChange={(e) => setHersteller(e.target.value)} className={eingabe}>
              <option value="">— ohne —</option>
              {ERLAUBTE_HERSTELLER_LISTE.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <span className={label}>Serie (kleine Zeile)</span>
            <input value={serie} onChange={(e) => setSerie(e.target.value)} placeholder="Precision" className={eingabe} />
          </div>
          <div>
            <span className={label}>Modell (große Zeile)</span>
            <input value={modell} onChange={(e) => setModell(e.target.value)} placeholder="5570" className={eingabe} />
          </div>
          <div>
            <span className={label}>Zusatz</span>
            <input value={zusatz} onChange={(e) => setZusatz(e.target.value)} placeholder="Detachable" className={eingabe} />
          </div>
          <div>
            <span className={label}>Fach / Nummer</span>
            <input value={fach} onChange={(e) => setFach(e.target.value)} placeholder="ETL-9-3-2" className={eingabe} />
          </div>
        </div>
        <button
          onClick={ausManuell}
          className="px-5 py-3 rounded-xl bg-[#0064d2] text-white font-bold text-base min-h-[56px]"
        >
          + Zur Liste hinzufügen
        </button>
        {(serie.trim() || modell.trim()) && (
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
            Wird gedruckt als: <b>{vorschau.hersteller ?? "ohne Hersteller"}</b> ·{" "}
            {vorschau.serie || "(keine Serie)"} · <b>{vorschau.modell || "(kein Modell)"}</b>
          </p>
        )}
      </div>

      {/* ── Liste + Drucken ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] overflow-hidden">
        <div className="px-5 py-3 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042] flex items-center justify-between gap-3 flex-wrap">
          <span className="font-black text-sm uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
            Zu drucken: {zeilen.length}
          </span>
          {zeilen.length > 0 && (
            <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] flex items-center gap-3 flex-wrap">
              {schonVorhanden > 0 && (
                <span className="font-bold text-[#8A5A00] dark:text-[#f7b928]">
                  ✓ {schonVorhanden} davon gibt es schon
                </span>
              )}
              <span>{Math.ceil(zeilen.length / 7)} A4-Bogen</span>
            </span>
          )}
        </div>

        {zeilen.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Noch nichts ausgewählt.
          </div>
        ) : (
          <ul className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
            {zeilen.map((z) => (
              <li key={z.id} className="px-5 py-3 flex items-center gap-4 flex-wrap">
                {/* Vorschau in den echten Proportionen (150:37), stark verkleinert */}
                <div className="flex items-center gap-3 border border-[#ced4da] dark:border-[#3e4042] rounded px-3 py-2 bg-white dark:bg-[#18191a]"
                     style={{ width: "300px", height: "74px" }}>
                  <span className="text-xs font-black text-[#65676b] dark:text-[#b0b3b8] w-14 shrink-0">
                    {z.hersteller ?? ""}
                  </span>
                  <span className="flex-1 text-center leading-tight min-w-0">
                    {z.serie && <span className="block text-[10px] font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{z.serie}</span>}
                    <span className="block text-base font-black text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{z.modell}</span>
                    {z.zusatz && <span className="block text-[10px] font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{z.zusatz}</span>}
                  </span>
                  <span className="text-[9px] font-black text-[#008BD2] w-8 shrink-0 text-right">AfB</span>
                </div>
                {z.fach && <span className="text-xs font-mono text-[#65676b] dark:text-[#b0b3b8]">{z.fach}</span>}
                {/* Hinweis, kein Verbot: Ein zweites Schild ist ein normaler
                    Vorgang, wenn das erste abgerissen ist. */}
                {(() => {
                  const b = bekannt.get(schluesselVon(z));
                  return b ? (
                    <span className="text-xs font-bold text-[#8A5A00] dark:text-[#f7b928] whitespace-nowrap"
                          title={`Zuletzt gedruckt am ${new Date(b.zuletztAm).toLocaleDateString("de-DE")}${b.fach ? ` · Fach ${b.fach}` : ""}`}>
                      ✓ schon gedruckt
                      {b.anzahlDrucke > 1 && <> ({b.anzahlDrucke}×)</>}
                    </span>
                  ) : null;
                })()}
                <button
                  onClick={() => setZeilen((l) => l.filter((x) => x.id !== z.id))}
                  className="ml-auto px-3 py-2 rounded-lg text-[#b3261e] hover:bg-[#b3261e]/10 font-bold text-sm min-h-[44px]"
                >
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="px-5 py-4 border-t border-[#ced4da] dark:border-[#3e4042] flex items-center gap-3 flex-wrap">
          <button
            onClick={drucken}
            disabled={!kannDrucken}
            className="px-6 py-3 rounded-xl bg-[#037A4F] text-white font-bold text-base min-h-[56px] disabled:opacity-50"
          >
            🖨️ {zeilen.length} Schild{zeilen.length === 1 ? "" : "er"} drucken
          </button>
          {zeilen.length > 0 && (
            <button
              onClick={() => setZeilen([])}
              className="px-5 py-3 rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-bold min-h-[56px]"
            >
              Liste leeren
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
