"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { usePermissions } from "@/hooks/usePermissions";
import { homeFor } from "@/lib/auth/homeFor";

// Login-Auswahl/Weiterleitung. Wer Admin-Zugang UND ein Anfrage-Recht hat, bekommt
// die Auswahl (Verwaltung / Anfragen). Alle anderen werden direkt ins passende Ziel
// geleitet. Hält die Routing-Entscheidung an EINER Stelle (live-rechtebasiert).

const PRIMARY = "#202F61";
const GREEN   = "#04B475";
const ADMIN_ROLLEN = ["ADMIN", "ADMIN_READONLY", "BETRACHTER"];

export default function StartPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { has, isLoading } = usePermissions();

  const user  = session?.user as { rolle?: string; name?: string; kuerzel?: string } | undefined;
  const rolle = user?.rolle;
  const darfAdmin    = !!rolle && ADMIN_ROLLEN.includes(rolle);
  const darfAnfragen = has("ANFRAGE_CREATE") || has("ANFRAGE_MOBIL_CREATE");
  const zeigeAuswahl = darfAdmin && darfAnfragen;

  useEffect(() => {
    if (status === "loading" || isLoading) return;
    if (status === "unauthenticated") { router.replace("/login"); return; }
    if (zeigeAuswahl) return;                                  // Auswahl rendern
    if (darfAnfragen) { router.replace("/techniker"); return; }
    if (darfAdmin)    { router.replace("/admin"); return; }
    router.replace(homeFor(rolle));                            // Pickup etc.
  }, [status, isLoading, zeigeAuswahl, darfAnfragen, darfAdmin, rolle, router]);

  if (status === "loading" || isLoading || !zeigeAuswahl) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #65676b)", fontFamily: "'Ubuntu', sans-serif" }}>
        Einen Moment…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", fontFamily: "'Ubuntu', sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 760 }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <img src="/afb-logo-svg.svg" alt="AfB" style={{ height: 40, width: "auto", margin: "0 auto 1rem" }} />
          <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 800, color: "var(--text, #1a1a1a)" }}>
            Hallo{user?.name ? ` ${user.name}` : ""}!
          </h1>
          <p style={{ margin: "0.4rem 0 0", fontSize: "1.05rem", color: "var(--text-dim, #65676b)" }}>
            Wohin möchtest du?
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1.25rem" }}>
          <button type="button" onClick={() => router.push("/admin")}
            className="active:scale-[0.99] transition-transform"
            style={authCard(PRIMARY)}>
            <div style={{ fontSize: "2.5rem", lineHeight: 1 }}>🛠️</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 800, marginTop: "0.75rem" }}>Verwaltung</div>
            <div style={{ fontSize: "0.95rem", opacity: 0.85, marginTop: "0.35rem" }}>Admin-Bereich öffnen</div>
          </button>

          <button type="button" onClick={() => router.push("/techniker")}
            className="active:scale-[0.99] transition-transform"
            style={authCard(GREEN)}>
            <div style={{ fontSize: "2.5rem", lineHeight: 1 }}>📝</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 800, marginTop: "0.75rem" }}>Anfragen stellen</div>
            <div style={{ fontSize: "0.95rem", opacity: 0.85, marginTop: "0.35rem" }}>Ersatzteile (Notebook / Mobil)</div>
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <a href="/api/auth/signout" style={{ fontSize: "0.9rem", color: "var(--text-dim, #65676b)", textDecoration: "underline" }}>Abmelden</a>
        </div>
      </div>
    </div>
  );
}

function authCard(bg: string): React.CSSProperties {
  return {
    display: "block", width: "100%", textAlign: "center", cursor: "pointer",
    padding: "2rem 1.5rem", borderRadius: 20, border: "none", color: "white",
    background: `linear-gradient(135deg, ${bg} 0%, ${bg}cc 100%)`,
    boxShadow: "0 6px 20px rgba(0,0,0,0.15)", fontFamily: "'Ubuntu', sans-serif",
    minHeight: 160,
  };
}
