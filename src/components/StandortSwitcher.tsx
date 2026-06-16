"use client";
import { useStandortFilter } from "@/lib/standort/standortContext";
import { api } from "@/trpc/react";
import { useSession } from "next-auth/react";
import type { SessionUser } from "@/core/types";

export function StandortSwitcher() {
  const { data: session }                         = useSession();
  const { activeStandortId, setActiveStandortId } = useStandortFilter();
  const { data: standorte }                       = api.standort.zugaengliche.useQuery();

  const user = session?.user as SessionUser | undefined;
  if (!user)                return null;
  if (!standorte)           return null;
  // Bei genau einem Standort: kein Dropdown nötig
  if (standorte.length <= 1) return null;

  // „Alle Standorte"-Option nur für Wildcard-User (sonst Cross-Standort-Leak)
  const zeigeAlle = user.alleStandorte === true;

  return (
    <div className="px-3 py-1">
      <label className="block text-[11px] uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1 font-semibold select-none">
        Standort
      </label>
      <select
        value={activeStandortId ?? ""}
        onChange={(e) => setActiveStandortId(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full px-3 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm border border-transparent hover:border-gray-300 dark:hover:border-gray-700 focus:border-cyan-400 focus:outline-none transition min-h-[44px]"
      >
        {zeigeAlle && <option value="">Alle Standorte</option>}
        {standorte.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.kurzname})
          </option>
        ))}
      </select>
    </div>
  );
}
