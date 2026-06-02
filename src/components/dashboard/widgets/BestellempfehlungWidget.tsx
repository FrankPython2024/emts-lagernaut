"use client";
import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { WidgetSkeleton } from "@/components/dashboard/WidgetSkeleton";
import { BestellungErfassenModal } from "@/components/bestellung/BestellungErfassenModal";
import type { SessionUser } from "@/core/types";

type Combo = { modellName: string; hersteller: string | null; teiltyp: string };

/**
 * "Top Bestellempfehlungen" — Top 5 offene (Modell · Teiltyp)-Kombinationen aus
 * NICHT_VERFUEGBAR-Anfragen abzüglich erfasster externer Bestellungen.
 * Klick auf eine Zeile (nur ADMIN) öffnet das Erfassen-Modal vorausgewählt.
 */
export function BestellempfehlungWidget() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as SessionUser | undefined)?.rolle === "ADMIN";
  const utils = api.useUtils();

  const { data, isLoading, error } = api.bestellempfehlung.top5.useQuery(undefined, {
    staleTime: 60_000, refetchInterval: 120_000, refetchIntervalInBackground: false,
  });

  const [modalCombo, setModalCombo] = useState<Combo | null>(null);

  function offenBadge(n: number) {
    return (
      <span className={`text-xs font-black px-2 py-0.5 rounded-full whitespace-nowrap ${
        n > 5
          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
          : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
      }`}>
        {n} offen
      </span>
    );
  }

  return (
    <WidgetCard
      title="Top Bestellempfehlungen"
      icon="🛒"
      action={
        <Link href="/admin/bestellempfehlung" className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline min-h-[32px] flex items-center">
          Alle anzeigen →
        </Link>
      }
    >
      {isLoading && <WidgetSkeleton />}
      {error && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && data.length === 0 && (
        <div className="text-center py-6 rounded-xl bg-gray-50 dark:bg-gray-800/40">
          <div className="text-2xl mb-1">✅</div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Alles abgedeckt — keine offenen Empfehlungen</p>
        </div>
      )}
      {data && data.length > 0 && (
        <ul className="space-y-1 -mx-1">
          {data.map((z) => {
            const inhalt = (
              <>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                    {z.hersteller ? `${z.hersteller} ` : ""}{z.modellName}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{z.teiltyp}</div>
                </div>
                {offenBadge(z.anzahlOffen)}
              </>
            );
            return (
              <li key={z.key}>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setModalCombo({ modellName: z.modellName, hersteller: z.hersteller, teiltyp: z.teiltyp })}
                    className="w-full flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                    title="Bestellung erfassen"
                  >
                    {inhalt}
                  </button>
                ) : (
                  <Link href="/admin/bestellempfehlung" className="w-full flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    {inhalt}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {modalCombo && (
        <BestellungErfassenModal
          modellName={modalCombo.modellName}
          hersteller={modalCombo.hersteller}
          teiltyp={modalCombo.teiltyp}
          onClose={() => setModalCombo(null)}
          onSaved={() => {
            void utils.bestellempfehlung.top5.invalidate();
            void utils.bestellempfehlung.list.invalidate();
          }}
        />
      )}
    </WidgetCard>
  );
}
