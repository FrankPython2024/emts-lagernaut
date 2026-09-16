"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { usePermissions } from "@/hooks/usePermissions";

// ── Notizbuch: Übersicht ─────────────────────────────────────────────────────
// Sammellisten für LogIDs, Barcodes, Inventarnummern und alles, was sonst auf
// einem Zettel landet. Für alle mit NOTIZBUCH_VIEW sichtbar; anlegen und
// bearbeiten nur mit NOTIZBUCH_EDIT.

const eingabe = "w-full px-4 min-h-[56px] rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base outline-none focus:border-[#0064d2]";

function wannDe(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function NotizbuchPage() {
  const router   = useRouter();
  const { show } = useToast();
  const { has }  = usePermissions();
  const darfSchreiben = has("NOTIZBUCH_EDIT");

  const [suche, setSuche] = useState("");
  const [titel, setTitel] = useState("");

  const liste = api.notizbuch.liste.useQuery(
    { suche: suche.trim() || undefined },
    // Notizen sind für alle sichtbar — neue Scans anderer sollen ohne Neuladen auftauchen.
    { refetchInterval: 15_000 },
  );

  const anlegen = api.notizbuch.anlegen.useMutation({
    onSuccess: (n) => {
      setTitel("");
      // Direkt in die neue Notiz, damit man sofort scannen kann.
      router.push(`/admin/notizbuch/${n.id}`);
    },
    onError: (e) => show(`❌ ${e.message}`, "error"),
  });

  const neuAnlegen = () => {
    const t = titel.trim();
    if (t) anlegen.mutate({ titel: t });
  };

  return (
    <div className="space-y-5">
      {/* ── Kopf ──────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">📓 Notizbuch</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Listen für alles, was sonst auf einem Zettel landet: mehrere LogIDs scannen, Barcodes,
          Inventarnummern. Alle Notizen sind für alle Verwaltungs-Konten sichtbar und bleiben gespeichert.
        </p>

        {darfSchreiben && (
          <div className="mt-5 flex gap-3 flex-wrap">
            <input
              type="text" value={titel} maxLength={191}
              onChange={(e) => setTitel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") neuAnlegen(); }}
              placeholder="Titel der neuen Notiz, z. B. Inventur Regal 7"
              aria-label="Titel der neuen Notiz"
              className={`${eingabe} flex-1 min-w-[240px]`}
            />
            <button
              onClick={neuAnlegen}
              disabled={!titel.trim() || anlegen.isPending}
              className="px-6 min-h-[56px] rounded-xl bg-[#202F61] text-white font-bold hover:bg-[#18244a] disabled:opacity-50">
              {anlegen.isPending ? "…" : "➕ Neue Notiz"}
            </button>
          </div>
        )}
      </div>

      {/* ── Liste ─────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap p-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
            {liste.data ? `${liste.data.length} ${liste.data.length === 1 ? "Notiz" : "Notizen"}` : "Notizen"}
          </h2>
          <input
            type="search" value={suche} onChange={(e) => setSuche(e.target.value)}
            placeholder="Titel oder Text suchen…" aria-label="Notizen durchsuchen"
            className={`${eingabe} max-w-xs`}
          />
        </div>

        {liste.isLoading && <p className="p-6 text-[#65676b] dark:text-[#b0b3b8]">Lädt…</p>}
        {liste.error && <p className="p-6 text-[#c62828]">❌ {liste.error.message}</p>}

        {liste.data && liste.data.length === 0 && (
          <p className="p-6 text-[#65676b] dark:text-[#b0b3b8]">
            {suche.trim()
              ? "Keine Notiz passt zu dieser Suche."
              : darfSchreiben ? "Noch keine Notizen. Oben einen Titel eingeben und anlegen." : "Noch keine Notizen."}
          </p>
        )}

        {liste.data && liste.data.length > 0 && (
          <ul className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
            {liste.data.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/admin/notizbuch/${n.id}`}
                  className="flex items-center gap-4 px-5 py-4 min-h-[72px] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-lg text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{n.titel}</div>
                    {n.vorschau && (
                      <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] truncate">{n.vorschau}</div>
                    )}
                    <div className="text-xs text-[#90939a] mt-0.5">
                      Zuletzt {wannDe(n.updatedAt)}{n.geaendertVon ? ` · ${n.geaendertVon}` : ""} · angelegt von {n.erstelltVon}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-2xl font-bold tabular-nums text-[#202F61] dark:text-[#45bdff]">{n.anzahl}</div>
                    <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{n.anzahl === 1 ? "Eintrag" : "Einträge"}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
