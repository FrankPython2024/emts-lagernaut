"use client";

import Link from "next/link";
import MobilAnfragenListe from "./MobilAnfragenListe";

// Eigene Seite für die Mobil-Anfragen. Dieselbe Liste erscheint als Reiter „📱 Mobil"
// in /admin/anfragen (gemeinsame Komponente MobilAnfragenListe).
export default function MobilAnfragenAdminPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-4 flex items-center gap-3 flex-wrap">
        <Link href="/admin/mobil" className="text-sm font-semibold text-[#65676b] hover:text-[#008BD2] dark:text-[#b0b3b8]">← Mobil-Ersatzteile</Link>
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">🔔 Mobil-Anfragen</h1>
      </header>
      <MobilAnfragenListe />
    </div>
  );
}
