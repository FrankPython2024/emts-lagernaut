"use client";

import Link from "next/link";
import { LogoutButton } from "@/components/ui/LogoutButton";
import { PasswortAendernModal } from "@/components/pickup/PasswortAendernModal";

// Minimaler Picker-Rahmen für /pickup/* — KEINE Admin-Sidebar, kein
// Standort-Dropdown, keine Admin-Links. Der Picker sieht nur seinen Bereich.
//
// Logout: bewusst die geteilte LogoutButton-Komponente (signOut redirect:false
// + router.push). Der frühere Inline-signOut({ callbackUrl }) lief im Full-
// Redirect-Modus (Server-POST + harter Full-Reload) und blieb mobil hängen.
export default function PickupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb]">
      <header className="sticky top-0 z-20 bg-[#202F61] text-white shadow-md">
        {/* Bewusst schmal (40 px statt 64 px, Frank 23.09.2026): Auf dem Handgerät
            gehört die Höhe dem Scan-Bereich. Passwort/Abmelden braucht man
            selten — kleinere Knöpfe sind hier vertretbar. */}
        <div className="max-w-3xl mx-auto px-3 h-10 flex items-center justify-between gap-2">
          <Link href="/pickup" className="font-black tracking-wide text-sm flex items-center gap-1.5">
            <span aria-hidden>📦</span> Pickup
          </Link>
          <div className="flex items-center gap-1.5">
            <PasswortAendernModal kompakt />
            <LogoutButton
              className="inline-flex items-center px-3 rounded-md bg-white/10 hover:bg-white/20 text-xs font-bold transition-colors min-h-[32px]"
              title="Abmelden"
            >
              Abmelden
            </LogoutButton>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-2 py-2 sm:p-6">{children}</main>
    </div>
  );
}
