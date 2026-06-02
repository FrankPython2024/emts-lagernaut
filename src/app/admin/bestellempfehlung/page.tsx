"use client";
import { useState, useMemo, useEffect, Fragment } from "react";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS } from "@/modules/realtime/events";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { relTime } from "@/lib/utils/relativeTime";
import { BestellungErfassenModal } from "@/components/bestellung/BestellungErfassenModal";
import type { SessionUser } from "@/core/types";

type Zeile = {
  key: string; modellId: number | null; modellName: string; hersteller: string | null;
  teiltyp: string; anzahlAnfragen: number; anzahlBestellt: number; anzahlOffen: number;
  letzteAnfrageDatum: Date | null; letzteBestellungDatum: Date | null;
};

type SortKey = "hersteller" | "modellName" | "teiltyp" | "anzahlAnfragen" | "anzahlBestellt" | "anzahlOffen" | "letzteAnfrageDatum";

function offenZelle(n: number) {
  const cls = n > 5
    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
    : n >= 1
      ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
      : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";
  return <span className={`inline-block min-w-[2rem] text-center text-xs font-black px-2 py-0.5 rounded-full ${cls}`}>{n}</span>;
}

// ── Bestell-Historie (aufgeklappte Zeile) ───────────────────────────────────────

function BestellHistorie({ modellName, hersteller, teiltyp, isAdmin }: { modellName: string; hersteller: string | null; teiltyp: string; isAdmin: boolean }) {
  const { show } = useToast();
  const utils = api.useUtils();
  const { data, isLoading } = api.bestellempfehlung.bestellungenZuKombination.useQuery({ modellName, teiltyp });

  const [editId,   setEditId]   = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const loeschen = api.bestellempfehlung.bestellungLoeschen.useMutation({
    onSuccess: () => {
      show("Bestellung gelöscht", "success");
      setDeleteId(null);
      void utils.bestellempfehlung.bestellungenZuKombination.invalidate({ modellName, teiltyp });
      void utils.bestellempfehlung.list.invalidate();
      void utils.bestellempfehlung.top5.invalidate();
    },
    onError: (e) => show(e.message, "error"),
  });

  const editExisting = data?.find(b => b.id === editId);

  return (
    <div className="px-5 py-3 bg-[#f0f2f5] dark:bg-[#18191a]">
      <div className="text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-2">Bestell-Historie</div>
      {isLoading && <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lädt…</p>}
      {data && data.length === 0 && <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Noch keine Bestellung erfasst.</p>}
      {data && data.length > 0 && (
        <ul className="space-y-1.5">
          {data.map((b) => (
            <li key={b.id} className="flex items-start gap-3 px-3 py-2 bg-white dark:bg-[#242526] rounded-lg border border-[#ced4da] dark:border-[#3e4042]">
              <span className="text-sm font-black text-[#0064d2] dark:text-[#45bdff] tabular-nums whitespace-nowrap">{b.anzahl}×</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {new Date(b.bestelltAm).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  <span className="text-[#65676b] dark:text-[#b0b3b8]"> · erfasst von {b.user?.name ?? b.erstelltVon}</span>
                </div>
                {b.notiz && <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5 whitespace-pre-wrap">{b.notiz}</div>}
              </div>
              {isAdmin && (
                <div className="flex gap-1 flex-shrink-0">
                  {deleteId === b.id ? (
                    <>
                      <button onClick={() => loeschen.mutate({ id: b.id })} disabled={loeschen.isPending}
                        className="px-2 py-1 text-xs bg-[#fa3e3e] text-white rounded font-bold disabled:opacity-50">Löschen?</button>
                      <button onClick={() => setDeleteId(null)} className="px-2 py-1 text-xs text-[#65676b] rounded">✕</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setEditId(b.id)} aria-label="Bearbeiten"
                        className="px-2 py-1 text-xs bg-[#0064d2]/10 text-[#0064d2] rounded hover:bg-[#0064d2]/20 font-bold">✏️</button>
                      <button onClick={() => setDeleteId(b.id)} aria-label="Löschen"
                        className="px-2 py-1 text-xs bg-[#fa3e3e]/10 text-[#fa3e3e] rounded hover:bg-[#fa3e3e]/20 font-bold">🗑️</button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editExisting && (
        <BestellungErfassenModal
          modellName={modellName} hersteller={hersteller} teiltyp={teiltyp}
          existing={{ id: editExisting.id, anzahl: editExisting.anzahl, bestelltAm: editExisting.bestelltAm, notiz: editExisting.notiz }}
          onClose={() => setEditId(null)}
          onSaved={() => {
            void utils.bestellempfehlung.bestellungenZuKombination.invalidate({ modellName, teiltyp });
            void utils.bestellempfehlung.list.invalidate();
            void utils.bestellempfehlung.top5.invalidate();
          }}
        />
      )}
    </div>
  );
}

// ── Hauptseite ───────────────────────────────────────────────────────────────

export default function BestellempfehlungPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as SessionUser | undefined)?.rolle === "ADMIN";
  const { on, off } = useSocket();
  const utils = api.useUtils();

  const [nurOffen,  setNurOffen]  = useState(true);
  const [sortKey,   setSortKey]   = useState<SortKey>("anzahlOffen");
  const [sortDir,   setSortDir]   = useState<"asc" | "desc">("desc");
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [modalCombo, setModalCombo] = useState<{ modellName: string; hersteller: string | null; teiltyp: string } | null>(null);

  const { data, isLoading, error } = api.bestellempfehlung.list.useQuery({ nurOffen });

  // Live-Update: andere Admins erfassen/ändern/löschen
  useEffect(() => {
    const refresh = () => {
      void utils.bestellempfehlung.list.invalidate();
      void utils.bestellempfehlung.top5.invalidate();
    };
    on(EVENTS.BESTELLUNG_ERFASST,      refresh);
    on(EVENTS.BESTELLUNG_AKTUALISIERT, refresh);
    on(EVENTS.BESTELLUNG_GELOESCHT,    refresh);
    return () => {
      off(EVENTS.BESTELLUNG_ERFASST);
      off(EVENTS.BESTELLUNG_AKTUALISIERT);
      off(EVENTS.BESTELLUNG_GELOESCHT);
    };
  }, [on, off, utils]);

  const sorted = useMemo(() => {
    const rows = [...((data ?? []) as Zeile[])];
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let av: number | string; let bv: number | string;
      switch (sortKey) {
        case "hersteller": av = a.hersteller ?? ""; bv = b.hersteller ?? ""; break;
        case "modellName": av = a.modellName;       bv = b.modellName;       break;
        case "teiltyp":    av = a.teiltyp;           bv = b.teiltyp;          break;
        case "letzteAnfrageDatum": av = a.letzteAnfrageDatum?.getTime() ?? 0; bv = b.letzteAnfrageDatum?.getTime() ?? 0; break;
        default:           av = a[sortKey];          bv = b[sortKey];         break;
      }
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "modellName" || k === "hersteller" || k === "teiltyp" ? "asc" : "desc"); }
  }

  const Th = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] cursor-pointer select-none hover:text-[#0064d2] ${right ? "text-right" : "text-left"}`}
    >
      {label}{sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  if (isLoading) return <PageLoader />;
  if (error) return <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">Fehler: {error.message}</div>;

  return (
    <div className="space-y-5">
      {/* Kopf */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Bestell-Empfehlungen</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Welche Ersatzteile als „nicht verfügbar" gemeldet und noch nicht extern nachbestellt wurden — offen = Anfragen minus erfasste Bestellungen.
          </p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-[#ced4da] dark:border-[#3e4042]">
          <button onClick={() => setNurOffen(false)}
            className={`px-4 py-2.5 text-xs font-bold transition-colors min-h-[44px] ${!nurOffen ? "bg-[#0064d2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}>
            Alle anzeigen
          </button>
          <button onClick={() => setNurOffen(true)}
            className={`px-4 py-2.5 text-xs font-bold border-l border-[#ced4da] dark:border-[#3e4042] transition-colors min-h-[44px] ${nurOffen ? "bg-[#0064d2] text-white" : "bg-white dark:bg-[#242526] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}>
            Nur offene
          </button>
        </div>
      </div>

      {/* Tabelle */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-[#ced4da] dark:border-[#3e4042]">
            <tr>
              <Th k="hersteller" label="Hersteller" />
              <Th k="modellName" label="Modell" />
              <Th k="teiltyp" label="Teiltyp" />
              <Th k="anzahlAnfragen" label="Anfragen" right />
              <Th k="anzahlBestellt" label="Bestellt" right />
              <Th k="anzahlOffen" label="Offen" right />
              <Th k="letzteAnfrageDatum" label="Letzte Anfrage" />
              {isAdmin && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
            {sorted.map((z) => {
              const isOpen = expanded === z.key;
              return (
                <Fragment key={z.key}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : z.key)}
                    className="cursor-pointer hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
                  >
                    <td className="px-3 py-2.5 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{z.hersteller ?? "—"}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{z.modellName}</td>
                    <td className="px-3 py-2.5 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{z.teiltyp}</td>
                    <td className="px-3 py-2.5 text-sm text-right tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]">{z.anzahlAnfragen}</td>
                    <td className="px-3 py-2.5 text-sm text-right tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]">{z.anzahlBestellt}</td>
                    <td className="px-3 py-2.5 text-right">{offenZelle(z.anzahlOffen)}</td>
                    <td className="px-3 py-2.5 text-sm text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">
                      {z.letzteAnfrageDatum ? relTime(z.letzteAnfrageDatum) : "—"}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setModalCombo({ modellName: z.modellName, hersteller: z.hersteller, teiltyp: z.teiltyp })}
                          className="px-3 py-1.5 bg-[#0064d2] text-white text-xs font-bold rounded-lg hover:bg-[#0056b3] transition-colors whitespace-nowrap"
                        >
                          + Bestellung erfassen
                        </button>
                      </td>
                    )}
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={isAdmin ? 8 : 7} className="p-0">
                        <BestellHistorie modellName={z.modellName} hersteller={z.hersteller} teiltyp={z.teiltyp} isAdmin={isAdmin} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={isAdmin ? 8 : 7} className="px-3 py-12 text-center text-[#65676b] dark:text-[#b0b3b8]">
                {nurOffen ? "Keine offenen Bestellempfehlungen 🎉" : "Keine NICHT_VERFÜGBAR-Anfragen vorhanden."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalCombo && (
        <BestellungErfassenModal
          modellName={modalCombo.modellName} hersteller={modalCombo.hersteller} teiltyp={modalCombo.teiltyp}
          onClose={() => setModalCombo(null)}
          onSaved={() => {
            void utils.bestellempfehlung.list.invalidate();
            void utils.bestellempfehlung.top5.invalidate();
          }}
        />
      )}
    </div>
  );
}
