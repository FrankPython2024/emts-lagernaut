"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { LogoutButton } from "@/components/ui/LogoutButton";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS } from "@/modules/realtime/events";
import { FontSizeToggle } from "@/components/FontSizeToggle";
import { GlobalSearch } from "@/components/GlobalSearch";
import { StandortProvider } from "@/lib/standort/standortContext";
import { StandortSwitcher } from "@/components/StandortSwitcher";
import { usePermissions } from "@/hooks/usePermissions";
import { useNeueAnfragenZaehler } from "@/hooks/useNeueAnfragenZaehler";
import { MeinProfilModal } from "@/app/admin/_components/MeinProfilModal";
import { NotificationProvider } from "@/lib/notifications/notificationContext";
import { NotificationToggle } from "@/components/header/NotificationToggle";
import { TestModusToggle } from "@/components/TestModusToggle";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";

type NavItem = { href: string; label: string; icon: string; permission: string };
type NavSection = { title: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Übersicht",
    items: [
      { href: "/admin",        label: "Dashboard",  icon: "📊", permission: "DASHBOARD_VIEW" },
    ],
  },
  {
    title: "Betrieb",
    items: [
      { href: "/admin/anfragen",    label: "Anfragen",        icon: "🔔", permission: "ANFRAGE_VIEW_ALL" },
      { href: "/admin/einlagern",   label: "Teile einlagern", icon: "📦", permission: "ARTIKEL_EINLAGERN" },
      { href: "/admin/buchungen",   label: "Buchungen",       icon: "📋", permission: "BUCHUNG_VIEW" },
      { href: "/admin/colli-etiketten", label: "Label Tool", icon: "🏷️", permission: "COLLI_ETIKETTEN_VIEW" },
      { href: "/admin/pickup",          label: "Pickup",     icon: "🛻", permission: "PICKUP_MANAGE" },
      // Vorübergehend: Messseite für die Teile-Erkennung. Kann raus, sobald
      // entschieden ist, ob die Kameras der Handgeräte dafür taugen.
      { href: "/admin/kameratest",      label: "Kamera-Test", icon: "📷", permission: "ARTIKEL_EINLAGERN" },
    ],
  },
  {
    title: "Stammdaten",
    items: [
      { href: "/admin/artikel",      label: "Artikel",      icon: "🗃️", permission: "ARTIKEL_VIEW" },
      { href: "/admin/preise",       label: "Kategorie-Preise", icon: "💶", permission: "ARTIKEL_VIEW" },
      { href: "/admin/modelle",      label: "Modelle",      icon: "💻", permission: "MODELL_VIEW" },
      { href: "/admin/teiltypen",    label: "Teiltypen",    icon: "🧩", permission: "TEILTYP_EDIT" },
      { href: "/admin/teilenummern", label: "Teilenummern", icon: "🔢", permission: "ARTIKEL_VIEW" },
      { href: "/admin/lagerplaetze", label: "Lagerplätze",  icon: "🗄️", permission: "LAGERPLATZ_VIEW" },
      { href: "/admin/abgaben",      label: "Abgaben an Niederlassungen", icon: "🚚", permission: "ARTIKEL_VIEW" },
      { href: "/admin/bestellanfragen", label: "Bestellanfragen", icon: "🛒", permission: "BESTELLANFRAGE_VIEW" },
      { href: "/admin/verbrauchsmaterial", label: "Verbrauchsmaterial", icon: "📦", permission: "MATERIAL_VIEW" },
      { href: "/admin/mobil",        label: "Mobil-Ersatzteile", icon: "📱", permission: "MOBIL_VIEW" },
      { href: "/admin/mobil/statistik", label: "Mobil-Statistik", icon: "📊", permission: "MOBIL_VIEW" },
      { href: "/admin/mobil/import", label: "Mobil-Import",      icon: "📥", permission: "MOBIL_MANAGE" },
    ],
  },
  {
    title: "Analyse",
    items: [
      { href: "/admin/statistiken",      label: "Statistiken",         icon: "📈", permission: "STATISTIK_VIEW" },
      { href: "/admin/impact",           label: "Impact / Nachhaltigkeit", icon: "🌱", permission: "STATISTIK_VIEW" },
      { href: "/admin/ernte",            label: "Bauteil-Ernte", icon: "🔧", permission: "STATISTIK_VIEW" },
      { href: "/admin/sonderanfragen",   label: "Sonderanfragen bewerten", icon: "💬", permission: "ANFRAGE_VIEW_ALL" },
      { href: "/admin/bestellempfehlung", label: "Bestell-Empfehlungen", icon: "🛒", permission: "ANFRAGE_VIEW_ALL" },
      { href: "/admin/geraete-lookup", label: "LogID Suche",    icon: "🔍", permission: "ARTIKEL_VIEW" },
      { href: "/admin/gleiche-geraete", label: "Gleiches Gerät finden", icon: "🧭", permission: "GERAETE_REISE_VIEW" },
      { href: "/admin/geraete-import", label: "Geräte Import",  icon: "📥", permission: "MODELL_EDIT" },
      { href: "/admin/geraete-reise",  label: "Lagerfuchs",   icon: "🦊", permission: "GERAETE_REISE_VIEW" },
      { href: "/admin/import-sandbox", label: "Import-Sandbox", icon: "🧪", permission: "MODELL_VIEW" },
      { href: "/admin/import-ab-test", label: "Import A/B-Test", icon: "⚖️", permission: "SYSTEM_ADMIN" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/admin/benutzer",           label: "Benutzer",   icon: "👥", permission: "USER_VIEW" },
      { href: "/admin/rollen",             label: "Rollen",     icon: "🛡️", permission: "ROLLE_EDIT" },
      { href: "/admin/standorte",          label: "Standorte",  icon: "🏭", permission: "STANDORT_EDIT" },
      { href: "/admin/datenbank",          label: "Datenbank",  icon: "🛢️", permission: "SYSTEM_ADMIN" },
      { href: "/admin/system",             label: "System",     icon: "⚙️", permission: "SYSTEM_ADMIN" },
      { href: "/admin/system/stresstest",  label: "Benchmark",  icon: "🔬", permission: "STRESSTEST_RUN" },
    ],
  },
];

function Sidebar({ collapsed, onClose, onSearch, onProfile }: { collapsed: boolean; onClose?: () => void; onSearch?: () => void; onProfile?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { has, isLoading: permsLoading } = usePermissions();
  const neueAnfragen = useNeueAnfragenZaehler();
  const [dark, setDark] = useState(false);

  // Einstellungs-Block (Standort, Suche, Schrift, Theme, Hinweise, Test-Modus,
  // Profil/Logout) ist standardmäßig eingeklappt hinter „⚙️ Funktion".
  const [funktionOffen, setFunktionOffen] = useState(false);
  const funktionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  // Klick außerhalb / Escape schließt das Funktion-Panel.
  useEffect(() => {
    if (!funktionOffen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (funktionRef.current && !funktionRef.current.contains(e.target as Node)) setFunktionOffen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFunktionOffen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [funktionOffen]);

  function toggleTheme() {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("theme", d ? "dark" : "light");
  }

  const user = session?.user as { name?: string; kuerzel?: string; rolle?: string } | undefined;

  return (
    // Light: bg-white border-r border-gray-200
    // Dark:  bg-gray-900 border-r border-gray-800
    // Navy (#202F61) bleibt Akzent-Farbe, nicht Background
    <aside className="flex flex-col h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">

      {/* ── Logo-Bereich ─────────────────────────────────────────────────── */}
      <div className="relative px-4 py-5 border-b border-gray-100 dark:border-gray-800">
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Menü schließen"
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200 text-xl transition-colors w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ×
          </button>
        )}
        {/* Logo vertikal: Bild oben, Text darunter */}
        <div className="flex flex-col items-start gap-3">
          <img
            src="/afb-logo-svg.svg"
            alt="AfB"
            className="w-full max-w-[160px] h-auto"
          />
          <div>
            <div className="text-base font-bold text-gray-900 dark:text-white leading-tight">
              EMTS Lagernaut
            </div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500 font-medium mt-0.5">
              v2.0 · Sömmerda
            </div>
          </div>
        </div>
      </div>

      {/* Scroll-Bereich: < lg scrollt Navigation + „Funktion"-Block GEMEINSAM,
          damit nichts abgeschnitten wird. Ab lg löst lg:contents diesen Wrapper
          auf → Desktop-Sidebar bleibt unverändert (nav flex-1, Footer gepinnt). */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col lg:contents">
      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="px-3 py-3 lg:flex-1 lg:overflow-y-auto sidebar-scroll">
        {permsLoading ? (
          // Skelett, damit kein Flash von „kein Menü" entsteht
          <div className="px-3 py-2 space-y-2 animate-pulse">
            {Array.from({ length: 5 }).map((_, gi) => (
              <div key={gi} className="mb-4">
                <div className="h-3 w-24 bg-gray-200 dark:bg-gray-800 rounded mb-2" />
                <div className="space-y-1.5">
                  <div className="h-9 w-full bg-gray-100 dark:bg-gray-800/60 rounded" />
                  <div className="h-9 w-full bg-gray-100 dark:bg-gray-800/60 rounded" />
                  <div className="h-9 w-2/3 bg-gray-100 dark:bg-gray-800/60 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          NAV_SECTIONS.map((section) => {
            const sichtbare = section.items.filter(it => has(it.permission));
            if (sichtbare.length === 0) return null;
            return (
              <div key={section.title} className="mb-1">
                {/* Sektion-Header */}
                <div className="px-3 pt-6 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 select-none first:pt-2">
                  {section.title}
                </div>

                {/* Items */}
                {sichtbare.map(({ href, label, icon }) => {
                  const active = href === "/admin"
                    ? pathname === href
                    : (pathname ?? "").startsWith(href);
                  const badge = href === "/admin/anfragen" ? neueAnfragen : 0;
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm transition-all min-h-[44px] ${
                        active
                          ? "bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300 font-semibold"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white font-medium"
                      }`}
                      style={active ? { borderLeft: "3px solid #008BD2", paddingLeft: "0.625rem" } : undefined}
                    >
                      <span className={`text-base w-5 text-center flex-shrink-0 ${active ? "text-cyan-600 dark:text-cyan-400" : "text-gray-400 dark:text-gray-500"}`}>
                        {icon}
                      </span>
                      <span className="flex-1 min-w-0 truncate">{label}</span>
                      {badge > 0 && (
                        <span
                          aria-label={`${badge} neue ${badge === 1 ? "Anfrage" : "Anfragen"}`}
                          className="flex-shrink-0 text-white text-[11px] font-bold leading-none rounded-full px-2 py-1 min-w-[20px] text-center"
                          style={{ background: "#008BD2" }}
                        >
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })
        )}
      </nav>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      {/* Kompakt: wenig Außen-/Zwischen-Abstand, Bedienelemente bleiben aber bei
          min-h-[44px] gut antippbar (nur Weißraum reduziert, nicht die Controls). */}
      <div ref={funktionRef} className="mt-auto lg:mt-0 px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:pb-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">

        {/* Sammel-Button: klappt den Einstellungs-Block auf/zu (Standard: zu) */}
        <button
          onClick={() => setFunktionOffen((o) => !o)}
          aria-expanded={funktionOffen}
          aria-controls="funktion-panel"
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors min-h-[44px]"
        >
          <span className="w-5 text-center text-base" aria-hidden>⚙️</span>
          <span className="flex-1 text-left">Funktion</span>
          <span className="text-gray-400 dark:text-gray-500 text-xs" aria-hidden>{funktionOffen ? "▲" : "▼"}</span>
        </button>

        {funktionOffen && (
          <div id="funktion-panel" className="space-y-0.5 mt-1">

        {/* Standort-Switcher (nur Admin) */}
        <StandortSwitcher />

        {/* Globale Suche */}
        {onSearch && (
          <button
            onClick={onSearch}
            title="Globale Suche (Strg+K)"
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors min-h-[44px]"
          >
            <span className="text-gray-400 dark:text-gray-500 w-5 text-center text-base">🔍</span>
            <span className="flex-1 text-left">Suchen</span>
            <kbd className="text-[10px] text-gray-400 dark:text-gray-600 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono border border-gray-200 dark:border-gray-700">
              Strg+K
            </kbd>
          </button>
        )}

        {/* Schriftgröße */}
        <div className="flex items-center gap-2 px-3 py-0.5">
          <span className="text-[11px] text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wide flex-1">Schrift</span>
          <FontSizeToggle />
        </div>

        {/* Dark-Mode-Toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors min-h-[44px]"
        >
          <span className="w-5 text-center text-base">{dark ? "☀️" : "🌙"}</span>
          <span>{dark ? "Hellmodus" : "Dunkelmodus"}</span>
        </button>

        {/* Browser-Benachrichtigungen-Toggle */}
        <NotificationToggle />

        {/* Test-Modus-Toggle (nur ADMIN / ADMIN_READONLY) */}
        <TestModusToggle />

        {/* User-Card — Klick auf Avatar/Name öffnet Mein Profil */}
        {user && (
          <div className="flex items-center gap-1 px-1 py-1 rounded-lg bg-gray-100/60 dark:bg-gray-800/60 mt-1">
            <button
              onClick={onProfile}
              aria-label="Mein Profil öffnen"
              title="Mein Profil"
              className="flex-1 flex items-center gap-3 px-2 py-1 rounded-lg hover:bg-gray-200/60 dark:hover:bg-gray-700/60 transition-colors text-left min-w-0"
            >
              <div
                className="w-8 h-8 rounded-full text-white text-xs font-black flex items-center justify-center flex-shrink-0"
                style={{ background: "#008BD2" }}
              >
                {user.kuerzel?.slice(0, 2).toUpperCase() ?? "??"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-gray-900 dark:text-white truncate">{user.name}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400">{user.rolle}</div>
              </div>
            </button>
            <LogoutButton
              className="text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 text-sm transition-colors p-1 rounded min-w-[32px] min-h-[32px] flex items-center justify-center"
              title="Abmelden"
            >
              🚪
            </LogoutButton>
          </div>
        )}
          </div>
        )}
      </div>
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
    on(EVENTS.ANFRAGE_STORNIERT, (d: unknown) => {
      const a = d as { teil: string; techniker: string; warInBearbeitung?: boolean };
      show(
        `⚠️ ${a.techniker} hat „${a.teil}" storniert${a.warInBearbeitung ? " — war schon in Bearbeitung!" : ""} · bitte nicht mehr ausgeben`,
        "warning",
      );
    });
    on(EVENTS.PICKUP_ABGESCHLOSSEN, (d: unknown) => {
      const p = d as { name: string; gesamt: number; gefunden: number; nichtGefunden: number };
      if (p.nichtGefunden > 0) {
        show(`⚠️ Pickup „${p.name}" als NICHT komplett gemeldet — ${p.gefunden}/${p.gesamt}, ${p.nichtGefunden} fehlen`, "warning");
      } else {
        show(`✅ Pickup „${p.name}" vollständig abgeschlossen — ${p.gefunden}/${p.gesamt}`, "success");
      }
    });

    return () => {
      off(EVENTS.TECHNIKER_ONLINE);
      off(EVENTS.TECHNIKER_OFFLINE);
      off(EVENTS.ANFRAGE_NEU);
      off(EVENTS.ANFRAGE_STORNIERT);
      off(EVENTS.PICKUP_ABGESCHLOSSEN);
    };
  }, [on, off, show]);

  return null;
}

// ── Browser-Notifications (System-Toast + Ping) — einmal im Layout gemountet ──

function AdminNotifications() {
  useAdminNotifications();
  return null;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [profilOffen, setProfilOffen] = useState(false);
  const { has } = usePermissions();
  const sucheErlaubt = has("SUCHE_GLOBAL");

  const drawerRef    = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  // Globaler Ctrl+K / Cmd+K Shortcut — nur wenn User SUCHE_GLOBAL hat
  useEffect(() => {
    if (!sucheErlaubt) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(s => !s);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [sucheErlaubt]);

  // Mobile-Drawer als Modal: Body-Scroll sperren, Escape schließt, Fokus in den
  // Drawer beim Öffnen und zurück zum Hamburger beim Schließen.
  useEffect(() => {
    if (!mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      hamburgerRef.current?.focus();
    };
  }, [mobileOpen]);

  return (
    <ToastProvider>
      <StandortProvider>
      <NotificationProvider>
      <SocketNotifications />
      <AdminNotifications />
      {sucheErlaubt && <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />}
      {profilOffen && <MeinProfilModal onClose={() => setProfilOffen(false)} />}

      <div className="flex h-screen bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden">
        {/* Desktop Sidebar */}
        <div className="hidden lg:flex flex-col w-64 flex-shrink-0">
          <Sidebar
            collapsed={false}
            onSearch={sucheErlaubt ? () => setSearchOpen(true) : undefined}
            onProfile={() => setProfilOffen(true)}
          />
        </div>

        {/* Mobile Overlay — Drawer mit denselben rechtebasierten Menüpunkten */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div
              ref={drawerRef}
              id="mobile-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Navigationsmenü"
              tabIndex={-1}
              className="w-[min(18rem,85vw)] h-[100svh] flex-shrink-0 flex flex-col shadow-2xl outline-none"
            >
              <Sidebar
                collapsed={false}
                onClose={() => setMobileOpen(false)}
                onSearch={sucheErlaubt ? () => { setMobileOpen(false); setSearchOpen(true); } : undefined}
                onProfile={() => { setMobileOpen(false); setProfilOffen(true); }}
              />
            </div>
            <div className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} aria-hidden />
          </div>
        )}

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile Topbar */}
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
            <button
              ref={hamburgerRef}
              onClick={() => setMobileOpen(true)}
              aria-label="Menü öffnen"
              aria-expanded={mobileOpen}
              aria-controls="mobile-drawer"
              aria-haspopup="menu"
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              ☰
            </button>
            <div className="flex items-center gap-2 flex-1">
              <img
                src="/afb-logo-svg.svg"
                alt="AfB"
                className="h-6 w-auto flex-shrink-0"
              />
              <span className="font-black text-gray-900 dark:text-white text-sm">Lagernaut</span>
            </div>
            {/* Mobile Suche — nur wenn SUCHE_GLOBAL */}
            {sucheErlaubt && (
              <button
                onClick={() => setSearchOpen(true)}
                aria-label="Globale Suche öffnen"
                title="Globale Suche (Strg+K)"
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-lg"
              >
                🔍
              </button>
            )}
          </div>

          {/* Page Content — mobil volle Breite (schmaleres Padding), Desktop wie gehabt */}
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
      </NotificationProvider>
      </StandortProvider>
    </ToastProvider>
  );
}

export const dynamic = 'force-dynamic';
