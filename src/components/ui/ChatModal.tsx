"use client";
import { useState, useEffect, useRef } from "react";
import { api }       from "@/trpc/react";
import { useToast }  from "@/components/ui/Toast";

// ── Cleanup helper ────────────────────────────────────────────────────────────

function cleanInhalt(text: string): string {
  return text.replace(/\n\n\[LogID:[^\]]*\]$/, "").trim();
}

// ── Bubble ────────────────────────────────────────────────────────────────────

function Bubble({
  vonKuerzel, inhalt, createdAt, isOwn,
}: {
  vonKuerzel: string; inhalt: string; createdAt: Date; isOwn: boolean;
}) {
  const time = new Date(createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return (
    <div style={{
      display:   "flex",
      flexDirection: "column",
      alignItems: isOwn ? "flex-end" : "flex-start",
      marginBottom: 10,
    }}>
      {/* Meta */}
      <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", marginBottom: 3, paddingInline: 4 }}>
        {isOwn ? `Ich · ${time}` : `${vonKuerzel} · ${time}`}
      </div>
      {/* Bubble */}
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

// ── ChatModal ─────────────────────────────────────────────────────────────────

const QUICK_REPLIES = ["✅ Verstanden", "🏃 Hole es gleich ab", "📅 Kommt morgen", "❓ Habe eine Frage"];

export interface ChatModalProps {
  nachrichtId:       number;
  logId?:            string;
  geraeteName?:      string;
  currentUser:       string;
  showQuickReplies?: boolean;
  title?:            string;
  onClose:           () => void;
}

export function ChatModal({
  nachrichtId,
  logId,
  geraeteName,
  currentUser,
  showQuickReplies = false,
  title,
  onClose,
}: ChatModalProps) {
  const { show } = useToast();
  const [antwortext, setAntwortext] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Nachricht + Antworten laden (pollt alle 3s)
  const { data: nachricht, isLoading } = api.nachrichten.getById.useQuery(
    { id: nachrichtId },
    { refetchInterval: 3_000, staleTime: 2_000 },
  );

  // Als gelesen markieren beim Öffnen
  const markGelesenMutation = api.nachrichten.markGelesen.useMutation();
  useEffect(() => {
    markGelesenMutation.mutate({ nachrichtId, kuerzel: currentUser });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nachrichtId]);

  // Auto-Scroll bei neuen Antworten
  const antwortenLen = nachricht?.antworten.length ?? 0;
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [antwortenLen]);

  // Antworten senden
  const { data: _antworten, refetch } = api.nachrichten.getById.useQuery(
    { id: nachrichtId },
    { refetchInterval: 3_000, staleTime: 2_000, enabled: false }
  );
  const antwortenMutation = api.nachrichten.antworten.useMutation({
    onSuccess: () => {
      setAntwortext("");
      refetch();
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 150);
    },
    onError: (e) => show(e.message, "error"),
  });

  function handleSenden() {
    const t = antwortext.trim();
    if (!t) return;
    antwortenMutation.mutate({ nachrichtId, inhalt: t });
  }

  // Nachricht + Antworten als chronologische Liste
  const messages = nachricht ? [
    {
      key:        `n-${nachricht.id}`,
      vonKuerzel: nachricht.vonKuerzel,
      inhalt:     cleanInhalt(nachricht.inhalt),
      createdAt:  nachricht.createdAt,
    },
    ...(nachricht.antworten ?? []).map((a) => ({
      key:        `a-${a.id}`,
      vonKuerzel: a.vonKuerzel,
      inhalt:     a.inhalt,
      createdAt:  a.createdAt,
    })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) : [];

  const headerTitle = title
    ?? (logId && logId !== "unbekannt" ? `Chat · LogID ${logId}` : "Chat");

  const sub = [geraeteName, logId && logId !== "unbekannt" ? logId : undefined]
    .filter(Boolean).join(" · ");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position:       "fixed",
        inset:          0,
        background:     "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        zIndex:         10500,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        padding:        16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background:   "var(--card-bg)",
          borderRadius: 16,
          boxShadow:    "0 24px 60px rgba(0,0,0,0.3)",
          width:        "100%",
          maxWidth:     600,
          maxHeight:    "85vh",
          display:      "flex",
          flexDirection: "column",
          overflow:     "hidden",
          color:        "var(--text)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{
          padding:     "14px 18px",
          borderBottom: "1px solid var(--border)",
          display:     "flex",
          alignItems:  "center",
          gap:         10,
          flexShrink:  0,
        }}>
          <span style={{ fontSize: "1.4rem" }}>💬</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>{headerTitle}</div>
            {sub && <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>{sub}</div>}
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "1.4rem", lineHeight: 1, padding: "2px 6px" }}
          >
            ×
          </button>
        </div>

        {/* ── Messages ── */}
        <div
          ref={scrollRef}
          style={{
            flex:      1,
            overflowY: "auto",
            padding:   "16px 18px",
          }}
        >
          {isLoading && (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "2rem" }}>Laden...</div>
          )}
          {!isLoading && messages.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text-dim)", padding: "2rem" }}>Keine Nachrichten</div>
          )}
          {messages.map((m) => (
            <Bubble
              key={m.key}
              vonKuerzel={m.vonKuerzel}
              inhalt={m.inhalt}
              createdAt={m.createdAt}
              isOwn={m.vonKuerzel === currentUser}
            />
          ))}
        </div>

        {/* ── Quick Replies ── */}
        {showQuickReplies && (
          <div style={{
            padding:     "10px 18px 0",
            display:     "flex",
            flexWrap:    "wrap",
            gap:         6,
            borderTop:   "1px solid var(--border)",
            flexShrink:  0,
          }}>
            {QUICK_REPLIES.map((r) => (
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
        )}

        {/* ── Input ── */}
        <div style={{
          padding:     "12px 18px",
          borderTop:   "1px solid var(--border)",
          display:     "flex",
          gap:         10,
          flexShrink:  0,
        }}>
          <textarea
            value={antwortext}
            onChange={(e) => setAntwortext(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleSenden(); }}
            placeholder="Antwort schreiben… (Strg+Enter)"
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
            onFocus={(e)  => (e.currentTarget.style.borderColor = "var(--primary)")}
            onBlur={(e)   => (e.currentTarget.style.borderColor = "var(--border)")}
          />
          <button
            onClick={handleSenden}
            disabled={!antwortext.trim() || antwortenMutation.isPending}
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
            {antwortenMutation.isPending ? "⏳" : "Senden"}
          </button>
        </div>
      </div>
    </div>
  );
}
