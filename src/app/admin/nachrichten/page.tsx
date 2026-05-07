"use client";
import { useState } from "react";
import { NachrichtTyp, UserRolle } from "@prisma/client";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { useSession } from "next-auth/react";
import type { SessionUser } from "@/core/types";

// ── Typen ────────────────────────────────────────────────────────────────────

type Nachricht = {
  id:         number;
  betreff:    string;
  inhalt:     string;
  vonKuerzel: string;
  typ:        NachrichtTyp;
  createdAt:  Date;
  empfaenger: { empfKuerzel: string; gelesen: boolean }[];
  antworten:  { id: number; vonKuerzel: string; inhalt: string; createdAt: Date }[];
};

// ── Hilfs-Komponenten ─────────────────────────────────────────────────────────

const TYP_COLORS: Record<NachrichtTyp, string> = {
  DIREKT:    "bg-[#0064d2]/10 text-[#0064d2]",
  BROADCAST: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  SYSTEM:    "bg-[#00a400]/10 text-[#00a400]",
};

function TypBadge({ typ }: { typ: NachrichtTyp }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${TYP_COLORS[typ]}`}>
      {typ}
    </span>
  );
}

function formatDatum(d: Date) {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function GelesenBadge({ empfaenger }: { empfaenger: { gelesen: boolean }[] }) {
  if (empfaenger.length === 0) return null;
  const gelesen = empfaenger.filter((e) => e.gelesen).length;
  const total   = empfaenger.length;
  const color   = gelesen === total ? "text-[#00a400]" : "text-[#f7b928]";
  return (
    <span className={`text-xs font-semibold ${color}`}>
      {gelesen}/{total} gelesen
    </span>
  );
}

// ── Neue-Nachricht Modal ──────────────────────────────────────────────────────

const VORLAGEN = [
  { label: "Teil bereit",       betreff: "✅ Teil bereit zur Abholung",    inhalt: "Dein angefragtes Teil liegt zur Abholung bereit." },
  { label: "Nicht verfügbar",   betreff: "⚠️ Teil nicht verfügbar",        inhalt: "Das angefragte Teil ist leider nicht auf Lager. Wir informieren dich sobald es verfügbar ist." },
  { label: "Neue Teile",        betreff: "🎉 Neue Teile eingetroffen",      inhalt: "Es sind neue Ersatzteile im Lager eingetroffen." },
  { label: "Bitte melden",      betreff: "📢 Bitte melden",                 inhalt: "Bitte melde dich kurz beim Admin-Bereich." },
];

function NeueNachrichtModal({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent:  () => void;
}) {
  const { show } = useToast();
  const [betreff, setBetreff]   = useState("");
  const [inhalt,  setInhalt]    = useState("");
  const [broadcast, setBroadcast] = useState(false);
  const [ausgewaehlt, setAusgewaehlt] = useState<string[]>([]);

  const { data: benutzer } = api.benutzer.getAll.useQuery();
  const empfaengerListe = benutzer?.filter(
    (u) => u.aktiv && (u.rolle === UserRolle.TECHNIKER || u.rolle === UserRolle.BETRACHTER),
  ) ?? [];

  const senden = api.nachrichten.senden.useMutation({
    onSuccess: () => { show("Nachricht gesendet", "success"); onSent(); onClose(); },
    onError:   (e) => show(e.message, "error"),
  });

  function toggleEmpf(kuerzel: string) {
    setAusgewaehlt((prev) =>
      prev.includes(kuerzel) ? prev.filter((k) => k !== kuerzel) : [...prev, kuerzel],
    );
  }

  function handleSenden() {
    if (!betreff.trim() || !inhalt.trim()) {
      show("Betreff und Nachricht sind Pflichtfelder", "warning"); return;
    }
    const empfaenger = broadcast ? "ALL" : ausgewaehlt;
    if (!broadcast && ausgewaehlt.length === 0) {
      show("Bitte mindestens einen Empfänger auswählen", "warning"); return;
    }
    senden.mutate({
      empfaenger,
      betreff: betreff.trim(),
      inhalt:  inhalt.trim(),
      typ:     broadcast ? NachrichtTyp.BROADCAST : NachrichtTyp.DIREKT,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">Neue Nachricht</h2>
          <button onClick={onClose} className="text-[#65676b] hover:text-[#fa3e3e] text-xl font-bold transition-colors">×</button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* Betreff */}
          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Betreff</label>
            <input
              value={betreff}
              onChange={(e) => setBetreff(e.target.value)}
              placeholder="Betreff eingeben..."
              className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#0064d2] transition-colors"
            />
          </div>

          {/* Empfänger */}
          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-2 uppercase tracking-wider">Empfänger</label>
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={broadcast}
                onChange={(e) => { setBroadcast(e.target.checked); setAusgewaehlt([]); }}
                className="w-4 h-4 accent-[#0064d2]"
              />
              <span className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">
                Alle Techniker (Broadcast)
              </span>
            </label>
            {!broadcast && (
              <div className="flex flex-wrap gap-2">
                {empfaengerListe.map((u) => (
                  <button
                    key={u.kuerzel}
                    onClick={() => toggleEmpf(u.kuerzel)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
                      ausgewaehlt.includes(u.kuerzel)
                        ? "bg-[#0064d2] text-white border-[#0064d2]"
                        : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:border-[#0064d2]"
                    }`}
                  >
                    {u.kuerzel}
                  </button>
                ))}
                {empfaengerListe.length === 0 && (
                  <span className="text-xs text-[#65676b]">Keine aktiven Techniker gefunden</span>
                )}
              </div>
            )}
          </div>

          {/* Vorlagen */}
          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-2 uppercase tracking-wider">Vorlagen</label>
            <div className="flex flex-wrap gap-2">
              {VORLAGEN.map((v) => (
                <button
                  key={v.label}
                  onClick={() => { setBetreff(v.betreff); setInhalt(v.inhalt); }}
                  className="px-2.5 py-1 text-xs rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Nachricht */}
          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Nachricht</label>
            <textarea
              value={inhalt}
              onChange={(e) => setInhalt(e.target.value)}
              rows={5}
              placeholder="Nachricht eingeben..."
              className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm outline-none focus:border-[#0064d2] resize-none transition-colors"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#ced4da] dark:border-[#3e4042]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e] transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSenden}
            disabled={senden.isPending}
            className="px-5 py-2 bg-[#0064d2] text-white text-sm font-bold rounded-lg hover:bg-[#0056b3] disabled:opacity-50 transition-colors"
          >
            {senden.isPending ? "Sende..." : "Senden"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Haupt-Seite ───────────────────────────────────────────────────────────────

export default function NachrichtenPage() {
  const { show }  = useToast();
  const { data: session } = useSession();
  const user = session?.user as SessionUser | undefined;

  const [ausgewaehlt, setAusgewaehlt] = useState<Nachricht | null>(null);
  const [antwortText, setAntwortText] = useState("");
  const [modalOffen,  setModalOffen]  = useState(false);

  const { data, isLoading, refetch } = api.nachrichten.getAlle.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  const antworten = api.nachrichten.antworten.useMutation({
    onSuccess: () => {
      setAntwortText("");
      show("Antwort gesendet", "success");
      refetch().then((r) => {
        if (ausgewaehlt && r.data) {
          const aktuell = r.data.find((n: Nachricht) => n.id === ausgewaehlt.id);
          if (aktuell) setAusgewaehlt(aktuell);
        }
      });
    },
    onError: (e) => show(e.message, "error"),
  });

  if (isLoading) return <PageLoader />;

  const nachrichten = (data ?? []) as Nachricht[];

  function waehleNachricht(n: Nachricht) {
    setAusgewaehlt(n);
    setAntwortText("");
  }

  function empfaengerLabel(n: Nachricht) {
    if (n.typ === NachrichtTyp.BROADCAST) return "Alle Techniker";
    return n.empfaenger.map((e) => e.empfKuerzel).join(", ") || "—";
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Nachrichten</h1>
        <button
          onClick={() => setModalOffen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#0064d2] text-white text-sm font-bold rounded-xl hover:bg-[#0056b3] transition-colors shadow-sm"
        >
          ✉️ Neue Nachricht
        </button>
      </div>

      {/* Zwei-Spalten-Layout */}
      <div className="flex flex-1 gap-4 min-h-0 overflow-hidden">

        {/* Linke Spalte — Liste */}
        <div className="w-80 flex-shrink-0 flex flex-col bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[#ced4da] dark:border-[#3e4042]">
            <span className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wider">
              Gesendet ({nachrichten.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#ced4da] dark:divide-[#3e4042]">
            {nachrichten.length === 0 && (
              <div className="py-12 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
                Noch keine Nachrichten
              </div>
            )}
            {nachrichten.map((n) => {
              const hatAntworten = n.antworten.length > 0;
              const aktiv = ausgewaehlt?.id === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => waehleNachricht(n)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    aktiv
                      ? "bg-[#0064d2]/10 border-l-2 border-[#0064d2]"
                      : "hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className={`text-sm truncate ${hatAntworten ? "font-black" : "font-semibold"} text-[#1a1a1a] dark:text-[#e4e6eb]`}>
                      {n.betreff}
                    </span>
                    <TypBadge typ={n.typ} />
                  </div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] truncate mb-1">
                    An: {empfaengerLabel(n)}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-[#65676b] dark:text-[#b0b3b8]">
                      {formatDatum(n.createdAt)}
                    </span>
                    <GelesenBadge empfaenger={n.empfaenger} />
                  </div>
                  {hatAntworten && (
                    <div className="mt-1 text-[10px] text-[#0064d2] dark:text-[#45bdff]">
                      💬 {n.antworten.length} Antwort{n.antworten.length !== 1 ? "en" : ""}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rechte Spalte — Detail */}
        <div className="flex-1 flex flex-col bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden min-w-0">
          {!ausgewaehlt ? (
            <div className="flex-1 flex items-center justify-center text-[#65676b] dark:text-[#b0b3b8]">
              <div className="text-center">
                <div className="text-5xl mb-3">✉️</div>
                <div className="text-sm">Nachricht auswählen</div>
              </div>
            </div>
          ) : (
            <>
              {/* Detail-Header */}
              <div className="px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
                      {ausgewaehlt.betreff}
                    </h2>
                    <div className="flex items-center gap-3 text-xs text-[#65676b] dark:text-[#b0b3b8] flex-wrap">
                      <span>Von: <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{ausgewaehlt.vonKuerzel}</strong></span>
                      <span>An: <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{empfaengerLabel(ausgewaehlt)}</strong></span>
                      <span>{formatDatum(ausgewaehlt.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <TypBadge typ={ausgewaehlt.typ} />
                    <GelesenBadge empfaenger={ausgewaehlt.empfaenger} />
                  </div>
                </div>
              </div>

              {/* Inhalt + Antworten */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                {/* Haupt-Inhalt */}
                <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl px-4 py-3">
                  <p className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] whitespace-pre-wrap leading-relaxed">
                    {ausgewaehlt.inhalt}
                  </p>
                </div>

                {/* Antworten */}
                {ausgewaehlt.antworten.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wider">
                      Antworten
                    </div>
                    {ausgewaehlt.antworten.map((a) => {
                      const istAdmin = user?.kuerzel === a.vonKuerzel;
                      return (
                        <div
                          key={a.id}
                          className={`flex ${istAdmin ? "justify-end" : "justify-start"}`}
                        >
                          <div className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
                            istAdmin
                              ? "bg-[#0064d2] text-white"
                              : "bg-[#f0f2f5] dark:bg-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb]"
                          }`}>
                            <div className={`text-[10px] font-bold mb-0.5 ${istAdmin ? "text-white/80" : "text-[#65676b] dark:text-[#b0b3b8]"}`}>
                              {a.vonKuerzel} · {formatDatum(a.createdAt)}
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{a.inhalt}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Antwort-Box */}
              <div className="px-6 py-4 border-t border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a]">
                <div className="flex gap-3">
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
                      antworten.mutate({ nachrichtId: ausgewaehlt.id, inhalt: antwortText.trim() });
                    }}
                    disabled={antworten.isPending || !antwortText.trim()}
                    className="px-4 py-2 bg-[#0064d2] text-white text-sm font-bold rounded-lg hover:bg-[#0056b3] disabled:opacity-40 transition-colors self-end"
                  >
                    {antworten.isPending ? "..." : "Senden"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal */}
      {modalOffen && (
        <NeueNachrichtModal
          onClose={() => setModalOffen(false)}
          onSent={() => refetch()}
        />
      )}
    </div>
  );
}
