import type { AnfrageStatus } from "@prisma/client";

const CONFIG: Record<AnfrageStatus, { label: string; cls: string }> = {
  NEU:              { label: "Neu",             cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  BEDARF:           { label: "Bedarf",          cls: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300" },
  IN_BEARBEITUNG:   { label: "In Bearbeitung",  cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  ABGESCHLOSSEN:    { label: "Abgeschlossen",   cls: "bg-[#04B475]/15 text-[#038F5C] dark:bg-[#04B475]/20 dark:text-[#1AC98D]" },
  STORNIERT:        { label: "Storniert",       cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  NICHT_VERFUEGBAR: { label: "Nicht verfügbar", cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
};

export function StatusBadge({ status }: { status: AnfrageStatus }) {
  const { label, cls } = CONFIG[status] ?? CONFIG.NEU;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}
