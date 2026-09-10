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
  // Entnahmen zu vermerken ist ein Schreibvorgang (nimmt ein Gerät für alle aus
  // der Liste) — deshalb ARTIKEL_EINLAGERN, nicht das Leserecht.
  const darfVermerken = has("ARTIKEL_EINLAGERN");
  const { show } = useToast();
  const router = useRouter();

  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  /** Filtert die Geräteliste — bei 90 Treffern findet man sonst nichts. */
  const [filter, setFilter] = useState("");

  const q = api.teilespender.fuerGruppe.useQuery(
    // zielLogId mitgeben: Das Gerät auf der Werkbank ist kein Spender für sich.
    { geraeteName, teiltypen, zielLogId: zielLogId ?? null },
    { enabled: open && teiltypen.length > 0 && geraeteName.trim().length > 0 },
  );
  const pickupErstellen = api.pickup.erstellen.useMutation();
  const entnahmeMelden = api.teilespender.entnahmeMeldenViele.useMutation();

  // Welcher Teiltyp soll beim Abhaken vermerkt werden? Bei genau einem
  // gesuchten Teil ist es eindeutig, sonst muss der Mensch es sagen.
  const [abhaken, setAbhaken] = useState<{ logId: string; deckt: string[] } | null>(null);

  async function alsEntnommenMelden(logId: string, teiltyp: string): Promise<void> {
    try {
      await entnahmeMelden.mutateAsync({ eintraege: [{ logId, teiltyp }], art: "ENTNOMMEN" });
      show(`${teiltyp} aus ${logId} vermerkt — erscheint dafür nicht mehr`, "success");
      setAbhaken(null);
      await q.refetch();
    } catch (e) {
      show(e instanceof Error ? e.message : "Konnte nicht vermerkt werden", "error");
    }
  }

  // Beim Schließen die Auswahl vergessen — sonst trägt das nächste Gerät die
  // Häkchen des vorigen und es entsteht ein Auftrag mit fremden LogIDs.
  useEffect(() => {
    if (!open) setGewaehlt(new Set());
  }, [open]);

  const geraete = q.data?.geraete ?? [];
  const proTeiltyp = q.data?.proTeiltyp ?? [];
  const frische = q.data?.frische;

  // ⚠️ Der Filter wirkt NUR auf die Anzeige. Auswahl, Vorschlag und
  // Pickup-Auftrag rechnen weiter mit der vollen Liste — sonst verschwände ein
  // angehaktes Gerät beim Tippen still aus dem Auftrag.
  const gefiltert = useMemo(() => {
    const roh = filter.trim().toLowerCase();
    if (!roh) return geraete;
    // Bei einer getippten LogID zählen nur die Ziffern: „508795" soll
    // „212.508.795" finden, ohne dass jemand Punkte mitschreibt.
    const nurZiffern = roh.replace(/\D/g, "");
    return geraete.filter((g) => {
      const felder = [g.logId, g.stellplatz ?? "", g.colli ?? "", g.bezeichnung ?? ""];
      if (felder.some((f) => f.toLowerCase().includes(roh))) return true;
      if (!nurZiffern) return false;
      return [g.logId, g.colli ?? ""].some((f) => f.replace(/\D/g, "").includes(nurZiffern));
    });
  }, [geraete, filter]);

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

            {/* Suchfeld — ab einer Handvoll Geräten ist Scrollen keine Option
                mehr. Sucht LogID (auch ohne Punkte), Stellplatz und Colli. */}
            <div className="flex items-center gap-2">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="LogID, Stellplatz oder Colli suchen…"
                aria-label="Geräteliste filtern"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[44px] text-sm"
              />
              {filter.trim() !== "" && (
                <button
                  type="button"
                  onClick={() => setFilter("")}
                  className="px-3 min-h-[44px] rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm text-[#65676b] dark:text-[#b0b3b8]"
                >
                  ✕ Filter
                </button>
              )}
            </div>
            {filter.trim() !== "" && (
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                {gefiltert.length} von {geraete.length} Geräten
                {/* Angehakte Geräte bleiben im Auftrag, auch wenn sie der Filter
                    gerade ausblendet — sonst verschwände die Auswahl unbemerkt. */}
                {gewaehlt.size > 0 && ` · ${gewaehlt.size} ausgewählt (bleibt erhalten)`}
              </p>
            )}

            <div className="space-y-2 max-h-[50vh] overflow-auto">
              {gefiltert.length === 0 && (
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] py-2">
                  Kein Gerät passt zu „{filter.trim()}".
                </p>
              )}
              {gefiltert.map((g) => (
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
                    {/* Teil ist schon heraus — nachtragen, ohne die Seite zu
                        wechseln. Deckt den Fall ab, dass jemand das Teil außerhalb
                        des Auslager-Dialogs geholt hat. */}
                    {darfVermerken && (
                      <button
                        type="button"
                        onClick={() =>
                          g.deckt.length === 1
                            ? void alsEntnommenMelden(g.logId, g.deckt[0]!)
                            : setAbhaken({ logId: g.logId, deckt: g.deckt })
                        }
                        disabled={entnahmeMelden.isPending}
                        className="mt-2 text-xs px-2 py-1.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] disabled:opacity-40 min-h-[36px]"
                      >
                        Teil ist raus
                      </button>
                    )}

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

      {/* Deckt das Gerät mehrere gesuchte Teile, muss gesagt werden, welches
          heraus ist — sonst verschwände es für alle auf einmal. */}
      {abhaken && (
        <div className="mt-4 p-3 rounded-xl bg-[#fff3cd] dark:bg-[#3d3016] border border-[#ffe69c] dark:border-[#665012]">
          <div className="text-sm font-semibold text-[#664d03] dark:text-[#ffda6a] mb-2">
            Welches Teil ist aus {abhaken.logId} heraus?
          </div>
          <div className="flex flex-wrap gap-1.5">
            {abhaken.deckt.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => void alsEntnommenMelden(abhaken.logId, t)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] min-h-[36px]"
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAbhaken(null)}
              className="px-3 py-1.5 rounded-lg text-xs text-[#65676b] dark:text-[#b0b3b8] min-h-[36px]"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
