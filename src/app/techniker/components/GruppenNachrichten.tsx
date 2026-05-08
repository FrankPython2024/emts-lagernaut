"use client";
import { useState }         from "react";
import { api }              from "@/trpc/react";
import { ChatModal }        from "@/components/ui/ChatModal";

interface Props {
  logId:   string;
  kuerzel: string;
}

export default function GruppenNachrichten({ logId, kuerzel }: Props) {
  const [chatId, setChatId] = useState<number | null>(null);

  const { data = [], refetch } = api.nachrichten.getByLogId.useQuery(
    { kuerzel, logId },
    {
      enabled:         !!(kuerzel && logId && logId !== "unbekannt"),
      refetchInterval: 5_000,
      staleTime:       4_000,
    },
  );

  if (process.env.NODE_ENV !== "production") {
    console.log("[GruppenNachrichten]", logId, "→", data.length, "Nachrichten");
  }

  if (!data.length) return null;

  // Erste Nachricht für Vorschau (neueste)
  const first      = data[0]!;
  const logIdTag   = `\n\n[LogID: ${logId}]`;
  const inCleaned  = first.nachricht.inhalt.endsWith(logIdTag)
    ? first.nachricht.inhalt.slice(0, -logIdTag.length).trim()
    : first.nachricht.inhalt;

  return (
    <>
      {/* Chat-Modal */}
      {chatId !== null && (
        <ChatModal
          nachrichtId={chatId}
          logId={logId}
          currentUser={kuerzel}
          showQuickReplies
          onClose={() => { setChatId(null); refetch(); }}
        />
      )}

      {/* Nachrichten-Panel in der Karte */}
      <div>
        {data.map((r) => {
          const tag      = `\n\n[LogID: ${logId}]`;
          const cleaned  = r.nachricht.inhalt.endsWith(tag)
            ? r.nachricht.inhalt.slice(0, -tag.length).trim()
            : r.nachricht.inhalt;

          const antwortCount = r.nachricht.antworten?.length ?? 0;

          return (
            <div
              key={r.id}
              style={{
                background:  "rgba(0, 100, 210, 0.08)",
                borderLeft:  "4px solid var(--primary)",
                borderTop:   "2px solid var(--primary)",
                padding:     "10px 14px",
              }}
            >
              {/* Header */}
              <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "var(--primary)", marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                <span>📬</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.nachricht.betreff}
                </span>
                {antwortCount > 0 && (
                  <span style={{ fontSize: "0.7rem", background: "var(--primary)", color: "white", borderRadius: 10, padding: "1px 6px", flexShrink: 0 }}>
                    {antwortCount} Antwort{antwortCount > 1 ? "en" : ""}
                  </span>
                )}
              </div>

              {/* Vorschau */}
              <div style={{ fontSize: "0.78rem", color: "var(--text-dim)", marginBottom: 8, lineHeight: 1.4 }}>
                {cleaned.substring(0, 100)}{cleaned.length > 100 ? "…" : ""}
              </div>

              {/* Chat öffnen */}
              <button
                onClick={() => setChatId(r.nachrichtId)}
                style={{
                  background:   "var(--primary)",
                  color:        "white",
                  padding:      "5px 14px",
                  borderRadius: 20,
                  fontSize:     "0.78rem",
                  fontWeight:   700,
                  fontFamily:   "'Ubuntu', sans-serif",
                  border:       "none",
                  cursor:       "pointer",
                  display:      "flex",
                  alignItems:   "center",
                  gap:          5,
                }}
              >
                💬 Chat öffnen
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
