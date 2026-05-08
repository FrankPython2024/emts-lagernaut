"use client";
import { useMemo } from "react";
import Link        from "next/link";
import { useSession } from "next-auth/react";
import { api }        from "@/trpc/react";
import { AnfrageStatus } from "@prisma/client";

type SessionUser = { name?: string; kuerzel?: string; rolle?: string };

const STATUS_COLOR: Record<string, string> = {
  NEU:           "#3b82f6",
  BEDARF:        "#8b5cf6",
  ABGESCHLOSSEN: "#22c55e",
  STORNIERT:     "#9ca3af",
};

const STATUS_LABEL: Record<string, string> = {
  NEU:           "Neu",
  BEDARF:        "Bedarf",
  ABGESCHLOSSEN: "Erledigt",
  STORNIERT:     "Storniert",
};

const cardStyle: React.CSSProperties = {
  background:   "var(--card-bg)",
  padding:      "1.5rem",
  borderRadius: "12px",
  border:       "1px solid var(--border)",
  boxShadow:    "0 4px 12px rgba(0,0,0,0.08)",
};

export default function TechnikerProfilPage() {
  const { data: session } = useSession();
  const user    = session?.user as SessionUser | undefined;
  const kuerzel = user?.kuerzel ?? "";

  const anfragenQuery = api.anfragen.getByTechniker.useQuery(
    { kuerzel, showAll: true, limit: 200 },
    { enabled: !!kuerzel },
  );

  const nachrichtenQuery = api.nachrichten.getInbox.useQuery(
    { kuerzel },
    { enabled: !!kuerzel },
  );

  const anfragen = anfragenQuery.data?.anfragen ?? [];

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const gesamt      = anfragen.length;
    const erledigt    = anfragen.filter((a) => a.status === AnfrageStatus.ABGESCHLOSSEN).length;
    const bedarf      = anfragen.filter((a) => a.status === AnfrageStatus.BEDARF).length;
    const neu         = anfragen.filter((a) => a.status === AnfrageStatus.NEU).length;
    const storniert   = anfragen.filter((a) => a.status === AnfrageStatus.STORNIERT).length;
    const erlRate     = gesamt > 0 ? Math.round((erledigt / gesamt) * 100) : 0;

    // Letzten 30 Tage
    const vor30 = new Date();
    vor30.setDate(vor30.getDate() - 30);
    const letzten30 = anfragen.filter((a) => new Date(a.datum) >= vor30).length;

    // Top Teile
    const teilMap: Record<string, number> = {};
    for (const a of anfragen) {
      teilMap[a.teil] = (teilMap[a.teil] ?? 0) + 1;
    }
    const topTeile = Object.entries(teilMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Status-Verteilung
    const statusMap: Record<string, number> = {};
    for (const a of anfragen) {
      statusMap[a.status] = (statusMap[a.status] ?? 0) + 1;
    }

    return { gesamt, erledigt, bedarf, neu, storniert, erlRate, letzten30, topTeile, statusMap };
  }, [anfragen]);

  const ungelesen   = nachrichtenQuery.data?.ungelesen ?? 0;

  if (!kuerzel) {
    return (
      <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-dim)" }}>
        Nicht angemeldet
      </div>
    );
  }

  const KPI = ({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) => (
    <div style={{
      ...cardStyle,
      textAlign: "center",
      borderTop: `3px solid ${color ?? "var(--primary)"}`,
    }}>
      <div style={{ fontSize: "2rem", fontWeight: 800, color: color ?? "var(--primary)" }}>{value}</div>
      <div style={{ fontWeight: 700, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <main style={{
      maxWidth: 900,
      margin:   "2rem auto",
      padding:  "0 1.2rem",
      display:  "flex",
      flexDirection: "column",
      gap:      "1.5rem",
    }}>
      {/* ── Back button ── */}
      <Link
        href="/techniker"
        style={{
          display:     "inline-flex",
          alignItems:  "center",
          gap:         6,
          color:       "var(--primary)",
          textDecoration: "none",
          fontWeight:  600,
          padding:     "0.5rem 0",
        }}
      >
        ← Zurück zum Portal
      </Link>

      {/* ── User info ── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <div style={{
            width:          80,
            height:         80,
            borderRadius:   "50%",
            background:     "var(--primary)",
            color:          "white",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            fontSize:       "2rem",
            fontWeight:     800,
            flexShrink:     0,
          }}>
            {kuerzel.slice(0, 2)}
          </div>
          <div>
            <h2 style={{ margin: "0 0 4px" }}>{user?.name ?? kuerzel}</h2>
            <div style={{ color: "var(--primary)", fontWeight: "bold", fontSize: "0.9rem" }}>
              Kürzel: {kuerzel}
            </div>
            <div style={{ color: "var(--text-dim)", fontSize: "0.85rem", marginTop: 4 }}>
              Techniker · AfB Sömmerda
            </div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            {ungelesen > 0 && (
              <Link
                href="/techniker/nachrichten"
                style={{
                  display:      "inline-flex",
                  alignItems:   "center",
                  gap:          6,
                  padding:      "0.4rem 1rem",
                  background:   "var(--danger)",
                  color:        "white",
                  borderRadius: 20,
                  fontWeight:   "bold",
                  textDecoration: "none",
                  fontSize:     "0.85rem",
                }}
              >
                🔔 {ungelesen} ungelesen
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── KPI Grid ── */}
      {anfragenQuery.isLoading ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>Lädt...</div>
      ) : (
        <>
          <div style={{
            display:             "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap:                 "1rem",
          }}>
            <KPI label="Gesamt"         value={stats.gesamt}      sub="alle Anfragen"        color="var(--primary)"  />
            <KPI label="Erledigt"        value={stats.erledigt}    sub={`${stats.erlRate}%`}  color="#22c55e"          />
            <KPI label="Bedarf"          value={stats.bedarf}      sub="kein Lager"           color="#8b5cf6"          />
            <KPI label="Letzte 30 Tage" value={stats.letzten30}   sub="Anfragen"             color="var(--warning)"  />
            <KPI label="Storniert"       value={stats.storniert}   sub="gesamt"               color="#9ca3af"          />
          </div>

          {/* ── Two-column section ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>

            {/* Top Teile */}
            <div style={cardStyle}>
              <h3 style={{ marginTop: 0, borderBottom: "1px solid var(--border)", paddingBottom: "0.8rem" }}>
                Häufigste Teile
              </h3>
              {stats.topTeile.length === 0 ? (
                <p style={{ color: "var(--text-dim)", textAlign: "center" }}>Keine Daten</p>
              ) : (
                stats.topTeile.map(([teil, count]) => {
                  const pct = stats.gesamt > 0 ? (count / stats.gesamt) * 100 : 0;
                  return (
                    <div key={teil} style={{ marginBottom: "0.8rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{teil}</span>
                        <span style={{ fontWeight: 800, color: "var(--primary)" }}>{count}×</span>
                      </div>
                      <div style={{ background: "var(--border)", borderRadius: 4, height: 6 }}>
                        <div style={{
                          width:        `${Math.min(pct, 100)}%`,
                          height:       "100%",
                          borderRadius: 4,
                          background:   "var(--primary)",
                          transition:   "width 0.5s ease",
                        }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Status-Verteilung */}
            <div style={cardStyle}>
              <h3 style={{ marginTop: 0, borderBottom: "1px solid var(--border)", paddingBottom: "0.8rem" }}>
                Status-Verteilung
              </h3>
              {stats.gesamt === 0 ? (
                <p style={{ color: "var(--text-dim)", textAlign: "center" }}>Keine Daten</p>
              ) : (
                Object.entries(stats.statusMap)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => {
                    const pct   = (count / stats.gesamt) * 100;
                    const color = STATUS_COLOR[status] ?? "#9ca3af";
                    const label = STATUS_LABEL[status]  ?? status;
                    return (
                      <div key={status} style={{ marginBottom: "0.8rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{
                              width: 10, height: 10, borderRadius: "50%",
                              background: color, display: "inline-block",
                            }} />
                            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{label}</span>
                          </div>
                          <span style={{ fontWeight: 800, color }}>
                            {count}× <span style={{ color: "var(--text-dim)", fontWeight: 400, fontSize: "0.8rem" }}>({Math.round(pct)}%)</span>
                          </span>
                        </div>
                        <div style={{ background: "var(--border)", borderRadius: 4, height: 6 }}>
                          <div style={{
                            width:        `${Math.min(pct, 100)}%`,
                            height:       "100%",
                            borderRadius: 4,
                            background:   color,
                            transition:   "width 0.5s ease",
                          }} />
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {/* ── Letzte Anfragen ── */}
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, borderBottom: "1px solid var(--border)", paddingBottom: "0.8rem" }}>
              Letzte Anfragen
            </h3>
            {anfragen.slice(0, 15).map((a) => {
              const cfg   = { color: STATUS_COLOR[a.status] ?? "#9ca3af", label: STATUS_LABEL[a.status] ?? a.status };
              const datum = new Date(a.datum);
              return (
                <div key={a.id} style={{
                  display:      "flex",
                  alignItems:   "center",
                  gap:          12,
                  padding:      "0.7rem 0",
                  borderBottom: "1px solid var(--border)",
                }}>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: "0.9rem" }}>{a.teil}</strong>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: 2 }}>
                      #{a.logId}
                      {a.geraeteName && ` — ${a.geraeteName}`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <span style={{
                      display:       "inline-block",
                      padding:       "0.2rem 0.6rem",
                      borderRadius:  10,
                      background:    cfg.color + "22",
                      color:         cfg.color,
                      fontWeight:    800,
                      fontSize:      "0.7rem",
                      textTransform: "uppercase",
                    }}>
                      {cfg.label}
                    </span>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 2 }}>
                      {datum.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
