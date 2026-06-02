/**
 * Rotes Warn-Badge für überfällige Anfragen (> 1h offen).
 * Bewusst ASCII-konform ("> 1h") — kein Emoji nötig. `title` zeigt optional die
 * verstrichene Zeit (z.B. "vor 2h 15m") als Tooltip + im aria-label.
 */
export function UeberfaelligBadge({ title }: { title?: string }) {
  return (
    <span
      role="status"
      aria-label={title ? `Überfällig — ${title}` : "Überfällig — länger als 1 Stunde offen"}
      title={title ? `Überfällig · ${title}` : "Überfällig · länger als 1 Stunde offen"}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 whitespace-nowrap flex-shrink-0"
    >
      <span aria-hidden>⏱</span> &gt;1h
    </span>
  );
}
