"use client";

// ── Fehleranzeige für Statistik-Panels ───────────────────────────────────────
//
// ⚠️ Bis 17.09.2026 prüfte KEIN Panel der Statistik, ob seine Abfrage gescheitert
// war. Die Kacheln zeigten dann `?? 0`, also eine echte „0", und „Gesamt
// ausgegeben" rechnete einen fehlenden Teilwert still als 0 € in die Summe.
// Eine gescheiterte Abfrage muss als Fehler erkennbar sein, nie als Zahl.

export function LadeFehler({ fehler, onRetry, kompakt = false }: {
  fehler:   { message: string } | null | undefined;
  onRetry:  () => void;
  kompakt?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`rounded-lg border border-[#c62828]/40 bg-[#fdecea] dark:bg-[#3a1d1d] text-[#8b1a1a] dark:text-[#ffb4ab] ${kompakt ? "p-3" : "p-4"}`}
    >
      <p className="font-bold text-sm">Konnte nicht geladen werden.</p>
      {fehler?.message && !kompakt && (
        <p className="text-xs mt-1 break-words">{fehler.message}</p>
      )}
      <button
        onClick={onRetry}
        className="mt-2 px-4 min-h-[44px] rounded-lg border border-current text-sm font-semibold hover:bg-white/40 dark:hover:bg-black/20"
      >
        Erneut versuchen
      </button>
    </div>
  );
}
