"use client";
import { useState }    from "react";
import Link             from "next/link";
import { useSession }   from "next-auth/react";
import { api }          from "@/trpc/react";

type SessionUser = { name?: string; kuerzel?: string; rolle?: string };

const cardStyle: React.CSSProperties = {
  background:   "var(--card-bg)",
  padding:      "1.5rem",
  borderRadius: "12px",
  border:       "1px solid var(--border)",
  boxShadow:    "0 4px 12px rgba(0,0,0,0.08)",
};

const TYP_ICON: Record<string, string> = {
  SYSTEM:  "⚙️",
  INFO:    "ℹ️",
  WARNUNG: "⚠️",
  DRINGEND:"🚨",
};

const TYP_COLOR: Record<string, string> = {
  SYSTEM:   "var(--text-dim)",
  INFO:     "var(--primary)",
  WARNUNG:  "var(--warning)",
  DRINGEND: "var(--danger)",
};

export default function TechnikerNachrichtenPage() {
  const { data: session }       = useSession();
  const user                    = session?.user as SessionUser | undefined;
  const kuerzel                 = user?.kuerzel ?? "";
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const inboxQuery = api.nachrichten.getInbox.useQuery(
    { kuerzel },
    { enabled: !!kuerzel },
  );

  const markGelesenMutation = api.nachrichten.markGelesen.useMutation({
    onSuccess: () => inboxQuery.refetch(),
  });

  const alleMarkierenMutation = api.nachrichten.alleMarkierenGelesen.useMutation({
    onSuccess: () => inboxQuery.refetch(),
  });

  // getInbox returns { nachrichten: NachrichtEmpf[], ungelesen: number }
  // Each NachrichtEmpf has .gelesen, .nachricht (with .betreff, .inhalt, .antworten etc.)
  const records   = inboxQuery.data?.nachrichten ?? [];
  const ungelesen = inboxQuery.data?.ungelesen   ?? 0;

  function openRecord(id: number) {
    const empf = records.find((r) => r.nachrichtId === id || r.id === id);
    if (!empf) return;
    setSelectedId(empf.nachrichtId);
    if (!empf.gelesen) {
      markGelesenMutation.mutate({ nachrichtId: empf.nachrichtId, kuerzel });
    }
  }

  const selectedRecord = records.find((r) => r.nachrichtId === selectedId);
  const selectedNachricht = selectedRecord?.nachricht;

  return (
    <main style={{
      maxWidth: 900, margin: "2rem auto",
      padding: "0 1.2rem",
      display: "flex", flexDirection: "column", gap: "1.5rem",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link
          href="/techniker"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--primary)", textDecoration: "none", fontWeight: 600 }}
        >
          ← Zurück zum Portal
        </Link>
        {ungelesen > 0 && (
          <button
            onClick={() => alleMarkierenMutation.mutate({ kuerzel })}
            style={{
              background: "var(--bg)", border: "1px solid var(--border)",
              color: "var(--text-dim)", padding: "0.4rem 1rem",
              borderRadius: 8, cursor: "pointer",
              fontFamily: "'Ubuntu', sans-serif", fontWeight: 600,
            }}
          >
            Alle gelesen ({ungelesen})
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "1.5rem" }} className="nachrichten-grid">

        {/* ── List ── */}
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0, borderBottom: "1px solid var(--border)", paddingBottom: "0.8rem" }}>
            Posteingang
            {ungelesen > 0 && (
              <span style={{
                marginLeft: 6, background: "var(--danger)", color: "white",
                borderRadius: "50%", width: 20, height: 20,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.7rem", fontWeight: "bold",
              }}>
                {ungelesen}
              </span>
            )}
          </h3>

          {inboxQuery.isLoading && (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "2rem" }}>Laden...</div>
          )}
          {!inboxQuery.isLoading && records.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "2rem" }}>
              Keine Nachrichten
            </div>
          )}

          <div>
            {records.map((r) => {
              const n        = r.nachricht;
              const isActive = selectedId === r.nachrichtId;
              return (
                <button
                  key={r.id}
                  onClick={() => openRecord(r.id)}
                  style={{
                    display:      "flex",
                    gap:          10,
                    padding:      "0.8rem",
                    width:        "100%",
                    background:   isActive ? "var(--primary)" : "none",
                    color:        isActive ? "white" : "var(--text)",
                    border:       "none",
                    borderBottom: "1px solid var(--border)",
                    cursor:       "pointer",
                    textAlign:    "left",
                    fontFamily:   "'Ubuntu', sans-serif",
                    borderRadius: isActive ? 8 : 0,
                  }}
                >
                  <span style={{ fontSize: "1.2rem", flexShrink: 0, marginTop: 2 }}>
                    {TYP_ICON[n.typ] ?? "💬"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: r.gelesen ? 400 : 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {n.betreff}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: isActive ? "rgba(255,255,255,0.75)" : "var(--text-dim)", marginTop: 2 }}>
                      {n.vonKuerzel} · {new Date(n.createdAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  {!r.gelesen && !isActive && (
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)", flexShrink: 0, marginTop: 6 }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Detail ── */}
        <div style={cardStyle}>
          {!selectedNachricht ? (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "3rem 1rem" }}>
              <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📬</div>
              <p>Nachricht auswählen</p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: "1rem" }}>
                <span style={{ fontSize: "1.8rem" }}>{TYP_ICON[selectedNachricht.typ] ?? "💬"}</span>
                <div>
                  <h3 style={{ margin: 0, color: TYP_COLOR[selectedNachricht.typ] ?? "var(--text)" }}>
                    {selectedNachricht.betreff}
                  </h3>
                  <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--text-dim)" }}>
                    Von: <strong>{selectedNachricht.vonKuerzel}</strong> ·{" "}
                    {new Date(selectedNachricht.createdAt).toLocaleString("de-DE")}
                  </p>
                </div>
              </div>
              <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "1rem 0" }} />
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, padding: "0.5rem 0" }}>
                {selectedNachricht.inhalt}
              </div>

              {selectedNachricht.antworten && selectedNachricht.antworten.length > 0 && (
                <>
                  <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "1rem 0" }} />
                  <h4 style={{ margin: "0 0 0.8rem", color: "var(--text-dim)" }}>Antworten</h4>
                  {selectedNachricht.antworten.map((a: { id: number; vonKuerzel: string; inhalt: string; createdAt: Date }) => (
                    <div key={a.id} style={{ padding: "0.7rem 1rem", background: "var(--bg)", borderRadius: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginBottom: 4 }}>
                        {a.vonKuerzel} · {new Date(a.createdAt).toLocaleString("de-DE")}
                      </div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{a.inhalt}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 700px) { .nachrichten-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </main>
  );
}
