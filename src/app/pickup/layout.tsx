"use client";

import Link from "next/link";
import { LogoutButton } from "@/components/ui/LogoutButton";

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
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <Link href="/pickup" className="font-black tracking-wide text-lg flex items-center gap-2">
            <span aria-hidden>📦</span> Pickup
          </Link>
          <LogoutButton
            className="inline-flex items-center px-4 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold transition-colors min-h-[44px]"
            title="Abmelden"
          >
            Abmelden
          </LogoutButton>
        </div>
      </header>
      <main className="max-w-3xl mx-auto p-4 sm:p-6">{children}</main>
    </div>
  );
}
