"use client";
import { useState } from "react";
import Link          from "next/link";
import { useSession } from "next-auth/react";
import { api }        from "@/trpc/react";
import { useToast }   from "@/components/ui/Toast";

type SessionUser = { name?: string; kuerzel?: string; rolle?: string };

const CARD: React.CSSProperties = {
  background:   "var(--card-bg)",
  padding:      "1.5rem",
  borderRadius: "12px",
  border:       "1px solid var(--border)",
  boxShadow:    "0 4px 12px rgba(0,0,0,0.08)",
};

const TYP_ICON: Record<string, string>  = { SYSTEM: "⚙️", INFO: "ℹ️", WARNUNG: "⚠️", DRINGEND: "🚨", DIREKT: "💬" };
const TYP_COLOR: Record<string, string> = { SYSTEM: "var(--text-dim)", INFO: "var(--primary)", WARNUNG: "var(--warning)", DRINGEND: "var(--danger)", DIREKT: "var(--primary)" };

const QUICK_REPLIES = [
  "✅ Verstanden",
  "🏃 Hole es gleich ab",
  "📅 Kommt morgen",
  "❓ Habe eine Frage",
];

export default function TechnikerNachrichtenPage() {
  const { data: session } = useSession();
  const user              = session?.user as SessionUser | undefined;
  const kuerzel           = user?.kuerzel ?? "";
  const { show }          = useToast();

  const [selectedId,  setSelectedId]  = useState<number | null>(null);
  const [antwortext,  setAntwortext]  = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────
  const inboxQuery = api.nachrichten.getInbox.useQuery(
    { kuerzel },
    { enabled: !!kuerzel, refetchInterval: 10_000 },
  );

  const records   = inboxQuery.data?.nachrichten ?? [];
  const ungelesen = inboxQuery.data?.ungelesen   ?? 0;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const markGelesenMutation = api.nachrichten.markGelesen.useMutation({
    onSuccess: () => inboxQuery.refetch(),
  });

  const alleMarkierenMutation = api.nachrichten.alleMarkierenGelesen.useMutation({
    onSuccess: () => inboxQuery.refetch(),
  });

  const antwortenMutation = api.nachrichten.antworten.useMutation({
    onSuccess: () => {
      show("✅ Antwort gesendet", "success");
      setAntwortext("");
      inboxQuery.refetch();
    },
    onError: (e) => show(`Fehler: ${e.message}`, "error"),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function openRecord(empfId: number) {
    const empf = records.find((r) => r.id === empfId);
    if (!empf) return;
    setSelectedId(empf.nachrichtId);
    setAntwortext("");
    if (!empf.gelesen) {
      markGelesenMutation.mutate({ nachrichtId: empf.nachrichtId, kuerzel });
    }
  }

  function handleAntworten() {
    if (!antwortext.trim() || !selectedId) return;
    antwortenMutation.mutate({ nachrichtId: selectedId, inhalt: antwortext.trim() });
  }

  const selectedRecord    = records.find((r) => r.nachrichtId === selectedId);
  const selectedNachricht = selectedRecord?.nachricht;

  const btnIcon: React.CSSProperties = {
    background:   "var(--bg)",
    border:       "1px solid var(--border)",
    color:        "var(--text)",
    padding:      "0.4rem 0.8rem",
    borderRadius: 8,
    cursor:       "pointer",
    fontFamily:   "'Ubuntu', sans-serif",
    fontWeight:   600,
    fontSize:     "0.85rem",
    transition:   "all 0.15s",
  };

  return (
    <main style={{ maxWidth: 980, margin: "2rem auto", padding: "0 1.2rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <Link
          href="/techniker"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--primary)", textDecoration: "none", fontWeight: 600 }}
        >
          ← Zurück zum Portal
        </Link>
        {ungelesen > 0 && (
          <button
            onClick={() => alleMarkierenMutation.mutate({ kuerzel })}
            disabled={alleMarkierenMutation.isPending}
            style={btnIcon}
          >
            {alleMarkierenMutation.isPending ? "…" : `Alle gelesen (${ungelesen})`}
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "1.5rem" }} className="nachrichten-grid">

        {/* ── Liste ── */}
        <div style={CARD}>
          <h3 style={{ marginTop: 0, borderBottom: "1px solid var(--border)", paddingBottom: "0.8rem", display: "flex", alignItems: "center", gap: 8 }}>
            Posteingang
            {ungelesen > 0 && (
              <span style={{
                background: "var(--danger)", color: "white",
                borderRadius: "50%", width: 20, height: 20,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.7rem", fontWeight: "bold",
              }}>
                {ungelesen > 9 ? "9+" : ungelesen}
              </span>
            )}
          </h3>

          {inboxQuery.isLoading && (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "2rem" }}>Laden...</div>
          )}
          {inboxQuery.isError && (
            <div style={{ textAlign: "center", color: "var(--danger)", padding: "1rem", fontSize: "0.85rem" }}>
              Fehler beim Laden
            </div>
          )}
          {!inboxQuery.isLoading && records.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "2rem" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>📭</div>
              Keine Nachrichten
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column" }}>
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
                    padding:      "0.75rem 0.8rem",
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
                    <div style={{ fontSize: "0.72rem", color: isActive ? "rgba(255,255,255,0.75)" : "var(--text-dim)", marginTop: 2 }}>
                      {n.vonKuerzel} · {new Date(n.createdAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                      {" "}{new Date(n.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    {(n.antworten?.length ?? 0) > 0 && !isActive && (
                      <div style={{ fontSize: "0.68rem", color: isActive ? "rgba(255,255,255,0.6)" : "var(--text-dim)", marginTop: 1 }}>
                        💬 {n.antworten?.length} Antwort{(n.antworten?.length ?? 0) > 1 ? "en" : ""}
                      </div>
                    )}
                  </div>
                  {!r.gelesen && !isActive && (
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)", flexShrink: 0, marginTop: 8 }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Detail + Antwort ── */}
        <div style={{ ...CARD, display: "flex", flexDirection: "column", gap: 0 }}>
          {!selectedNachricht ? (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "3rem 1rem", margin: "auto" }}>
              <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📬</div>
              <p>Nachricht auswählen</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: "1rem" }}>
                <span style={{ fontSize: "1.8rem", flexShrink: 0 }}>{TYP_ICON[selectedNachricht.typ] ?? "💬"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: 0, color: TYP_COLOR[selectedNachricht.typ] ?? "var(--text)", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {selectedNachricht.betreff}
                  </h3>
                  <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "var(--text-dim)" }}>
                    Von: <strong>{selectedNachricht.vonKuerzel}</strong> ·{" "}
                    {new Date(selectedNachricht.createdAt).toLocaleString("de-DE")}
                  </p>
                </div>
              </div>

              <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "0 0 1rem" }} />

              {/* Inhalt */}
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, padding: "0 0 1rem", color: "var(--text)" }}>
                {selectedNachricht.inhalt}
              </div>

              {/* Antworten-Thread */}
              {selectedNachricht.antworten && selectedNachricht.antworten.length > 0 && (
                <>
                  <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "0 0 0.8rem" }} />
                  <h4 style={{ margin: "0 0 0.8rem", color: "var(--text-dim)", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Verlauf ({selectedNachricht.antworten.length})
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1rem", maxHeight: 240, overflowY: "auto" }}>
                    {selectedNachricht.antworten.map((a: { id: number; vonKuerzel: string; inhalt: string; createdAt: Date }) => {
                      const isMe = a.vonKuerzel === kuerzel;
                      return (
                        <div
                          key={a.id}
                          style={{
                            padding:      "0.6rem 0.8rem",
                            borderRadius: 8,
                            background:   isMe ? "rgba(0, 100, 210, 0.08)" : "var(--bg)",
                            borderLeft:   `3px solid ${isMe ? "var(--primary)" : "var(--border)"}`,
                            alignSelf:    isMe ? "flex-end" : "flex-start",
                            maxWidth:     "90%",
                          }}
                        >
                          <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginBottom: 3 }}>
                            <strong style={{ color: isMe ? "var(--primary)" : "var(--text)" }}>{a.vonKuerzel}</strong>
                            {" "}· {new Date(a.createdAt).toLocaleString("de-DE")}
                          </div>
                          <div style={{ whiteSpace: "pre-wrap", fontSize: "0.88rem" }}>{a.inhalt}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* ── Antwort-Box ── */}
              <div style={{ marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--text-dim)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Antworten
                </div>

                {/* Schnellantworten */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {QUICK_REPLIES.map((text) => (
                    <button
                      key={text}
                      onClick={() => setAntwortext(text)}
                      style={{
                        ...btnIcon,
                        fontSize:  "0.78rem",
                        padding:   "0.25rem 0.65rem",
                        background: antwortext === text ? "var(--primary)" : "var(--bg)",
                        color:      antwortext === text ? "white" : "var(--text)",
                        border:     `1px solid ${antwortext === text ? "var(--primary)" : "var(--border)"}`,
                      }}
                    >
                      {text}
                    </button>
                  ))}
                </div>

                {/* Textarea */}
                <textarea
                  value={antwortext}
                  onChange={(e) => setAntwortext(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleAntworten(); }}
                  placeholder="Antwort schreiben... (Strg+Enter zum Senden)"
                  rows={3}
                  style={{
                    width:        "100%",
                    padding:      "0.7rem 1rem",
                    borderRadius: 10,
                    border:       "2px solid var(--border)",
                    background:   "var(--bg)",
                    color:        "var(--text)",
                    boxSizing:    "border-box",
                    outline:      "none",
                    fontFamily:   "'Ubuntu', sans-serif",
                    fontSize:     "0.9rem",
                    resize:       "vertical",
                    marginBottom: 10,
                    transition:   "border-color 0.2s",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
                  onBlur={(e)  => (e.currentTarget.style.borderColor = "var(--border)")}
                />

                <button
                  onClick={handleAntworten}
                  disabled={!antwortext.trim() || antwortenMutation.isPending}
                  style={{
                    background:   !antwortext.trim() ? "var(--border)" : "var(--primary)",
                    color:        !antwortext.trim() ? "var(--text-dim)" : "white",
                    border:       "none",
                    padding:      "0.7rem 1.5rem",
                    borderRadius: 8,
                    fontWeight:   "bold",
                    cursor:       !antwortext.trim() ? "not-allowed" : "pointer",
                    fontFamily:   "'Ubuntu', sans-serif",
                    fontSize:     "0.9rem",
                    transition:   "all 0.15s",
                    width:        "100%",
                  }}
                >
                  {antwortenMutation.isPending ? "⏳ Wird gesendet…" : "✉️ Antworten"}
                </button>
              </div>
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
