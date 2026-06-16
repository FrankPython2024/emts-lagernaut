"use client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";
import { useColliModal } from "./_colliModal";

// Geräte-Reise — geteilte Detail-Darstellung eines Geräts (Kopf + aktueller
// Stand + Reise-Timeline). Wird sowohl von der „Gerät verfolgen"-Seite als auch
// vom Detail-Popup genutzt. Reine Darstellung, kein Bestandseffekt.

type RouterOutputs = inferRouterOutputs<AppRouter>;
type GeraetGefunden = Extract<RouterOutputs["geraeteReise"]["geraet"], { kind: "found" }>;
export type StandData    = GeraetGefunden["stand"];
export type BewegungData = GeraetGefunden["bewegungen"];
export type FehlteilData = NonNullable<RouterOutputs["fehlteile"]["detail"]>;

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Spaltenname → verständlicher Klartext (für Bewegungen)
const FELD_LABEL: Record<string, string> = {
  verbleib:         "Verbleib",
  stellplatz:       "Stellplatz",
  colli:            "Colli",
  lager:            "Lager",
  grading:          "Grading",
  aktuellerZustand: "Aktueller Zustand",
  refurbished:      "Refurbished",
  blockiert:        "Blockiert",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-2 border-b border-[#f0f2f5] dark:border-[#3e4042] last:border-0">
      <span className="text-xs font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8] sm:w-44 flex-shrink-0">
        {label}
      </span>
      <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] break-words">{value}</span>
    </div>
  );
}

type TimelineItem = {
  datum:      Date;
  icon:       string;
  titel:      string;
  detail?:    string | null;
  bearbeiter?: string | null;
  rot?:       boolean;
};

export function GeraetDetailInhalt({ stand, bewegungen }: { stand: StandData; bewegungen: BewegungData }) {
  const { oeffneColli } = useColliModal();

  // Colli ist eine eigene, klickbare Zeile (öffnet das Colli-Popup) → daher hier
  // NICHT mehr in der Station-Zusammenfassung mitführen.
  const station = [
    stand.lager      && `${stand.lager}`,
    stand.filiale    && `Filiale ${stand.filiale}`,
    stand.stellplatz && `Platz ${stand.stellplatz}`,
  ].filter(Boolean).join(" · ");

  const verbleibText = stand.verbleib
    ? [
        stand.verbleib,
        stand.inVerbleibSeit  ? `seit ${fmtDate(stand.inVerbleibSeit)}` : null,
        stand.inVerbleibDurch ? `durch ${stand.inVerbleibDurch}`        : null,
      ].filter(Boolean).join(" · ")
    : null;

  const gradingText = stand.grading
    ? stand.initialesGrading && stand.initialesGrading !== stand.grading
      ? `${stand.grading} (initial ${stand.initialesGrading})`
      : stand.grading
    : null;

  const refurbishedText = stand.refurbished
    ? (stand.refurbishDatum ? `Ja · ${fmtDate(stand.refurbishDatum)}` : "Ja")
    : null;

  const items: TimelineItem[] = [];
  if (stand.aufLagerGebuchtAm) {
    items.push({ datum: new Date(stand.aufLagerGebuchtAm), icon: "📥", titel: "Auf Lager gebucht" });
  }
  if (stand.refurbishDatum) {
    items.push({ datum: new Date(stand.refurbishDatum), icon: "✨", titel: "Refurbished" });
  }
  if (stand.verbleib && stand.inVerbleibSeit) {
    items.push({
      datum:  new Date(stand.inVerbleibSeit),
      icon:   "📍",
      titel:  `In Verbleib: ${stand.verbleib}`,
      detail: stand.inVerbleibDurch ? `durch ${stand.inVerbleibDurch}` : null,
    });
  }
  if (stand.blockiert && stand.blockiertAm) {
    items.push({
      datum:  new Date(stand.blockiertAm),
      icon:   "🚫",
      titel:  "Blockiert",
      detail: [stand.blockiertVon && `von ${stand.blockiertVon}`, stand.begruendung].filter(Boolean).join(" · ") || null,
      rot:    true,
    });
  }
  for (const b of bewegungen) {
    items.push({
      datum:      new Date(b.zeitpunkt),
      icon:       "🔄",
      titel:      FELD_LABEL[b.feld] ?? b.feld,
      detail:     `${b.vonWert ?? "—"} → ${b.nachWert ?? "—"}`,
      bearbeiter: b.bearbeiter,
      rot:        b.feld === "blockiert" && (b.nachWert === "ja"),
    });
  }
  items.sort((a, b) => b.datum.getTime() - a.datum.getTime());

  return (
    <div className="space-y-6">
      {/* Kopf */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-2xl font-black font-mono text-[#0064d2] dark:text-[#45bdff]">{stand.logId}</div>
            <div className="text-lg font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mt-1">
              {[stand.hersteller, stand.bezeichnung].filter(Boolean).join(" ") || "—"}
            </div>
            {stand.geraeteart && (
              <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                {stand.geraeteart}{stand.unterart ? ` · ${stand.unterart}` : ""}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {stand.verbleib && (
              <span className="text-xs font-black px-3 py-1 rounded-full bg-[#e7f0fd] text-[#0064d2] dark:bg-[#11243d] dark:text-[#45bdff]">
                {stand.verbleib}
              </span>
            )}
            {stand.blockiert && (
              <span className="text-xs font-black px-3 py-1 rounded-full bg-[#ffe0e0] text-[#b3261e] dark:bg-[#3a1414] dark:text-[#ff8a8a]">
                🚫 Blockiert
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Aktueller Stand */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Aktueller Stand</h2>
        </div>
        <div className="px-5 py-2">
          <Row label="Station"           value={station || null} />
          <Row
            label="Colli"
            value={stand.colli ? (
              <button
                onClick={() => oeffneColli(stand.colli!)}
                title={`Alle Geräte im Colli ${stand.colli} anzeigen`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-mono font-bold bg-[#e7f0fd] text-[#0064d2] dark:bg-[#11243d] dark:text-[#45bdff] hover:opacity-90 transition-opacity"
              >
                <span aria-hidden>📦</span>{stand.colli}
              </button>
            ) : null}
          />
          <Row label="Verbleib"          value={verbleibText} />
          <Row label="Verweildauer"      value={stand.verweildauerTage != null ? `${stand.verweildauerTage} Tage` : null} />
          <Row label="Auf Lager seit"    value={fmtDate(stand.aufLagerGebuchtAm) || null} />
          <Row label="Grading"           value={gradingText} />
          <Row label="Aktueller Zustand" value={stand.aktuellerZustand} />
          <Row label="Refurbished"       value={refurbishedText} />
          <Row label="Letzte Änderung"   value={fmtDateTime(stand.letzteAenderungAm) || null} />
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Reise</h2>
        </div>
        <div className="p-5">
          {bewegungen.length === 0 && (
            <div className="mb-5 text-sm text-[#65676b] dark:text-[#b0b3b8] bg-[#f0f2f5] dark:bg-[#18191a] rounded-lg px-4 py-3 flex items-start gap-2">
              <span>ℹ️</span>
              <span>Noch keine Bewegungen erfasst – ab dem nächsten Import.</span>
            </div>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-4">Keine Zeitpunkte hinterlegt.</p>
          ) : (
            <ol className="relative border-l-2 border-[#ced4da] dark:border-[#3e4042] ml-3 space-y-5">
              {items.map((it, i) => (
                <li key={i} className="ml-6">
                  <span
                    className={`absolute -left-[13px] flex items-center justify-center w-6 h-6 rounded-full text-xs ${
                      it.rot ? "bg-[#ffe0e0] dark:bg-[#3a1414]" : "bg-[#e7f0fd] dark:bg-[#11243d]"
                    }`}
                    aria-hidden
                  >
                    {it.icon}
                  </span>
                  <div className={`font-bold ${it.rot ? "text-[#b3261e] dark:text-[#ff8a8a]" : "text-[#1a1a1a] dark:text-[#e4e6eb]"}`}>
                    {it.titel}
                  </div>
                  {it.detail && (
                    <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5 break-words">{it.detail}</div>
                  )}
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
                    {fmtDateTime(it.datum)}
                    {it.bearbeiter ? ` · ${it.bearbeiter}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Fehlteil-Karte (gleicher Stil wie „Aktueller Stand") ────────────────────────
// Für LogIDs, die als Fehlteil verbucht sind (FehlteilStand). Liegt oft NICHT in
// LogIdStand → wird im Popup eigenständig (auch ohne Geräte-Reise) angezeigt.
export function FehlteilKarte({ fehlteil: f }: { fehlteil: FehlteilData }) {
  const geraeteart = [f.geraeteart, f.unterart].filter(Boolean).join(" · ") || null;
  return (
    <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-[#ced4da] dark:border-[#3e4042] flex items-center gap-2">
        <span aria-hidden>🧩</span>
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Fehlteil</h2>
      </div>
      <div className="px-5 py-2">
        <Row label="LogID"            value={<span className="font-mono font-bold text-[#0064d2] dark:text-[#45bdff]">{f.logId}</span>} />
        <Row label="Hersteller"       value={f.hersteller} />
        <Row label="Bezeichnung"      value={f.bezeichnung} />
        <Row label="Geräteart"        value={geraeteart} />
        <Row label="Aktueller Zustand" value={f.aktuellerZustand} />
        <Row label="Grading"          value={f.grading} />
        <Row label="Sortiment"        value={f.sortiment} />
        <Row label="AAN"              value={f.aan} />
        <Row label="als Fehlteil verbucht seit" value={fmtDate(f.inVerbleibSeit) || null} />
        <Row label="durch"            value={f.inVerbleibDurch} />
        <Row label="Lager"            value={f.lager} />
      </div>
    </div>
  );
}
