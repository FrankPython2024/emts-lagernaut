"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { usePermissions } from "@/hooks/usePermissions";
import { formatLogId } from "@/lib/pickup/logId";
import { waehleWenigsteWege, abgedeckteTeile } from "@/lib/teilespender/auswahl";
import { ortText } from "@/lib/teilespender/ort";

// ── Spender-Panel für eine Anfrage-Gruppe ────────────────────────────────────
//
// Öffnet sich aus der Anfragen-Liste heraus, vorbelegt mit dem angefragten
// Gerät und ALLEN offenen Teilen dieser Gruppe. Sortiert nach Abdeckung: Das
// Gerät, das die meisten der gesuchten Teile auf einmal hat, steht oben — sonst
// läuft jemand für drei Teile dreimal los.
//
// ⚠️ „Kein Defekt vermerkt" ist ein Negativbeleg aus ReForm, keine Prüfung. Das
// steht so auch im Panel und gehört dort hin, nicht ins Kleingedruckte.

type Props = {
  open: boolean;
  onClose: () => void;
  geraeteName: string;
  /** Die offenen Teiltypen dieser Gruppe. */
  teiltypen: string[];
  /** LogID des Zielgeräts — landet als Bezug im Pickup-Auftrag. */
  zielLogId?: string | null;
};

const karte =
  "bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-3";

export function SpenderPanel({ open, onClose, geraeteName, teiltypen, zielLogId }: Props) {
  const { has } = usePermissions();
  const darfPickup = has("PICKUP_MANAGE");
  const { show } = useToast();
  const router = useRouter();

  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());

  const q = api.teilespender.fuerGruppe.useQuery(
    { geraeteName, teiltypen },
    { enabled: open && teiltypen.length > 0 && geraeteName.trim().length > 0 },
  );
  const pickupErstellen = api.pickup.erstellen.useMutation();

  // Beim Schließen die Auswahl vergessen — sonst trägt das nächste Gerät die
  // Häkchen des vorigen und es entsteht ein Auftrag mit fremden LogIDs.
  useEffect(() => {
    if (!open) setGewaehlt(new Set());
  }, [open]);

  const geraete = q.data?.geraete ?? [];
  const proTeiltyp = q.data?.proTeiltyp ?? [];
  const frische = q.data?.frische;

  const gewaehlteGeraete = useMemo(
    () => geraete.filter((g) => gewaehlt.has(g.logId)),
    [geraete, gewaehlt],
  );

  /** Welche der gesuchten Teile deckt die aktuelle Auswahl zusammen ab? */
  const abgedeckt = useMemo(() => abgedeckteTeile(geraete, gewaehlt), [geraete, gewaehlt]);

  function umschalten(logId: string): void {
    setGewaehlt((prev) => {
      const n = new Set(prev);
      if (n.has(logId)) n.delete(logId);
      else n.add(logId);
      return n;
    });
  }

  /** Kleinste Auswahl, die möglichst viel abdeckt (geprüft in auswahl.ts). */
  function vorschlagen(): void {
    setGewaehlt(new Set(waehleWenigsteWege(geraete, teiltypen)));
  }

  async function pickupAnlegen(): Promise<void> {
    if (gewaehlteGeraete.length === 0) return;
    const bezug = zielLogId ? ` (für ${formatLogId(zielLogId.replace(/\D/g, ""))})` : "";
    try {
      const { id } = await pickupErstellen.mutateAsync({
        name: `Ersatzteile ${geraeteName}`.slice(0, 200),
        typ: "LOGID",
        bemerkung: `Teilespender für ${geraeteName}${bezug} · gesucht: ${teiltypen.join(", ")}`.slice(0, 2000),
        positionen: gewaehlteGeraete.map((g) => ({
          logId: g.logId,
          colli: g.colli ?? undefined,
          stellplatz: g.stellplatz ?? undefined,
          // Was aus diesem Gerät geholt werden soll — steht später auf der Liste.
          bezeichnung: `${g.bezeichnung ?? geraeteName} — entnehmen: ${g.deckt.join(", ")}`,
        })),
      });
      show(`Pickup-Auftrag mit ${gewaehlteGeraete.length} Geräten angelegt`, "success");
      onClose();
      router.push(`/admin/pickup/${id}`);
    } catch (e) {
      show(e instanceof Error ? e.message : "Auftrag konnte nicht angelegt werden", "error");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Teilespender · ${geraeteName}`} width="max-w-3xl">
      <div className="space-y-4">
        {/* ── Was wird gesucht, und gibt es das? ───────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {proTeiltyp.map((p) => (
            <span
              key={p.teiltyp}
              className={
                "text-sm px-2.5 py-1 rounded-lg font-semibold " +
                (p.anzahl === 0
                  ? "bg-[#ffe0e0] text-[#b3261e] dark:bg-[#3a1414] dark:text-[#ff8a8a]"
                  : p.deckung.reicht && !p.deckung.knapp
                    ? "bg-[#d9f7e6] text-[#00723f] dark:bg-[#10301f] dark:text-[#04B475]"
                    : "bg-[#fff3cd] text-[#664d03] dark:bg-[#3d3016] dark:text-[#ffda6a]")
              }
            >
              {/* Nicht nur über die Farbe — auch ohne Farbsehen lesbar. */}
              {p.anzahl === 0 ? "✕" : p.deckung.reicht && !p.deckung.knapp ? "✓" : "⚠"} {p.teiltyp}:{" "}
              {p.anzahl}
            </span>
          ))}
        </div>

        {/* ⚠️ Mehrere offene Anfragen können auf dieselben Geräte zeigen. Ein
            Notebook hat einen Akku — wer das nicht sieht, legt zwei Aufträge auf
            dasselbe Gerät an. */}
        {proTeiltyp.some((p) => p.deckung.text) && (
          <div className="bg-[#fff3cd] dark:bg-[#3d3016] border border-[#ffe69c] dark:border-[#665012] rounded-xl p-3 text-sm text-[#664d03] dark:text-[#ffda6a] space-y-1">
            {proTeiltyp
              .filter((p) => p.deckung.text)
              .map((p) => (
                <div key={p.teiltyp}>
                  <strong>{p.teiltyp}:</strong> {p.deckung.text}
                </div>
              ))}
          </div>
        )}

        {q.isLoading && <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Sucht…</p>}

        {!q.isLoading && geraete.length === 0 && (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Kein Verwertungsgerät dieses Modells hat eines der gesuchten Teile noch drin.
          </p>
        )}

        {geraete.length > 0 && (
          <>
            {/* Alter der Daten zuerst — wer gleich losläuft, muss wissen, worauf
                er sich verlässt. Der Export kommt von Hand aus ReForm. */}
            {frische?.warnen && (
              <div className="bg-[#fff3cd] dark:bg-[#3d3016] border border-[#ffe69c] dark:border-[#665012] rounded-xl p-3 text-sm text-[#664d03] dark:text-[#ffda6a] font-semibold">
                ⏳ {frische.text}
              </div>
            )}

            <div className="bg-[#e7f0fd] dark:bg-[#11243d] border border-[#b6d4fe] dark:border-[#1c3a5c] rounded-xl p-3 text-sm text-[#0a4275] dark:text-[#9ec5fe]">
              An diesen Geräten ist in ReForm <strong>kein Defekt am jeweiligen Teil vermerkt</strong>.
              Das heißt „gute Chance", nicht „geprüft in Ordnung".
              {frische && !frische.warnen && <> {frische.text}</>}
            </div>

            {darfPickup && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={vorschlagen}
                  className="px-4 min-h-[44px] rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] font-semibold"
                >
                  ✨ Wenigste Wege vorschlagen
                </button>
                <button
                  type="button"
                  disabled={gewaehlt.size === 0 || pickupErstellen.isPending}
                  onClick={() => void pickupAnlegen()}
                  className="px-4 min-h-[44px] rounded-lg bg-[#04B475] text-white font-semibold disabled:opacity-40"
                >
                  {pickupErstellen.isPending ? "Legt an…" : `📦 Pickup-Auftrag (${gewaehlt.size})`}
                </button>
                {gewaehlt.size > 0 && (
                  <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                    deckt {abgedeckt.size} von {teiltypen.length} Teilen
                  </span>
                )}
              </div>
            )}

            <div className="space-y-2 max-h-[50vh] overflow-auto">
              {geraete.map((g) => (
                <div
                  key={g.logId}
                  className={`${karte} flex flex-wrap items-start gap-3 ${
                    gewaehlt.has(g.logId) ? "ring-2 ring-[#0064d2]" : ""
                  }`}
                >
                  {darfPickup && (
                    <input
                      type="checkbox"
                      checked={gewaehlt.has(g.logId)}
                      onChange={() => umschalten(g.logId)}
                      aria-label={`Gerät ${formatLogId(g.logId.replace(/\D/g, ""))} für Pickup wählen`}
                      className="mt-1 w-6 h-6 shrink-0 accent-[#0064d2]"
                    />
                  )}

                  <div className="flex-1 min-w-[200px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                        {g.logId}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-[#e7f0fd] text-[#0064d2] dark:bg-[#11243d] dark:text-[#45bdff] font-semibold">
                        deckt {g.deckt.length} von {teiltypen.length}
                      </span>
                      {g.zustand && (
                        <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                          Zustand {g.zustand}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.deckt.map((t) => (
                        <span
                          key={t}
                          className={
                            "text-xs px-2 py-0.5 rounded " +
                            (g.mitSpuren.includes(t)
                              ? "bg-[#fff3cd] text-[#664d03] dark:bg-[#3d3016] dark:text-[#ffda6a]"
                              : "bg-[#f0f2f5] text-[#1a1a1a] dark:bg-[#3a3b3c] dark:text-[#e4e6eb]")
                          }
                        >
                          {g.mitSpuren.includes(t) ? `⚠ ${t} (Spuren)` : t}
                        </span>
                      ))}
                    </div>
                    {g.defekte.length > 0 && (
                      <details className="mt-1.5">
                        <summary className="text-xs text-[#65676b] dark:text-[#b0b3b8] cursor-pointer">
                          Vermerkte Defekte am Gerät ({g.defekte.length})
                        </summary>
                        <ul className="mt-1 text-xs text-[#65676b] dark:text-[#b0b3b8] list-disc pl-5">
                          {g.defekte.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>

                  <div className="text-right shrink-0 max-w-[230px]">
                    <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Stellplatz</div>
                    <div className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                      {g.stellplatz ?? "—"}
                    </div>
                    <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">Colli</div>
                    <div className="font-mono text-[#1a1a1a] dark:text-[#e4e6eb]">
                      {g.colli ?? "—"}
                    </div>
                    {/* Beide Ortsquellen widersprechen sich. Das gehört genannt,
                        nicht geglättet — sonst läuft jemand einmal umsonst und
                        traut der Liste beim nächsten Mal nicht mehr. */}
                    {g.ort?.abweichung && (
                      <div className="mt-1.5 text-xs text-[#664d03] dark:text-[#ffda6a] font-semibold text-right">
                        ⚠ Zweite Angabe:{" "}
                        <span className="font-mono font-normal">{ortText(g.ort.abweichung)}</span>
                        <div className="font-normal">
                          (
                          {g.ort.abweichung.quelle === "LAGERFUCHS" ? "Lagerfuchs" : "Verwertungs-Export"},{" "}
                          {new Date(g.ort.abweichung.standAm).toLocaleDateString("de-DE")})
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
