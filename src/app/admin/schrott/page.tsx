"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";

// ── Schrottabholung: Übersicht der Aufträge ──────────────────────────────────
//
// Ein Auftrag ist eine Tabelle voller Collis, die am Ende als E-Mail an den
// Entsorger geht. Diese Seite listet sie und legt neue an; erfasst wird im
// Auftrag selbst.

const STATUS_TEXT = {
  OFFEN:     { label: "offen",     cls: "bg-[#0064d2]/12 text-[#0064d2] dark:text-[#45bdff]" },
  VERSENDET: { label: "versendet", cls: "bg-[#f7b928]/18 text-[#8A5A00] dark:text-[#f7b928]" },
  ERLEDIGT:  { label: "erledigt",  cls: "bg-[#04B475]/15 text-[#038F5C] dark:text-[#04B475]" },
} as const;

function heute(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export default function SchrottUebersicht() {
  const { has } = usePermissions();
  const darfBearbeiten = has("SCHROTT_MANAGE");
  const { show } = useToast();

  const [neuOffen, setNeuOffen] = useState(false);
  const [bezeichnung, setBezeichnung] = useState("");
  const [datum, setDatum] = useState(() => new Date().toISOString().slice(0, 10));

  const liste = api.schrott.auftraege.useQuery();
  const anlegen = api.schrott.auftragAnlegen.useMutation({
    onSuccess: () => { void liste.refetch(); setNeuOffen(false); setBezeichnung(""); },
    onError:   (e) => show(e.message, "error"),
  });

  const eingabe = "w-full px-3 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[48px]";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">♻️ Schrottabholung</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Ein Auftrag ist eine Abholung. Collis werden im Auftrag erfasst, am Ende
            geht die Tabelle als E-Mail an den Entsorger.
          </p>
        </div>
        {darfBearbeiten && (
          <button
            onClick={() => { setNeuOffen((v) => !v); setBezeichnung(`Schrottabholung ${heute()}`); }}
            className="px-5 py-3 rounded-xl bg-[#0064d2] text-white font-bold text-base min-h-[56px]"
          >
            {neuOffen ? "Abbrechen" : "+ Neuer Auftrag"}
          </button>
        )}
      </div>

      {neuOffen && darfBearbeiten && (
        <div className="rounded-xl border border-[#008BD2]/40 bg-[#008BD2]/5 p-5 space-y-3">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div>
              <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Bezeichnung</label>
              <input value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)}
                placeholder="z. B. Ettling Schrottabholung" className={eingabe} />
            </div>
            <div>
              <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Datum</label>
              <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} className={eingabe} />
            </div>
          </div>
          <button
            onClick={() => anlegen.mutate({
              bezeichnung: bezeichnung.trim(),
              datum:       new Date(`${datum}T12:00:00`).toISOString(),
            })}
            disabled={bezeichnung.trim().length < 2 || anlegen.isPending}
            className="px-5 py-3 rounded-xl bg-[#04B475] text-white font-bold text-base min-h-[56px] disabled:opacity-50"
          >
            {anlegen.isPending ? "…" : "Auftrag anlegen"}
          </button>
        </div>
      )}

      {liste.isLoading && <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Wird geladen…</p>}

      {liste.data && liste.data.length === 0 && (
        <div className="text-center py-16 text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
          Noch kein Auftrag angelegt.
        </div>
      )}

      {liste.data && liste.data.length > 0 && (
        <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] overflow-hidden divide-y divide-[#ced4da] dark:divide-[#3e4042]">
          {liste.data.map((a) => {
            const st = STATUS_TEXT[a.status];
            return (
              <Link key={a.id} href={`/admin/schrott/${a.id}`}
                className="flex items-center gap-4 px-5 py-4 flex-wrap hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]/40 transition-colors">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{a.bezeichnung}</div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    {new Date(a.datum).toLocaleDateString("de-DE")} · angelegt von {a.erstelltVon}
                  </div>
                </div>
                <span className={`text-xs font-black px-3 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] tabular-nums">
                  <b className="text-[#1a1a1a] dark:text-[#e4e6eb]">{a.collis}</b> Stellplätze ·{" "}
                  {a.brutto.toLocaleString("de-DE")} kg brutto ·{" "}
                  {a.netto.toLocaleString("de-DE")} kg netto
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
