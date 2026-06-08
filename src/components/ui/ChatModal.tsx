"use client";
import { useState, useEffect, useRef } from "react";
import FocusTrap from "focus-trap-react";
import { api }       from "@/trpc/react";
import { useToast }  from "@/components/ui/Toast";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS }    from "@/modules/realtime/events";

// ── Konstanten ────────────────────────────────────────────────────────────────

const ADMIN_QUICK_REPLIES = [
  "Bitte Gerät bereitstellen",
  "Rückfrage zum Gerät",
  "Teil liegt zur Abholung bereit",
  "Bitte melden",
];

const TECHNIKER_QUICK_REPLIES = [
  "✅ Verstanden",
  "🏃 Hole es gleich ab",
  "📅 Kommt morgen",
  "❓ Habe eine Frage",
];

// ── Chat-Bubble ───────────────────────────────────────────────────────────────

function Bubble({ vonKuerzel, inhalt, createdAt, isOwn }: {
  vonKuerzel: string; inhalt: string; createdAt: Date; isOwn: boolean;
}) {
  const time = new Date(createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isOwn ? "flex-end" : "flex-start", marginBottom: 10 }}>
      <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", marginBottom: 3, paddingInline: 4 }}>
        {isOwn ? `Ich · ${time}` : `${vonKuerzel} · ${time}`}
      </div>
      <div style={{
        maxWidth:     "78%",
        padding:      "8px 12px",
        borderRadius: isOwn ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        background:   isOwn ? "var(--primary)" : "var(--bg)",
        color:        isOwn ? "white" : "var(--text)",
        border:       isOwn ? "none" : "1px solid var(--border)",
        fontSize:     "0.88rem",
        lineHeight:   1.5,
        whiteSpace:   "pre-wrap",
        wordBreak:    "break-word",
      }}>
        {inhalt}
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ChatModalProps {
  anfrageId:   number;
  currentUser: string;
  isAdmin:     boolean;
  bezugInfo?:  string;   // z.B. "T15 · 212.706.341"
  partnerName?: string;  // z.B. "FS" oder "Admin"
  onClose:     () => void;
}

// ── ChatModal ─────────────────────────────────────────────────────────────────

export function ChatModal({
  anfrageId,
  currentUser,
  isAdmin,
  bezugInfo,
  partnerName,
  onClose,
}: ChatModalProps) {
  const { show }    = useToast();
  const { on, off } = useSocket();
  const [antwortext, setAntwortext] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!anfrageId || !currentUser) return null;

  // Nachrichten laden + Polling alle 3s
  const { data: nachrichten = [], isLoading, error, refetch } = api.chat.getByAnfrage.useQuery(
    { anfrageId },
    { refetchInterval: 3_000, staleTime: 2_000 },
  );

  // Als gelesen markieren beim Öffnen
  const markGelesenMutation = api.chat.markGelesen.useMutation();
  useEffect(() => {
    markGelesenMutation.mutate({ anfrageId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anfrageId]);

  // Socket: sofortiger Refresh wenn CHAT_NEU für diese Anfrage
  useEffect(() => {
    const handler = (d: unknown) => {
      const data = d as { anfrageId: number };
      if (data.anfrageId === anfrageId) refetch();
    };
    on(EVENTS.CHAT_NEU, handler);
    return () => off(EVENTS.CHAT_NEU);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anfrageId, on, off]);

  // Auto-Scroll bei neuen Nachrichten
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [nachrichten.length]);

  // Senden
  const sendenMutation = api.chat.senden.useMutation({
    onSuccess: () => {
      setAntwortext("");
      refetch();
      markGelesenMutation.mutate({ anfrageId });
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 150);
    },
    onError: (e) => show(e.message, "error"),
  });

  function handleSenden() {
    const t = antwortext.trim();
    if (!t) return;
    sendenMutation.mutate({ anfrageId, inhalt: t });
  }

  const quickReplies = isAdmin ? ADMIN_QUICK_REPLIES : TECHNIKER_QUICK_REPLIES;
  const headerTitle  = `💬 Chat${partnerName ? ` mit ${partnerName}` : ""}`;

  return (
    <FocusTrap focusTrapOptions={{ escapeDeactivates: false, clickOutsideDeactivates: false, returnFocusOnDeactivate: true }}>
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        zIndex:         10500,
        display:        "flex",
        alignItems:     "flex-start",
        justifyContent: "center",
        overflowY:      "auto",
        padding:        "3vh 12px",
      }}
      onClick={onClose}
    >
      <style>{`
        .chat-modal-card {
          max-height: 88vh;   /* Fallback */
          max-height: 88dvh;  /* berücksichtigt Browserleiste/Tastatur */
        }
      `}</style>
      <div
        className="chat-modal-card"
        style={{
          background:    "var(--card-bg)",
          borderRadius:  16,
          boxShadow:     "0 24px 60px rgba(0,0,0,0.3)",
          width:         "100%",
          maxWidth:      620,
          display:       "flex",
          flexDirection: "column",
          overflow:      "hidden",
          color:         "var(--text)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, position: "sticky", top: 0, zIndex: 2, background: "var(--card-bg)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>{headerTitle}</div>
            {bezugInfo && (
              <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 1 }}>{bezugInfo}</div>
            )}
          </div>
          <button onClick={onClose} aria-label="Schließen" style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "1.4rem", lineHeight: 1, padding: "8px 10px", minWidth: 44, minHeight: 44 }}>×</button>
        </div>

        {/* ── Nachrichten ── */}
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 18px" }}>
          {isLoading && (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "2rem" }}>Laden...</div>
          )}
          {error && (
            <div style={{ textAlign: "center", color: "var(--danger)", padding: "2rem", fontSize: "0.85rem" }}>
              Fehler: {error.message}
            </div>
          )}
          {!isLoading && !error && nachrichten.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "2rem" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>💬</div>
              Noch keine Nachrichten — schreibe die erste!
            </div>
          )}
          {nachrichten.map((n) => (
            <Bubble
              key={n.id}
              vonKuerzel={n.vonKuerzel}
              inhalt={n.inhalt}
              createdAt={n.createdAt}
              isOwn={n.vonKuerzel === currentUser}
            />
          ))}
        </div>

        {/* ── Quick Replies ── */}
        <div style={{ padding: "10px 18px 0", display: "flex", flexWrap: "wrap", gap: 6, borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {quickReplies.map((r) => (
            <button
              key={r}
              onClick={() => setAntwortext(r)}
              style={{
                padding:      "3px 10px",
                borderRadius: 20,
                border:       `1px solid ${antwortext === r ? "var(--primary)" : "var(--border)"}`,
                background:   antwortext === r ? "var(--primary)" : "var(--bg)",
                color:        antwortext === r ? "white" : "var(--text)",
                cursor:       "pointer",
                fontSize:     "0.78rem",
                fontFamily:   "'Ubuntu', sans-serif",
                fontWeight:   antwortext === r ? 700 : 500,
                transition:   "all 0.15s",
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* ── Eingabe ── */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, flexShrink: 0 }}>
          <textarea
            value={antwortext}
            onChange={(e) => setAntwortext(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleSenden(); }}
            placeholder="Nachricht schreiben… (Strg+Enter)"
            rows={2}
            style={{
              flex:         1,
              padding:      "8px 12px",
              borderRadius: 10,
              border:       "1px solid var(--border)",
              background:   "var(--bg)",
              color:        "var(--text)",
              outline:      "none",
              fontFamily:   "'Ubuntu', sans-serif",
              fontSize:     "0.88rem",
              resize:       "none",
              transition:   "border-color 0.2s",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
            onBlur={(e)  => (e.currentTarget.style.borderColor = "var(--border)")}
          />
          <button
            onClick={handleSenden}
            disabled={!antwortext.trim() || sendenMutation.isPending}
            style={{
              alignSelf:    "flex-end",
              padding:      "10px 18px",
              borderRadius: 10,
              background:   antwortext.trim() ? "var(--primary)" : "var(--border)",
              color:        antwortext.trim() ? "white" : "var(--text-dim)",
              border:       "none",
              cursor:       antwortext.trim() ? "pointer" : "not-allowed",
              fontFamily:   "'Ubuntu', sans-serif",
              fontWeight:   700,
              fontSize:     "0.88rem",
              whiteSpace:   "nowrap",
              transition:   "all 0.15s",
            }}
          >
            {sendenMutation.isPending ? "⏳" : "Senden"}
          </button>
        </div>
      </div>
    </div>
    </FocusTrap>
  );
}
