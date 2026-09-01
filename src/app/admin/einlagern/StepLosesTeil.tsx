"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { TeilenummerFeld, type TeilenummerTreffer } from "@/components/TeilenummerFeld";
import { GRADING_OPTIONS } from "@/modules/einlagern/constants";

// ── Weg B: nur das Teil, kein Gerät ──────────────────────────────────────────
//
// Für Teile aus einer Kiste, aus einer Lieferung oder aus einem Gerät, das es
// nicht mehr gibt. Statt der LogID ist die Teilenummer der Anker.
//
// Bewusst als eigener Bildschirm statt als Sonderfall im Geräte-Ablauf: Der
// Ablauf ist ein anderer, und drei Wenn-Dann-Zweige in einem Assistenten, der
// für einfache Bedienung gebaut wurde, wären der falsche Weg.
//
// ⚠️ Nach dem Buchen bleiben Teiltyp und Lagerplatz stehen. Wer eine Kiste
// sortiert, erfasst zwanzig Teile hintereinander und will nicht zwanzigmal
// dasselbe einstellen.

export function StepLosesTeil({
  standortId, teiltypen, onBack, initial,
}: {
  standortId: number;
  teiltypen:  { id: string; label: string }[];
  onBack:     () => void;
  /**
   * Vorbelegung aus der Foto-Erkennung. Nur Startwerte — alles bleibt
   * änderbar, denn bestätigt hat es noch niemand.
   */
  initial?: {
    teiltyp: string | null; hersteller: string | null; teilenummer: string | null;
    fotoBase64?: string | null; lagerplatz?: string | null;
  };
}) {
  const { show } = useToast();
  const utils = api.useUtils();

  const [nummer,      setNummer]      = useState(initial?.teilenummer ?? "");
  const [bezeichnung, setBezeichnung] = useState(
    initial?.hersteller && initial?.teiltyp
      ? `${initial.hersteller} ${teiltypen.find((t) => t.id === initial.teiltyp)?.label ?? initial.teiltyp}`
      : "",
  );
  const [teiltyp,     setTeiltyp]     = useState(initial?.teiltyp ?? "");
  const [menge,       setMenge]       = useState(1);
  const [grading,     setGrading]     = useState("");
  const [lagerplatz,  setLagerplatz]  = useState(initial?.lagerplatz ?? "");
  const [notiz,       setNotiz]       = useState("");
  const [erledigt,    setErledigt]    = useState<
    { text: string; modelle: string[]; hinweis: string | null }[]
  >([]);
  // Was die Erkennung von selbst ausgefüllt hat — wird angezeigt, damit
  // sichtbar bleibt, was das Programm getan hat und was der Mensch.
  const [uebernommen, setUebernommen] = useState<string | null>(null);

  /**
   * Aus einer erkannten Nummer das Formular füllen.
   *
   * ⚠️ Nur LEERE Felder werden gesetzt. Was jemand schon selbst eingetragen
   * hat, wird nie überschrieben — sonst springt einem das Formular unter den
   * Händen weg.
   */
  function ausTreffer(t: TeilenummerTreffer | null) {
    if (!t) { setUebernommen(null); return; }

    const gefuellt: string[] = [];

    if (!teiltyp && t.teiltyp) {
      // Der gespeicherte Teiltyp ist der Anzeigename; die Auswahl arbeitet mit
      // Kennungen. Deshalb über beides vergleichen.
      const passend = teiltypen.find(
        (x) => x.id === t.teiltyp || x.label.toLowerCase() === t.teiltyp!.toLowerCase(),
      );
      if (passend) { setTeiltyp(passend.id); gefuellt.push(passend.label); }
    }

    if (!bezeichnung && t.hersteller && t.teiltyp) {
      setBezeichnung(`${t.hersteller} ${t.teiltyp}`);
      gefuellt.push("Bezeichnung");
    }

    setUebernommen(gefuellt.length > 0 ? gefuellt.join(", ") : null);
  }

  const buchen = api.einlagern.erfasseLosesTeil.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.menge}× ${r.bezeichnung} · Bestand ${r.neuerBestand}`, "success");
      setErledigt((v) => [{
        text: `${r.menge}× ${r.bezeichnung}${r.neuAngelegt ? " (neu angelegt)" : ""} → Bestand ${r.neuerBestand}`,
        modelle: r.modelle,
        hinweis: r.hinweis,
      }, ...v].slice(0, 12));
      // Nur das Teil-Spezifische zurücksetzen; Teiltyp und Lagerplatz bleiben.
      setNummer(""); setBezeichnung(""); setMenge(1); setNotiz("");
      void utils.teilenummern.invalidate();
    },
    onError: (e) => show(e.message, "error"),
  });

  const kannBuchen =
    !!teiltyp && menge >= 1 &&
    (nummer.trim().length > 0 || bezeichnung.trim().length > 0) &&
    !buchen.isPending;

  const feld = "w-full px-3 py-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[56px]";

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="px-4 py-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] min-h-[56px] font-bold">
          ← Zurück
        </button>
        <div>
          <h2 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
            Teil ohne Gerät einlagern
          </h2>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Wenn keine LogID da ist und nur das Teil vorliegt.
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm space-y-5">

        {/* Nummer zuerst — sie ist hier das, was sonst die LogID ist. */}
        <TeilenummerFeld wert={nummer} onChange={setNummer} autoFocus onTreffer={ausTreffer} />

        {uebernommen && (
          <div className="rounded-lg border border-[#04B475]/40 bg-[#04B475]/8 px-3 py-2 text-sm text-[#038F5C] dark:text-[#04B475]">
            Aus der Nummer übernommen: {uebernommen}. Du kannst es unten ändern.
          </div>
        )}

        <div>
          <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
            Bezeichnung{" "}
            <span className="font-normal text-[#65676b] dark:text-[#b0b3b8]">
              {nummer.trim() ? "(optional)" : "(nötig, weil keine Nummer da ist)"}
            </span>
          </label>
          <input type="text" value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)}
            placeholder="z. B. Scharnier links, silbern" className={feld} />
        </div>

        <div>
          <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
            Was für ein Teil ist das? *
          </label>
          <select value={teiltyp} onChange={(e) => setTeiltyp(e.target.value)} className={feld}>
            <option value="">auswählen</option>
            {teiltypen.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Menge *</label>
            <div className="flex gap-2">
              <button onClick={() => setMenge((m) => Math.max(1, m - 1))}
                className="w-14 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-2xl font-bold min-h-[56px]"
                aria-label="Weniger">−</button>
              <input type="number" min={1} max={9999} value={menge}
                onChange={(e) => setMenge(Math.max(1, Math.min(9999, Number(e.target.value) || 1)))}
                className={`${feld} text-center text-lg font-bold`} />
              <button onClick={() => setMenge((m) => Math.min(9999, m + 1))}
                className="w-14 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-2xl font-bold min-h-[56px]"
                aria-label="Mehr">+</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Lagerplatz</label>
            <input type="text" value={lagerplatz} onChange={(e) => setLagerplatz(e.target.value)}
              placeholder="z. B. ETL-9-2-1" className={feld} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Zustand</label>
          <div className="flex gap-2 flex-wrap">
            {GRADING_OPTIONS.map((g) => (
              <button key={g.value} onClick={() => setGrading(grading === g.value ? "" : g.value)}
                className={`px-4 py-3 rounded-lg border-2 font-bold min-h-[56px] ${
                  grading === g.value
                    ? "border-[#0064d2] bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff]"
                    : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"
                }`}>
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Notiz</label>
          <input type="text" value={notiz} onChange={(e) => setNotiz(e.target.value)}
            placeholder="optional" className={feld} />
        </div>

        <button
          onClick={() => buchen.mutate({
            standortId,
            teilenummer: nummer.trim() || undefined,
            bezeichnung: bezeichnung.trim() || undefined,
            teiltyp,
            menge,
            grading:    grading || undefined,
            lagerplatz: lagerplatz.trim() || undefined,
            notiz:      notiz.trim() || undefined,
            // Nur mitschicken, solange die Nummer aus der Erkennung stammt.
            // Wer sie danach von Hand ändert, meint ein anderes Teil.
            fotoBase64: nummer === initial?.teilenummer ? initial?.fotoBase64 : undefined,
          })}
          disabled={!kannBuchen}
          className="w-full px-6 py-4 rounded-xl bg-[#202F61] text-white font-black text-lg disabled:opacity-40 min-h-[64px]"
        >
          {buchen.isPending ? "Wird gebucht…" : "Einlagern"}
        </button>

        {!teiltyp && (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Bitte oben auswählen, was für ein Teil das ist.
          </p>
        )}
      </div>

      {/* Was in dieser Sitzung schon gebucht wurde — beim Kistensortieren geht
          sonst schnell der Überblick verloren. */}
      {erledigt.length > 0 && (
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h3 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">
            Gerade eingelagert ({erledigt.length})
          </h3>
          <ul className="space-y-2">
            {erledigt.map((e, i) => (
              <li key={i} className="text-sm border-b border-[#f0f2f5] dark:border-[#3e4042] pb-2 last:border-0">
                <div className="text-[#1a1a1a] dark:text-[#e4e6eb]">✅ {e.text}</div>
                {e.modelle.length > 0 && (
                  <div className="text-xs text-[#038F5C] dark:text-[#04B475]">
                    passt in {e.modelle.length} Modell{e.modelle.length === 1 ? "" : "e"}: {e.modelle.slice(0, 3).join(", ")}
                    {e.modelle.length > 3 && ` und ${e.modelle.length - 3} weitere`}
                  </div>
                )}
                {e.hinweis && (
                  <div className="text-xs text-[#8A5A00] dark:text-[#f7b928]">⚠️ {e.hinweis}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
