"use client";

// ── Pickup-Ordnung (Paket 4, 24.09.2026) ─────────────────────────────────────
//  • RestUebernehmenKnopf: offene Positionen in einen neuen Auftrag, alter wird
//    abgeschlossen (Server: pickup.restUebernehmen, Regel: lib/pickup/restAuftrag).
//  • UeberschneidungHinweis: welche Geräte stehen AUCH in anderen offenen Aufträgen?
//  • AngekommenHinweis: welche offenen Geräte stehen laut Lagerfuchs schon in der
//    Technik (TEC/ER/BTA/Vor-Rei)? Anlass: #168 am 24.09.2026, alle 239 offenen.
// Anlass: 1.339 LogIDs wurden nach einem Fehlversuch einfach neu angelegt, der alte
// Auftrag blieb oft offen — am 23.09.2026 standen 114 LogIDs gleichzeitig in #168
// und #183.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { formatLogId } from "@/lib/pickup/logId";

function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function RestUebernehmenKnopf({ auftragId, offen }: { auftragId: number; offen: number }) {
  const [auf, setAuf] = useState(false);
  if (offen === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAuf(true)}
        className="inline-flex items-center gap-2 px-4 rounded-xl border-2 border-[#BA7517] text-[#8A5A00] dark:text-[#f7b928] text-sm font-bold hover:bg-[#BA7517]/10 transition-colors min-h-[56px]"
      >
        ↪ Rest in neuen Auftrag ({offen})
      </button>
      {auf && <RestDialog auftragId={auftragId} onClose={() => setAuf(false)} />}
    </>
  );
}

function RestDialog({ auftragId, onClose }: { auftragId: number; onClose: () => void }) {
  const router = useRouter();
  const { show } = useToast();
  const utils = api.useUtils();
  const q = api.pickup.restVorschau.useQuery({ id: auftragId }, { staleTime: 0 });
  const [name, setName] = useState<string | null>(null);
  const [ohneAusgeschiedene, setOhneAusgeschiedene] = useState(true);
  const [ortAktualisieren, setOrtAktualisieren] = useState(true);

  const uebernehmen = api.pickup.restUebernehmen.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.anzahl} Geräte im neuen Auftrag${r.umgezogen ? ` · ${r.umgezogen} mit neuem Ort` : ""}${r.ausgelassen ? ` · ${r.ausgelassen} ausgeschiedene weggelassen` : ""}`, "success");
      void utils.pickup.liste.invalidate();
      router.push(`/admin/pickup/${r.id}`);
    },
    onError: (e) => show(e.message, "error"),
  });

  const d = q.data;
  const anzahl = d ? d.offen - d.angekommen - (ohneAusgeschiedene ? d.ausgeschieden : 0) : 0;
  const nameWert = name ?? d?.vorschlagName ?? "";

  return (
    <Modal open onClose={() => { if (!uebernehmen.isPending) onClose(); }} title="Rest in neuen Auftrag übernehmen">
      {q.isLoading || !d ? (
        <p className="text-base text-[#65676b] dark:text-[#b0b3b8]">{q.isError ? `Fehler: ${q.error.message}` : "Prüfe Lagerfuchs…"}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb]">
            <strong>{d.offen}</strong> {d.offen === 1 ? "Gerät ist" : "Geräte sind"} in „{d.name}" noch nicht gefunden.
            Sie kommen in einen neuen Auftrag{d.status === "offen" ? ", der alte wird dabei abgeschlossen" : ""}.
          </p>

          {d.typ === "LOGID" && (
            <div className="rounded-xl bg-[#f0f2f5] dark:bg-[#18191a] p-3 space-y-2 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              <div className="font-bold">
                Abgleich mit dem Lagerfuchs{d.lagerfuchsStand ? ` (Stand ${fmtDatum(d.lagerfuchsStand)})` : ""}:
              </div>
              <label className="flex items-start gap-2 min-h-[44px]">
                <input type="checkbox" className="mt-1 w-5 h-5" checked={ohneAusgeschiedene} onChange={(e) => setOhneAusgeschiedene(e.target.checked)} disabled={d.ausgeschieden === 0} />
                <span>
                  <strong>{d.ausgeschieden}</strong> {d.ausgeschieden === 1 ? "Gerät ist" : "Geräte sind"} seit dem alten Auftrag nicht mehr im Haus (ausgeschieden) —{" "}
                  {d.ausgeschieden === 0 ? "nichts wegzulassen." : "nicht übernehmen, da läuft niemand mehr hin."}
                </span>
              </label>
              <label className="flex items-start gap-2 min-h-[44px]">
                <input type="checkbox" className="mt-1 w-5 h-5" checked={ortAktualisieren} onChange={(e) => setOrtAktualisieren(e.target.checked)} disabled={d.umgezogen === 0} />
                <span>
                  <strong>{d.umgezogen}</strong> {d.umgezogen === 1 ? "Gerät ist" : "Geräte sind"} seitdem umgezogen —{" "}
                  {d.umgezogen === 0 ? "alle Orte stimmen noch." : "neuen Stellplatz und Colli übernehmen."}
                </span>
              </label>
              {d.angekommen > 0 && (
                <p className="font-semibold text-[#037A4F] dark:text-[#3ddc97]">
                  🏁 {d.angekommen} {d.angekommen === 1 ? "steht" : "stehen"} schon in der Technik
                  ({d.angekommenPlaetze.map((x) => `${x.platz} ${x.anzahl}`).join(" · ")}) — kommen nicht mit, die sind abgeholt.
                </p>
              )}
              {d.unbekannt > 0 && (
                <p className="text-[#65676b] dark:text-[#b0b3b8]">{d.unbekannt} nicht im Lagerfuchs — alter Ort bleibt.</p>
              )}
              {d.ausgeschiedenBeispiele.length > 0 && ohneAusgeschiedene && (
                <details className="text-[#65676b] dark:text-[#b0b3b8]">
                  <summary className="cursor-pointer min-h-[32px]">Welche sind ausgeschieden?</summary>
                  <ul className="mt-1 font-mono text-xs space-y-0.5">
                    {d.ausgeschiedenBeispiele.map((x) => (
                      <li key={x.logId}>{formatLogId(x.logId)}{x.seit ? ` · seit ${new Date(x.seit).toLocaleDateString("de-DE")}` : ""}</li>
                    ))}
                    {d.ausgeschieden > d.ausgeschiedenBeispiele.length && <li>… und {d.ausgeschieden - d.ausgeschiedenBeispiele.length} weitere</li>}
                  </ul>
                </details>
              )}
            </div>
          )}

          {anzahl === 0 && d.angekommen > 0 && (
            <p className="rounded-xl bg-[#04B475]/10 px-3 py-2 text-sm font-bold text-[#037A4F] dark:text-[#3ddc97]">
              Es bleibt nichts zum Suchen übrig. Auftrag einfach abschließen.
            </p>
          )}

          <div>
            <label htmlFor="rest-name" className="block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1">Name des neuen Auftrags</label>
            <input
              id="rest-name"
              value={nameWert}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className="w-full px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#202F61] dark:text-[#e4e6eb] text-base outline-none focus:border-[#008BD2] min-h-[56px]"
            />
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={uebernehmen.isPending}
              className="flex-1 text-sm font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl text-[#65676b] dark:text-[#b0b3b8] min-h-[56px] disabled:opacity-50">
              Abbrechen
            </button>
            <button
              type="button"
              disabled={uebernehmen.isPending || anzahl === 0 || !nameWert.trim()}
              onClick={() => uebernehmen.mutate({ id: auftragId, name: nameWert.trim(), ohneAusgeschiedene, ortAktualisieren })}
              className="flex-1 rounded-xl bg-[#BA7517] text-white text-sm font-black min-h-[56px] disabled:opacity-50"
            >
              {uebernehmen.isPending ? "Lege an…" : anzahl === 0 ? "Nichts zu übernehmen" : `${anzahl} ${anzahl === 1 ? "Gerät" : "Geräte"} übernehmen`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Welche offenen Geräte dieses Auftrags stehen AUCH in anderen offenen Aufträgen? */
export function UeberschneidungHinweis({ auftragId, logIds }: { auftragId: number; logIds: string[] }) {
  const q = api.pickup.bereitsOffen.useQuery({ logIds }, { enabled: logIds.length > 0 && logIds.length <= 5000 });
  const andere = useMemo(() => {
    const m = new Map<number, { name: string; anzahl: number }>();
    for (const t of q.data?.treffer ?? []) {
      if (t.auftragId === auftragId) continue;
      const e = m.get(t.auftragId) ?? { name: t.auftrag, anzahl: 0 };
      e.anzahl++;
      m.set(t.auftragId, e);
    }
    return [...m.entries()].sort((a, b) => b[1].anzahl - a[1].anzahl);
  }, [q.data, auftragId]);
  if (andere.length === 0) return null;
  return (
    <div role="status" className="rounded-xl border-2 border-[#BA7517] bg-[#BA7517]/10 px-4 py-3 text-sm text-[#1a1a1a] dark:text-[#e4e6eb] space-y-1">
      <div className="font-black text-[#8A5A00] dark:text-[#f7b928]">⚠ Geräte stehen auch in anderen offenen Aufträgen</div>
      <ul className="space-y-0.5">
        {andere.map(([id, a]) => (
          <li key={id}>
            <Link href={`/admin/pickup/${id}`} className="font-bold text-[#0064d2] dark:text-[#45bdff] hover:underline">#{id} {a.name}</Link>
            {" "}— {a.anzahl} {a.anzahl === 1 ? "Gerät" : "Geräte"}
          </li>
        ))}
      </ul>
      <p className="text-[#65676b] dark:text-[#b0b3b8]">Ist einer davon der alte Auftrag? Dann dort abschließen — sonst sucht jemand doppelt.</p>
    </div>
  );
}

/** Offene Geräte, die laut Lagerfuchs schon in der Technik stehen — Abschließen anbieten. */
export function AngekommenHinweis({ auftragId, offen }: { auftragId: number; offen: number }) {
  const { show } = useToast();
  const utils = api.useUtils();
  const q = api.pickup.angekommen.useQuery(undefined, { staleTime: 60_000 });
  const abschliessen = api.pickup.abschliessen.useMutation({
    onSuccess: () => {
      show("✅ Auftrag abgeschlossen", "success");
      void utils.pickup.details.invalidate({ id: auftragId });
      void utils.pickup.liste.invalidate();
      void utils.pickup.angekommen.invalidate();
    },
    onError: (e) => show(e.message, "error"),
  });
  const a = q.data?.find((x) => x.auftragId === auftragId);
  if (!a || a.angekommen === 0) return null;
  const alle = a.angekommen >= offen;
  return (
    <div role="status" className="rounded-xl border-2 border-[#04B475] bg-[#04B475]/10 px-4 py-3 text-sm text-[#1a1a1a] dark:text-[#e4e6eb] space-y-2">
      <div className="font-black text-[#037A4F] dark:text-[#3ddc97]">
        🏁 {alle ? `Alle ${offen} offenen Geräte stehen` : `${a.angekommen} von ${offen} offenen Geräten stehen`} laut Lagerfuchs schon in der Technik
      </div>
      <p>
        {a.plaetze.map((x) => `${x.platz}: ${x.anzahl}`).join(" · ")}. Sie wurden abgeholt, nur nicht in diesem Auftrag gescannt.
        {alle ? " Hier ist nichts mehr zu suchen." : " „Rest in neuen Auftrag“ lässt sie weg."}
      </p>
      {alle && (
        <button
          type="button"
          disabled={abschliessen.isPending}
          onClick={() => abschliessen.mutate({ id: auftragId })}
          className="px-5 rounded-xl bg-[#037A4F] text-white text-sm font-bold min-h-[48px] disabled:opacity-50"
        >
          {abschliessen.isPending ? "Schließe ab…" : "✓ Auftrag abschließen"}
        </button>
      )}
    </div>
  );
}
