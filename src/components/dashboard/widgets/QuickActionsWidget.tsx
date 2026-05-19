"use client";
import Link from "next/link";
import { WidgetCard } from "@/components/dashboard/WidgetCard";

const ACTIONS = [
  { label: "Teile einlagern", icon: "📦", href: "/admin/einlagern"   },
  { label: "Anfragen",        icon: "🔔", href: "/admin/anfragen"    },
  { label: "Neuer Artikel",   icon: "➕", href: "/admin/artikel/neu" },
  { label: "Statistiken",     icon: "📈", href: "/admin/statistiken" },
];

export function QuickActionsWidget() {
  return (
    <WidgetCard title="Schnellzugriff" icon="⚡" minHeight="120px">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ACTIONS.map(a => (
          <Link
            key={a.href}
            href={a.href}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-cyan-300 dark:hover:border-cyan-700 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/10 transition-all min-h-[80px] text-center group"
          >
            <span className="text-2xl">{a.icon}</span>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 group-hover:text-cyan-700 dark:group-hover:text-cyan-300 transition-colors leading-tight">
              {a.label}
            </span>
          </Link>
        ))}
      </div>
    </WidgetCard>
  );
}
