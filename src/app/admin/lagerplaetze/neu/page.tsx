"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Lagerplätze werden als String-Feld in Artikeln verwaltet.
// Ein neuer Lagerplatz entsteht automatisch wenn ein Artikel
// diesen Lagerplatz-Code zugewiesen bekommt.
export default function LagerplatzNeuPage() {
  const router = useRouter();

  return (
    <div className="max-w-lg space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-[#65676b] hover:text-[#0064d2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Neuer Lagerplatz</h1>
      </div>

      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <div className="flex items-start gap-3 p-4 bg-[#0064d2]/10 border border-[#0064d2]/20 rounded-xl">
          <span className="text-2xl">ℹ️</span>
          <div>
            <p className="font-bold text-[#0064d2] dark:text-[#45bdff] text-sm">Lagerplätze sind automatisch</p>
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
              Ein Lagerplatz wird automatisch angelegt sobald du einem Artikel
              einen Lagerplatz-Code zuweist. Du musst Lagerplätze nicht vorab anlegen.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Empfohlenes Format:</p>
          <div className="font-mono text-sm bg-[#f0f2f5] dark:bg-[#18191a] rounded-lg p-4 space-y-1">
            <div><span className="text-[#0064d2] dark:text-[#45bdff]">HP-1-1-1</span> <span className="text-[#65676b] dark:text-[#b0b3b8]">→ HP, Regal 1, Fach 1, Ebene 1</span></div>
            <div><span className="text-[#0064d2] dark:text-[#45bdff]">L-2-3-1</span>  <span className="text-[#65676b] dark:text-[#b0b3b8]">→ Lenovo, Regal 2, Fach 3, Ebene 1</span></div>
            <div><span className="text-[#0064d2] dark:text-[#45bdff]">D-1-2-2</span>  <span className="text-[#65676b] dark:text-[#b0b3b8]">→ Dell, Regal 1, Fach 2, Ebene 2</span></div>
            <div><span className="text-[#0064d2] dark:text-[#45bdff]">A-3-1-1</span>  <span className="text-[#65676b] dark:text-[#b0b3b8]">→ Acer, Regal 3, Fach 1, Ebene 1</span></div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Link href="/admin/lagerplaetze"
            className="flex-1 py-2.5 text-center rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
            Zur Übersicht
          </Link>
          <Link href="/admin/artikel"
            className="flex-1 py-2.5 text-center rounded-xl bg-[#0064d2] text-white font-bold hover:bg-blue-700">
            Zu Artikeln → Lagerplatz setzen
          </Link>
        </div>
      </div>
    </div>
  );
}
