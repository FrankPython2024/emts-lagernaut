"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePermissions } from "@/hooks/usePermissions";
import { TypBadge } from "@/components/pickup/ModusBanner";
import { api } from "@/trpc/react";
import { wartendeAuftraege } from "@/lib/pickup/scanAuswertung";

function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function PickupHomePage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfPick = has("PICKUP_PICK");
  const { data, isLoading } = api.pickup.offeneAuftraege.useQuery(undefined, { enabled: !permsLoading && darfPick });
  // Scans, die auf diesem Gerät noch nicht gespeichert sind (Scan-Seite verlassen,
  // während das WLAN weg war). Sie liegen sicher im Gerät, gehen aber erst beim
  // Öffnen ihres Auftrags raus — deshalb hier unübersehbar.
  const [wartend, setWartend] = useState<{ auftragId: number; anzahl: number }[]>([]);
  useEffect(() => { setWartend(wartendeAuftraege()); }, []);

  if (permsLoading) {
    return <div className="py-16 text-center text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfPick) {
    return (
      <div className="py-16 text-center text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff auf die Scan-Ansicht. Bitte das Recht <strong className="mx-1">PICKUP_PICK</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">Offene Aufträge</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">Auftrag antippen, um mit dem Scannen zu beginnen.</p>
      </div>

      {wartend.map((w) => {
        const name = data?.find((a) => a.id === w.auftragId)?.name ?? `Auftrag #${w.auftragId}`;
        return (
          <Link
            key={w.auftragId}
            href={`/pickup/${w.auftragId}`}
            role="alert"
            className="flex items-center gap-3 rounded-2xl border-2 px-4 py-3 min-h-[56px]"
            style={{ borderColor: "#BA7517", background: "rgba(186,117,23,0.12)" }}
          >
            <span className="text-2xl" aria-hidden>⏳</span>
            <span className="text-base font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
              {w.anzahl} {w.anzahl === 1 ? "Scan" : "Scans"} von „{name}" noch nicht gespeichert. Hier antippen, dann gehen sie raus.
            </span>
          </Link>
        );
      })}

      {isLoading ? (
        <div className="py-16 text-center text-[#65676b] dark:text-[#b0b3b8]">Lade Aufträge…</div>
      ) : !data || data.length === 0 ? (
        <div className="text-center py-16 text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
          Aktuell keine offenen Aufträge.
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((a) => {
            const pct = a.gesamt > 0 ? Math.round((a.gefunden / a.gesamt) * 100) : 0;
            return (
              <Link
                key={a.id}
                href={`/pickup/${a.id}`}
                className="block bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 hover:border-[#008BD2] hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-[#008BD2]/40 min-h-[56px]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <TypBadge typ={a.typ} />
                    <h2 className="font-black text-xl text-[#202F61] dark:text-[#e4e6eb] truncate">{a.name}</h2>
                  </div>
                  <span className="text-base font-black text-[#202F61] dark:text-[#e4e6eb] whitespace-nowrap">{a.gefunden}/{a.gesamt}</span>
                </div>
                {a.bemerkung && (
                  <div className="mt-1 text-sm text-[#008BD2] dark:text-[#45bdff] font-semibold truncate" title={a.bemerkung}>
                    📝 {a.bemerkung}
                  </div>
                )}
                <div className="h-3 w-full rounded-full bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden mt-3" role="progressbar" aria-valuenow={a.gefunden} aria-valuemin={0} aria-valuemax={a.gesamt}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "#04B475" }} />
                </div>
                <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-2">{fmtDatum(a.createdAt)}</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
