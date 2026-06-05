"use client";
import { useState, useEffect } from "react";
import { api }       from "@/trpc/react";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS }    from "@/modules/realtime/events";
import { ChatModal } from "@/components/ui/ChatModal";

interface Props {
  // ALLE Teil-Anfragen der Gruppe — Chat-Stats/„gelesen" müssen über die ganze
  // Gruppe laufen (System-/Auto-Nachrichten hängen ggf. an einer Nicht-Erst-Anfrage).
  anfrageIds: number[];
  kuerzel:    string;
  bezugInfo?: string;
}

export default function GruppenNachrichten({ anfrageIds, kuerzel, bezugInfo }: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const { on, off } = useSocket();
  const primaryId = anfrageIds[0]!; // Thread-Schlüssel für das Modal (wie bisher)

  // Stats über die GANZE Gruppe (alle Teil-Anfragen), passend zum Karten-Badge.
  const { data: statsArr, refetch } = api.chat.getStatsBatch.useQuery(
    { anfrageIds },
    { enabled: anfrageIds.length > 0, refetchInterval: 3_000, staleTime: 2_000 },
  );

  const markGelesenMutation = api.chat.markGelesenGruppe.useMutation({
    onSuccess: () => refetch(),
  });

  const ungelesen    = (statsArr ?? []).reduce((s, x) => s + (x.ungelesen ?? 0), 0);
  const gesamtAnzahl = (statsArr ?? []).reduce((s, x) => s + (x.gesamtAnzahl ?? 0), 0);
  const letzteNachricht = (statsArr ?? [])
    .map((x) => x.letzteNachricht)
    .filter((m): m is NonNullable<typeof m> => !!m)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;

  // Sofortiger Refresh bei eingehender Chat-Nachricht (Socket.io) für jedes Teil
  useEffect(() => {
    const handler = (d: unknown) => {
      const data = d as { anfrageId: number };
      if (anfrageIds.includes(data.anfrageId)) refetch();
    };
    on(EVENTS.CHAT_NEU, handler);
    return () => off(EVENTS.CHAT_NEU);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anfrageIds.join(",")]);

  function openChat() {
    setChatOpen(true);
    markGelesenMutation.mutate({ anfrageIds });
  }

  // Pulsieren NUR wenn ungelesen > 0 und Modal noch nicht offen
  const hasPulse = ungelesen > 0 && !chatOpen;

  return (
    <>
      {chatOpen && (
        <ChatModal
          anfrageId={primaryId}
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
