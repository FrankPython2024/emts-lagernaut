"use client";
import { useState, useEffect } from "react";
import { api }       from "@/trpc/react";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS }    from "@/modules/realtime/events";
import { ChatModal } from "@/components/ui/ChatModal";

interface Props {
  anfrageId:  number;
  kuerzel:    string;
  bezugInfo?: string;
}

export default function GruppenNachrichten({ anfrageId, kuerzel, bezugInfo }: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const { on, off } = useSocket();

  // Einzelner Stats-Call ersetzt die früheren zwei parallelen Queries
  const { data: stats, refetch } = api.chat.getStatsForAnfrage.useQuery(
    { anfrageId },
    { refetchInterval: 3_000, staleTime: 2_000 },
  );

  const markGelesenMutation = api.chat.markGelesen.useMutation({
    onSuccess: () => refetch(),
  });

  const ungelesen      = stats?.ungelesen      ?? 0;
  const letzteNachricht = stats?.letzteNachricht ?? null;
  const gesamtAnzahl   = stats?.gesamtAnzahl   ?? 0;

  // Sofortiger Refresh bei eingehender Chat-Nachricht (Socket.io)
  useEffect(() => {
    const handler = (d: unknown) => {
      const data = d as { anfrageId: number };
      if (data.anfrageId === anfrageId) refetch();
    };
    on(EVENTS.CHAT_NEU, handler);
    return () => off(EVENTS.CHAT_NEU);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anfrageId]);

  function openChat() {
    setChatOpen(true);
    markGelesenMutation.mutate({ anfrageId });
  }

  // Pulsieren NUR wenn ungelesen > 0 und Modal noch nicht offen
  const hasPulse = ungelesen > 0 && !chatOpen;

  return (
    <>
      {chatOpen && (
        <ChatModal
          anfrageId={anfrageId}
          currentUser={kuerzel}
          isAdmin={false}
          bezugInfo={bezugInfo}
          partnerName="Admin"
          onClose={() => {
            setChatOpen(false);
            refetch();
          }}
        />
      )}

      {/* ── Chat-Bereich an der Karte ── */}
      <div style={{
        borderTop:  "1px solid var(--border)",
        padding:    "10px 16px",
        background: hasPulse ? "rgba(0,100,210,0.07)" : "transparent",
        display:    "flex",
        alignItems: "center",
        gap:        12,
        minHeight:  52,
        transition: "background 0.4s",
      }}>
        {/* Vorschau / Status-Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {letzteNachricht ? (
            <>
              <div style={{ fontSize: "0.72rem", marginBottom: 1 }}>
                {hasPulse ? (
                  <strong style={{ color: "var(--primary)" }}>
                    💬 {ungelesen} neue Nachricht{ungelesen !== 1 ? "en" : ""}
                  </strong>
                ) : (
                  <span style={{ color: "var(--text-dim)" }}>
                    💬 {letzteNachricht.vonKuerzel} · {new Date(letzteNachricht.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>
              <div style={{
                fontSize:     "0.8rem",
                color:        hasPulse ? "var(--primary)" : "var(--text-dim)",
                fontWeight:   hasPulse ? 700 : 400,
                overflow:     "hidden",
                textOverflow: "ellipsis",
                whiteSpace:   "nowrap",
              }}>
                {letzteNachricht.inhalt.substring(0, 60)}{letzteNachricht.inhalt.length > 60 ? "…" : ""}
              </div>
            </>
          ) : (
            <div style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>
              {gesamtAnzahl === 0 ? "Noch kein Chat" : "Chat"}
            </div>
          )}
        </div>

        {/* Chat öffnen */}
        <button
          onClick={openChat}
          style={{
            background:   hasPulse ? "var(--primary)" : "var(--bg)",
            color:        hasPulse ? "white" : "var(--text)",
            border:       `1px solid ${hasPulse ? "var(--primary)" : "var(--border)"}`,
            padding:      "6px 14px",
            borderRadius: 20,
            fontSize:     "0.78rem",
            fontWeight:   700,
            fontFamily:   "'Ubuntu', sans-serif",
            cursor:       "pointer",
            display:      "flex",
            alignItems:   "center",
            gap:          6,
            flexShrink:   0,
            transition:   "all 0.15s",
            animation:    hasPulse ? "chatPulse 1.5s ease-in-out infinite" : "none",
          }}
        >
          💬 Chat
          {ungelesen > 0 && (
            <span style={{
              background:     "var(--danger)",
              color:          "white",
              borderRadius:   "50%",
              width:          18,
              height:         18,
              display:        "inline-flex",
              alignItems:     "center",
              justifyContent: "center",
              fontSize:       "0.65rem",
              fontWeight:     "bold",
            }}>
              {ungelesen > 9 ? "9+" : ungelesen}
            </span>
          )}
        </button>
      </div>

      <style>{`
        @keyframes chatPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0, 100, 210, 0.5); }
          50%       { box-shadow: 0 0 0 8px rgba(0, 100, 210, 0); }
        }
      `}</style>
    </>
  );
}
