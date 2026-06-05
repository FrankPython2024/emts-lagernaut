"use client";

import Link from "next/link";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";

type Auftrag = {
  id: number; name: string; bemerkung: string | null; status: string;
  createdAt: Date | string; abgeschlossenAm: Date | string | null;
  ersteller: string; gesamt: number; gefunden: number; offen: number;
};

function StatusBadge({ status }: { status: string }) {
  const offen = status === "offen";
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${offen
      ? "bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff]"
      : "bg-[#04B475]/10 text-[#04B475]"}`}>
      {offen ? "Offen" : "Abgeschlossen"}
    </span>
  );
}

function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function AuftragKarte({ a }: { a: Auftrag }) {
  const pct = a.gesamt > 0 ? Math.round((a.gefunden / a.gesamt) * 100) : 0;
  return (
    <Link
      href={`/admin/pickup/${a.id}`}
      className="block bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 hover:border-[#008BD2] hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-[#008BD2]/40"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="font-black text-[#202F61] dark:text-[#e4e6eb] truncate">{a.name}</h2>
        <StatusBadge status={a.status} />
      </div>
      {a.bemerkung ? (
        <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mb-3 truncate" title={a.bemerkung}>📝 {a.bemerkung}</div>
      ) : <div className="mb-3" />}
      <div className="mb-2">
        <div className="flex items-center justify-between text-xs font-semibold mb-1">
          <span className="text-[#65676b] dark:text-[#b0b3b8]">Gefunden</span>
          <span className="text-[#202F61] dark:text-[#e4e6eb]">{a.gefunden} / {a.gesamt}</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden" role="progressbar" aria-valuenow={a.gefunden} aria-valuemin={0} aria-valuemax={a.gesamt}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "#04B475" }} />
        </div>
      </div>
      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-3">
        {a.status === "abgeschlossen" && a.abgeschlossenAm
          ? `Abgeschlossen: ${fmtDatum(a.abgeschlossenAm)}`
          : `${fmtDatum(a.createdAt)} · ${a.ersteller}`}
      </div>
    </Link>
  );
}

export default function PickupListePage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfManage = has("PICKUP_MANAGE");
  const { data, isLoading } = api.pickup.liste.useQuery(undefined, { enabled: !permsLoading && darfManage });

  if (permsLoading) {
    return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfManage) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff auf Pickup. Bitte das Recht <strong>PICKUP_MANAGE</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  const offene        = (data ?? []).filter((a) => a.status === "offen");
  const abgeschlossene = (data ?? []).filter((a) => a.status === "abgeschlossen");
  const gridCls = "grid gap-3";
  const gridStyle = { gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" } as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">📦 Pickup</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Scan-/Sammel-Aufträge. Keine Umbuchung — die passiert in ReForm.
          </p>
        </div>
        <Link
          href="/admin/pickup/neu"
          className="inline-flex items-center gap-2 px-5 rounded-xl bg-[#008BD2] text-white text-sm font-bold hover:bg-[#0077b5] transition-colors shadow-sm min-h-[56px]"
        >
          ＋ Neuer Pickup-Auftrag
        </Link>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Aufträge…</div>
      ) : (
        <>
          {/* Offene Aufträge */}
          <section className="space-y-3">
            <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
              Offen <span className="text-[#008BD2] dark:text-[#45bdff]">({offene.length})</span>
            </h2>
            {offene.length === 0 ? (
              <div className="text-center py-10 text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
                Keine offenen Aufträge.
              </div>
            ) : (
              <div className={gridCls} style={gridStyle}>
                {offene.map((a) => <AuftragKarte key={a.id} a={a} />)}
              </div>
            )}
          </section>

          {/* Nachweis-Archiv */}
          {abgeschlossene.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
                Abgeschlossen — Nachweis-Archiv <span className="text-[#04B475]">({abgeschlossene.length})</span>
              </h2>
              <div className={gridCls} style={gridStyle}>
                {abgeschlossene.map((a) => <AuftragKarte key={a.id} a={a} />)}
              </div>
            </section>
          )}

          {offene.length === 0 && abgeschlossene.length === 0 && (
            <div className="text-center py-16 text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
              Noch keine Pickup-Aufträge. Oben rechts einen anlegen.
            </div>
          )}
        </>
      )}
    </div>
  );
}
