"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Geteilte Tab-Leiste der Geräte-Reise (Übersicht / Importe / Gerät verfolgen).
const TABS = [
  { href: "/admin/geraete-reise/dashboard",     label: "Übersicht" },
  { href: "/admin/geraete-reise/auswertungen",  label: "Auswertungen" },
  { href: "/admin/geraete-reise/standort",      label: "Stellplatz Analyse" },
  { href: "/admin/geraete-reise/ausgeschieden", label: "Ausgeschieden" },
  { href: "/admin/geraete-reise",               label: "Importe" },
  { href: "/admin/geraete-reise/geraet",        label: "Gerät verfolgen" },
];

export function GeraeteReiseTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-[#ced4da] dark:border-[#3e4042] overflow-x-auto">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${
              active
                ? "text-[#0064d2] dark:text-[#45bdff] border-[#0064d2] dark:border-[#45bdff]"
                : "text-[#65676b] dark:text-[#b0b3b8] border-transparent hover:text-[#0064d2] dark:hover:text-[#45bdff]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
