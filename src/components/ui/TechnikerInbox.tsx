"use client";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/trpc/react";

type Antwort = {
  id:         number;
  vonKuerzel: string;
  inhalt:     string;
  createdAt:  Date;
};

type Nachricht = {
  id:         number;
  betreff:    string;
  inhalt:     string;
  vonKuerzel: string;
  createdAt:  Date;
  antworten:  Antwort[];
};

type EmpfRecord = {
  id:          number;
  nachrichtId: number;
  empfKuerzel: string;
  gelesen:     boolean;
  gelesenAt:   Date | null;
  nachricht:   Nachricht;
};

// ── Schnellantworten ──────────────────────────────────────────────────────────

const SCHNELLANTWORTEN = [
  { label: "✅ Verstanden",        text: "Verstanden, danke!" },
  { label: "🏃 Hole es gleich ab", text: "Ich hole es gleich ab." },
  { label: "❓ Frage dazu",        text: "Ich habe eine Frage dazu: " },
];

function formatDatum(d: Date | string) {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Inbox Panel ───────────────────────────────────────────────────────────────

function InboxPanel({
  kuerzel,
  onClose,
}: {
  kuerzel:  string;
  onClose:  () => void;
}) {
  const [ausgewaehlt, setAusgewaehlt] = useState<EmpfRecord | null>(null);
  const [antwortText, setAntwortText] = useState("");

  const { data, refetch } = api.nachrichten.getInbox.useQuery(
    { kuerzel },
    { refetchInterval: 30_000 },
  );

  const markGelesen = api.nachrichten.markGelesen.useMutation({
    onSuccess: () => refetch(),
  });

  const alleGelesen = api.nachrichten.alleMarkierenGelesen.useMutation({
    onSuccess: () => { refetch(); setAusgewaehlt(null); },
  });

  const antworten = api.nachrichten.antworten.useMutation({
    onSuccess: () => {
      setAntwortText("");
      refetch().then((r) => {
        if (ausgewaehlt && r.data) {
          const aktuell = r.data.nachrichten.find(
            (n: EmpfRecord) => n.id === ausgewaehlt.id,
          );
          if (aktuell) setAusgewaehlt(aktuell);
        }
      });
    },
  });

  function oeffneNachricht(record: EmpfRecord) {
    setAusgewaehlt(record);
    setAntwortText("");
    if (!record.gelesen) {
      markGelesen.mutate({ nachrichtId: record.nachrichtId, kuerzel });
    }
  }

  const nachrichten = (data?.nachrichten ?? []) as EmpfRecord[];

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-sm bg-white dark:bg-[#242526] border-l border-[#ced4da] dark:border-[#3e4042] shadow-2xl"
      style={{ top: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] flex-shrink-0">
        <div className="flex items-center gap-2">
          {ausgewaehlt ? (
            <button
              onClick={() => setAusgewaehlt(null)}
              className="text-[#65676b] hover:text-[#1a1a1a] dark:hover:text-[#e4e6eb] text-lg mr-1 transition-colors"
            >
              ←
            </button>
          ) : null}
          <span className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
            {ausgewaehlt ? ausgewaehlt.nachricht.betreff : "Nachrichten"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!ausgewaehlt && nachrichten.some((n) => !n.gelesen) && (
            <button
              onClick={() => alleGelesen.mutate({ kuerzel })}
              className="text-xs text-[#0064d2] dark:text-[#45bdff] hover:underline"
            >
              Alle gelesen
            </button>
          )}
          <button
            onClick={onClose}
            className="text-[#65676b] hover:text-[#fa3e3e] text-xl font-bold transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      {!ausgewaehlt ? (
        /* ── Nachrichtenliste ── */
        <div className="flex-1 overflow-y-auto divide-y divide-[#ced4da] dark:divide-[#3e4042]">
          {nachrichten.length === 0 && (
            <div className="py-16 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
              Keine Nachrichten
            </div>
          )}
          {nachrichten.map((record) => (
            <button
              key={record.id}
              onClick={() => oeffneNachricht(record)}
              className="w-full text-left px-4 py-3.5 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className={`text-sm truncate flex-1 ${!record.gelesen ? "font-black text-[#1a1a1a] dark:text-[#e4e6eb]" : "font-medium text-[#65676b] dark:text-[#b0b3b8]"}`}>
                  {!record.gelesen && (
                    <span className="inline-block w-2 h-2 bg-[#0064d2] rounded-full mr-2 flex-shrink-0" />
                  )}
                  {record.nachricht.betreff}
                </span>
              </div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mb-1">
                Von: Admin · {formatDatum(record.nachricht.createdAt)}
              </div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] truncate">
                {record.nachricht.inhalt.slice(0, 60)}{record.nachricht.inhalt.length > 60 ? "…" : ""}
              </div>
              {record.nachricht.antworten.length > 0 && (
                <div className="mt-1 text-[10px] text-[#0064d2] dark:text-[#45bdff]">
                  💬 {record.nachricht.antworten.length} Antwort{record.nachricht.antworten.length !== 1 ? "en" : ""}
                </div>
              )}
            </button>
          ))}
        </div>
      ) : (
        /* ── Detail-Ansicht ── */
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Meta */}
            <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              {formatDatum(ausgewaehlt.nachricht.createdAt)}
            </div>

            {/* Haupt-Inhalt */}
            <div className="bg-[#f0f2f5] dark:bg-[#3e4042] rounded-xl px-4 py-3">
              <p className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] whitespace-pre-wrap leading-relaxed">
                {ausgewaehlt.nachricht.inhalt}
              </p>
            </div>

            {/* Antworten */}
            {ausgewaehlt.nachricht.antworten.map((a) => {
              const istSelf = a.vonKuerzel === kuerzel;
              return (
                <div key={a.id} className={`flex ${istSelf ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${
                    istSelf
                      ? "bg-[#0064d2] text-white"
                      : "bg-[#f0f2f5] dark:bg-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb]"
                  }`}>
                    <div className={`text-[10px] font-bold mb-0.5 ${istSelf ? "text-white/80" : "text-[#65676b] dark:text-[#b0b3b8]"}`}>
                      {a.vonKuerzel} · {formatDatum(a.createdAt)}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{a.inhalt}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Antwort-Box */}
          <div className="px-4 py-3 border-t border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] space-y-2 flex-shrink-0">
            {/* Schnellantworten */}
            <div className="flex flex-wrap gap-1.5">
              {SCHNELLANTWORTEN.map((s) => (
                <button
                  key={s.label}
                  onClick={() => setAntwortText(s.text)}
                  className="px-2.5 py-1 text-xs rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-white dark:hover:bg-[#242526] hover:border-[#0064d2] transition-colors"
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <textarea
                value={antwortText}
                onChange={(e) => setAntwortText(e.target.value)}
                rows={2}
                placeholder="Antwort schreiben..."
                className="flex-1 px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-sm text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] resize-none transition-colors"
              />
              <button
                onClick={() => {
                  if (!antwortText.trim()) return;
                  antworten.mutate({
                    nachrichtId: ausgewaehlt.nachrichtId,
                    inhalt:      antwortText.trim(),
                  });
                }}
                disabled={antworten.isPending || !antwortText.trim()}
                className="px-3 py-2 bg-[#0064d2] text-white text-sm font-bold rounded-lg hover:bg-[#0056b3] disabled:opacity-40 transition-colors self-end"
              >
                {antworten.isPending ? "…" : "↑"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Bell-Button + Panel ───────────────────────────────────────────────────────

export function TechnikerInbox({ kuerzel }: { kuerzel: string }) {
  const [offen, setOffen] = useState(false);

  const { data: ungelesen, refetch } = api.nachrichten.getUngelesen.useQuery(
    { kuerzel },
    { refetchInterval: 30_000 },
  );

  // Schließen bei Escape
  useEffect(() => {
    if (!offen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOffen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offen]);

  const count = typeof ungelesen === "number" ? ungelesen : 0;

  return (
    <>
      {/* Bell-Button für Portal-Header */}
      <button
        onClick={() => { setOffen(true); refetch(); }}
        className="relative p-2 rounded-xl hover:bg-black/5 transition-colors"
        title="Nachrichten"
      >
        <span className="text-xl">🔔</span>
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-[#fa3e3e] text-white text-[10px] font-black rounded-full flex items-center justify-center px-0.5 leading-none">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {/* Overlay */}
      {offen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOffen(false)}
          />
          <InboxPanel kuerzel={kuerzel} onClose={() => setOffen(false)} />
        </>
      )}
    </>
  );
}
