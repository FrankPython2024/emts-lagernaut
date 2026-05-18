"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { LogoutButton } from "@/components/ui/LogoutButton";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS } from "@/modules/realtime/events";
import { FontSizeToggle } from "@/components/FontSizeToggle";
import { GlobalSearch } from "@/components/GlobalSearch";

const NAV = [
  { href: "/admin",            label: "Dashboard",      icon: "📊" },
  { href: "/admin/einlagern",  label: "Teile einlagern", icon: "📦" },
  { href: "/admin/artikel",    label: "Artikel",         icon: "🗃️" },
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

function Sidebar({ collapsed, onClose, onSearch }: { collapsed: boolean; onClose?: () => void; onSearch?: () => void }) {
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
    <aside className="flex flex-col h-full" style={{ background: "linear-gradient(180deg, #202F61 0%, #1A2550 100%)" }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <img
          src="https://www.afbshop.de/media/ca/1f/fe/1760428029/logo.svg"
          alt="AfB"
          className="h-7 bg-white/90 rounded p-0.5"
        />
        <div>
          <div className="font-black text-sm text-white leading-none">Lagernaut</div>
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#008BD2" }}>Admin</div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Menü schließen" className="ml-auto text-white/60 hover:text-white text-xl transition-colors w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/10">×</button>
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
              className={`flex items-center gap-3 px-3 py-3.5 rounded-xl mb-0.5 text-sm font-semibold transition-all min-h-[48px] ${
                active
                  ? "text-white shadow-sm"
                  : "text-white/65 hover:text-white hover:bg-white/10"
              }`}
              style={active ? { background: "rgba(0,139,210,0.35)", borderLeft: "3px solid #008BD2" } : undefined}
            >
              <span className="text-base w-5 text-center">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-white/10 space-y-1">
        {/* Globale Suche */}
        {onSearch && (
          <button
            onClick={onSearch}
            title="Globale Suche (Strg+K)"
            className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm text-white/65 hover:text-white hover:bg-white/10 transition-colors min-h-[44px]"
          >
            <span>🔍</span>
            <span className="flex-1 text-left">Suchen</span>
            <kbd className="text-[10px] text-white/30 bg-white/10 px-1.5 py-0.5 rounded font-mono">Strg+K</kbd>
          </button>
        )}

        {/* Schriftgröße */}
        <div className="flex items-center gap-2 px-3 py-1">
          <span className="text-xs text-white/40 font-semibold uppercase tracking-wide flex-1">Schrift</span>
          <FontSizeToggle />
        </div>

        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm text-white/65 hover:text-white hover:bg-white/10 transition-colors min-h-[44px]"
        >
          <span>{dark ? "☀️" : "🌙"}</span>
          <span>{dark ? "Hell" : "Dunkel"}</span>
        </button>

        {user && (
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full text-white text-xs font-black flex items-center justify-center flex-shrink-0" style={{ background: "#008BD2" }}>
              {user.kuerzel?.slice(0, 2) ?? "??"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white truncate">{user.name}</div>
              <div className="text-[10px] text-white/50">{user.rolle}</div>
            </div>
            <LogoutButton
              className="text-white/50 hover:text-[#fa3e3e] text-sm transition-colors"
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
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [searchOpen,  setSearchOpen]  = useState(false);

  // Globaler Ctrl+K / Cmd+K Shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(s => !s);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <ToastProvider>
      <SocketNotifications />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      <div className="flex h-screen bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden">
        {/* Desktop Sidebar */}
        <div className="hidden lg:flex flex-col w-60 flex-shrink-0">
          <Sidebar collapsed={false} onSearch={() => setSearchOpen(true)} />
        </div>

        {/* Mobile Overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div className="w-60 flex-shrink-0 flex flex-col shadow-2xl">
              <Sidebar collapsed={false} onClose={() => setMobileOpen(false)} onSearch={() => { setMobileOpen(false); setSearchOpen(true); }} />
            </div>
            <div className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} />
          </div>
        )}

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile Topbar */}
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 shadow-sm" style={{ background: "var(--afb-navy)" }}>
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Menü öffnen"
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              ☰
            </button>
            <span className="font-black text-white flex-1">Lagernaut Admin</span>
            {/* Mobile Suche */}
            <button
              onClick={() => setSearchOpen(true)}
              aria-label="Globale Suche öffnen"
              title="Globale Suche (Strg+K)"
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors text-lg"
            >
              🔍
            </button>
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
