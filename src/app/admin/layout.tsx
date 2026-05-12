"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { LogoutButton } from "@/components/ui/LogoutButton";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS } from "@/modules/realtime/events";

const NAV = [
  { href: "/admin",           label: "Dashboard",   icon: "📊" },
  { href: "/admin/artikel",   label: "Artikel",     icon: "📦" },
  { href: "/admin/modelle",      label: "Modelle",      icon: "💻" },
  { href: "/admin/lagerplaetze", label: "Lagerplätze",  icon: "🗄️" },
  { href: "/admin/buchungen",    label: "Buchungen",    icon: "📋" },
  { href: "/admin/anfragen",     label: "Anfragen",     icon: "🔔" },
  { href: "/admin/statistiken", label: "Statistiken", icon: "📈" },
  { href: "/admin/benutzer",  label: "Benutzer",    icon: "👥" },
  { href: "/admin/geraete-lookup", label: "LogID Suche",   icon: "🔍" },
  { href: "/admin/geraete-import", label: "Geräte Import", icon: "📥" },
  { href: "/admin/system",              label: "System",        icon: "⚙️" },
  { href: "/admin/system/stresstest",   label: "Benchmark",     icon: "🔬" },
];

function Sidebar({ collapsed, onClose }: { collapsed: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("theme", d ? "dark" : "light");
  }

  const user = session?.user as { name?: string; kuerzel?: string; rolle?: string } | undefined;

  return (
    <aside className={`flex flex-col h-full bg-white dark:bg-[#242526] border-r border-[#ced4da] dark:border-[#3e4042]`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-[#ced4da] dark:border-[#3e4042]">
        <img
          src="https://www.afbshop.de/media/ca/1f/fe/1760428029/logo.svg"
          alt="AfB"
          className="h-7 dark:bg-white/90 dark:rounded dark:p-0.5"
        />
        <div>
          <div className="font-black text-sm text-[#1a1a1a] dark:text-[#e4e6eb] leading-none">Lagernaut</div>
          <div className="text-[10px] text-[#0064d2] dark:text-[#45bdff] font-bold uppercase tracking-wider">Admin</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="ml-auto text-[#65676b] text-xl">×</button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {NAV.map(({ href, label, icon }) => {
          const active = href === "/admin" ? pathname === href : (pathname ?? "").startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-sm font-semibold transition-all ${
                active
                  ? "bg-[#0064d2] text-white shadow-sm"
                  : "text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] hover:text-[#1a1a1a] dark:hover:text-[#e4e6eb]"
              }`}
            >
              <span className="text-base w-5 text-center">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-[#ced4da] dark:border-[#3e4042] space-y-1">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
        >
          <span>{dark ? "☀️" : "🌙"}</span>
          <span>{dark ? "Hell" : "Dunkel"}</span>
        </button>

        {user && (
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-[#0064d2] text-white text-xs font-black flex items-center justify-center flex-shrink-0">
              {user.kuerzel?.slice(0, 2) ?? "??"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{user.name}</div>
              <div className="text-[10px] text-[#65676b] dark:text-[#b0b3b8]">{user.rolle}</div>
            </div>
            <LogoutButton
              className="text-[#65676b] hover:text-[#fa3e3e] text-sm transition-colors"
              title="Abmelden"
            >
              🚪
            </LogoutButton>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Socket-Event-Handler für Admin-Layout ────────────────────────────────────

function SocketNotifications() {
  const { show } = useToast();
  const { on, off } = useSocket();

  useEffect(() => {
    on(EVENTS.TECHNIKER_ONLINE, (d: unknown) => {
      const { kuerzel } = d as { kuerzel: string };
      show(`👤 ${kuerzel} ist online`, "info");
    });
    on(EVENTS.TECHNIKER_OFFLINE, (d: unknown) => {
      const { kuerzel } = d as { kuerzel: string };
      show(`👤 ${kuerzel} ist offline`, "info");
    });
    on(EVENTS.ANFRAGE_NEU, (d: unknown) => {
      const a = d as { techniker: string; teil: string };
      show(`🔔 Neue Anfrage: ${a.teil} (${a.techniker})`, "info");
    });

    return () => {
      off(EVENTS.TECHNIKER_ONLINE);
      off(EVENTS.TECHNIKER_OFFLINE);
      off(EVENTS.ANFRAGE_NEU);
    };
  }, [on, off, show]);

  return null;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ToastProvider>
      <SocketNotifications />
      <div className="flex h-screen bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden">
        {/* Desktop Sidebar */}
        <div className="hidden lg:flex flex-col w-60 flex-shrink-0">
          <Sidebar collapsed={false} />
        </div>

        {/* Mobile Overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div className="w-60 flex-shrink-0 flex flex-col shadow-2xl">
              <Sidebar collapsed={false} onClose={() => setMobileOpen(false)} />
            </div>
            <div className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} />
          </div>
        )}

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile Topbar */}
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white dark:bg-[#242526] border-b border-[#ced4da] dark:border-[#3e4042] shadow-sm">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] text-[#65676b]"
            >
              ☰
            </button>
            <span className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Lagernaut Admin</span>
          </div>

          {/* Page Content */}
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
