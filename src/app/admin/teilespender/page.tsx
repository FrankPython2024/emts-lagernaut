"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { STANDARD_TEILTYPEN } from "@/lib/constants/teiltypen";
import { formatLogId } from "@/lib/pickup/logId";

// ── Teilespender — „Wo steckt mein Teil noch drin?" ──────────────────────────
//
// Ersatzteile in Geräten finden, die es nicht in den Verkauf geschafft haben.
// Modell und Teiltyp wählen → Liste mit Fundort in Laufreihenfolge → daraus
// direkt ein Pickup-Auftrag.
//
// ⚠️ Die Seite verspricht bewusst NICHT, dass das Teil heil ist. Grundlage ist
// das ReForm-Feld „Defekte": Steht dort nichts zu diesem Teil, ist das ein
// Negativbeleg — ein guter Kandidat, keine Prüfung. Die Beschriftungen müssen
// das aushalten; wer sie ändert, muss diesen Unterschied mittragen.

const eingabe =
  "w-full px-3 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] " +
  "bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none " +
  "focus:border-[#0064d2] min-h-[48px]";
const label = "block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1";
const karte =
  "bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4";

function TeilespenderPageInner() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen = has("TEILESPENDER_VIEW");
  const darfPickup = has("PICKUP_MANAGE");
  const { show } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [modellSuche, setModellSuche] = useState("");
  const [modellKey, setModellKey] = useState<string | null>(null);
  const [modellName, setModellName] = useState("");
  const [teiltyp, setTeiltyp] = useState("");
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [pickupOffen, setPickupOffen] = useState(false);
  const [auftragName, setAuftragName] = useState("");
  const [meldeLogId, setMeldeLogId] = useState<string | null>(null);

  // Vorbelegung über die Adresszeile: ?geraet=Lenovo%20ThinkPad%20T580&teil=Tastatur
  // Damit genügt später ein Klick aus einer offenen Anfrage heraus — der Weg
  // „Anfrage lesen, Seite suchen, Modell abtippen" fällt weg.
  const geraetParam = searchParams?.get("geraet") ?? null;
  const teilParam = searchParams?.get("teil") ?? null;
  const vorbelegung = api.teilespender.schluessel.useQuery(
    { geraeteName: geraetParam ?? "" },
    { enabled: darfSehen && Boolean(geraetParam) },
  );
  useEffect(() => {
    if (geraetParam && vorbelegung.data?.modellKey) {
      setModellKey(vorbelegung.data.modellKey);
      setModellName(geraetParam);
    }
  }, [geraetParam, vorbelegung.data?.modellKey]);
  useEffect(() => {
    if (teilParam) setTeiltyp(teilParam);
  }, [teilParam]);

  const stand = api.teilespender.stand.useQuery(undefined, { enabled: darfSehen });
  const modelle = api.teilespender.modelle.useQuery(
    { suche: modellSuche.trim() },
    { enabled: darfSehen && modellSuche.trim().length >= 2 },
  );

  const suchbereit = Boolean(modellKey && teiltyp);
  const treffer = api.teilespender.suche.useQuery(
    { modellKey: modellKey ?? "", teiltyp },
    { enabled: darfSehen && suchbereit },
  );

  const pickupErstellen = api.pickup.erstellen.useMutation();
  const entnahmeMelden = api.teilespender.entnahmeMelden.useMutation();

  const liste = treffer.data?.treffer ?? [];
  const aussortiert = treffer.data?.aussortiert;

  const alleGewaehlt = liste.length > 0 && liste.every((t) => gewaehlt.has(t.logId));

  function umschalten(logId: string): void {
    setGewaehlt((prev) => {
      const n = new Set(prev);
      if (n.has(logId)) n.delete(logId);
      else n.add(logId);
      return n;
    });
  }

  function alleUmschalten(): void {
    setGewaehlt(alleGewaehlt ? new Set() : new Set(liste.map((t) => t.logId)));
  }

  function modellWaehlen(key: string, name: string): void {
    setModellKey(key);
    setModellName(name);
    setModellSuche("");
    setGewaehlt(new Set());
  }

  const gewaehlteTreffer = useMemo(
    () => liste.filter((t) => gewaehlt.has(t.logId)),
    [liste, gewaehlt],
  );

  async function pickupAnlegen(): Promise<void> {
    if (gewaehlteTreffer.length === 0) return;
    try {
      const { id } = await pickupErstellen.mutateAsync({
        name: auftragName.trim() || `${teiltyp} für ${modellName}`,
        typ: "LOGID",
        bemerkung: `Teilespender-Suche: ${teiltyp} für ${modellName}`,
        positionen: gewaehlteTreffer.map((t) => ({
          logId: t.logId,
          colli: t.colli ?? undefined,
          stellplatz: t.stellplatz ?? undefined,
          bezeichnung: t.bezeichnung ?? undefined,
        })),
      });
      setPickupOffen(false);
      setGewaehlt(new Set());
      show(`Pickup-Auftrag mit ${gewaehlteTreffer.length} Geräten angelegt`, "success");
      router.push(`/admin/pickup/${id}`);
    } catch (e) {
      show(e instanceof Error ? e.message : "Auftrag konnte nicht angelegt werden", "error");
    }
  }

  async function alsWegMelden(logId: string): Promise<void> {
    try {
      await entnahmeMelden.mutateAsync({ logId, teiltyp, art: "NICHT_VORHANDEN" });
      show("Vermerkt — dieses Gerät erscheint für dieses Teil nicht mehr", "success");
      setMeldeLogId(null);
      await treffer.refetch();
    } catch (e) {
      show(e instanceof Error ? e.message : "Konnte nicht vermerkt werden", "error");
    }
  }

  if (permsLoading) return <div className="p-6 text-[#65676b]">Lädt…</div>;
  if (!darfSehen) {
    return (
      <div className="p-6">
        <div className="bg-[#fff3cd] dark:bg-[#3d3016] border border-[#ffe69c] dark:border-[#665012] rounded-xl p-4 text-[#664d03] dark:text-[#ffda6a]">
          Für diese Seite fehlt das Recht <strong>TEILESPENDER_VIEW</strong>.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="🔍 Teilespender"
        subtitle="Wo steckt mein Teil noch drin?"
        breadcrumb={[{ label: "Verwaltung", href: "/admin" }, { label: "Teilespender" }]}
      />

      {/* ── Stand ───────────────────────────────────────────────────────── */}
      {stand.data && (
        <div className="flex flex-wrap gap-3 mb-6 text-sm">
          <span className={`${karte} py-2 px-3`}>
            <strong>{stand.data.freigegeben.toLocaleString("de-DE")}</strong> Geräte zum Zerlegen
            freigegeben
          </span>
          <span className={`${karte} py-2 px-3`}>
            <strong>{stand.data.modelle.toLocaleString("de-DE")}</strong> verschiedene Modelle
          </span>
          {stand.data.letzterImport && (
            <span className={`${karte} py-2 px-3 text-[#65676b] dark:text-[#b0b3b8]`}>
              Stand:{" "}
              {new Date(stand.data.letzterImport.importiertAm).toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </span>
          )}
        </div>
      )}

      {stand.data && stand.data.gesamt === 0 && (
        <div className="bg-[#fff3cd] dark:bg-[#3d3016] border border-[#ffe69c] dark:border-[#665012] rounded-xl p-4 mb-6 text-[#664d03] dark:text-[#ffda6a]">
          Es sind noch keine Verwertungsgeräte importiert. Der ReForm-Export gehört auf{" "}
          <a href="/admin/teilespender/import" className="underline font-semibold">
            Teilespender → Import
          </a>
          .
        </div>
      )}

      {/* ── Auswahl ─────────────────────────────────────────────────────── */}
      <div className={`${karte} mb-6`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="relative">
            <label className={label} htmlFor="ts-modell">
              1. Für welches Gerät?
            </label>
            {modellKey ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2.5 rounded-lg bg-[#e7f0fd] dark:bg-[#11243d] text-[#0064d2] dark:text-[#45bdff] font-semibold min-h-[48px] flex items-center">
                  {modellName}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setModellKey(null);
                    setModellName("");
                    setGewaehlt(new Set());
                  }}
                  className="px-3 min-h-[48px] rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"
                >
                  Ändern
                </button>
              </div>
            ) : (
              <>
                <input
                  id="ts-modell"
                  className={eingabe}
                  value={modellSuche}
                  onChange={(e) => setModellSuche(e.target.value)}
                  placeholder="Modell suchen, z. B. ThinkPad L14"
                  autoComplete="off"
                />
                {modellSuche.trim().length >= 2 && (
                  <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] shadow-lg">
                    {modelle.isLoading && <div className="px-3 py-2 text-sm text-[#65676b]">Sucht…</div>}
                    {!modelle.isLoading && (modelle.data ?? []).length === 0 && (
                      <div className="px-3 py-2 text-sm text-[#65676b]">Kein Modell gefunden</div>
                    )}
                    {(modelle.data ?? []).slice(0, 40).map((m) => (
                      <button
                        key={m.modellKey}
                        type="button"
                        onClick={() => modellWaehlen(m.modellKey, m.name)}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c] flex justify-between gap-3 min-h-[44px]"
                      >
                        <span className="truncate">{m.name}</span>
                        <span className="text-[#65676b] dark:text-[#b0b3b8] shrink-0">
                          {m.anzahl} Geräte
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className={label} htmlFor="ts-teiltyp">
              2. Welches Teil?
            </label>
            <select
              id="ts-teiltyp"
              className={eingabe}
              value={teiltyp}
              onChange={(e) => {
                setTeiltyp(e.target.value);
                setGewaehlt(new Set());
              }}
            >
              <option value="">Bitte wählen…</option>
              {STANDARD_TEILTYPEN.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.icon} {t.label}
                </option>
              ))}
              <option value="Thermalmodul">🌡️ Thermalmodul</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Ergebnis ────────────────────────────────────────────────────── */}
      {!suchbereit && (
        <p className="text-[#65676b] dark:text-[#b0b3b8]">
          Gerät und Teil wählen — dann steht hier, in welchen Geräten das Teil vermutlich noch
          steckt und wo sie stehen.
        </p>
      )}

      {suchbereit && treffer.isLoading && (
        <p className="text-[#65676b] dark:text-[#b0b3b8]">Sucht…</p>
      )}

      {suchbereit && !treffer.isLoading && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
              {liste.length === 0
                ? "Kein Spendergerät gefunden"
                : `${liste.length} ${liste.length === 1 ? "Gerät" : "Geräte"} — sortiert nach Laufweg`}
            </h2>
            {liste.length > 0 && darfPickup && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={alleUmschalten}
                  className="px-4 min-h-[44px] rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb]"
                >
                  {alleGewaehlt ? "Auswahl aufheben" : "Alle wählen"}
                </button>
                <button
                  type="button"
                  disabled={gewaehlt.size === 0}
                  onClick={() => {
                    setAuftragName(`${teiltyp} für ${modellName}`);
                    setPickupOffen(true);
                  }}
                  className="px-4 min-h-[44px] rounded-lg bg-[#04B475] text-white font-semibold disabled:opacity-40"
                >
                  📦 Pickup-Auftrag ({gewaehlt.size})
                </button>
              </div>
            )}
          </div>

          {/* Ehrlichkeit über die Datenlage — bewusst prominent, nicht im Kleingedruckten. */}
          {liste.length > 0 && (
            <div className="bg-[#e7f0fd] dark:bg-[#11243d] border border-[#b6d4fe] dark:border-[#1c3a5c] rounded-xl p-3 mb-4 text-sm text-[#0a4275] dark:text-[#9ec5fe]">
              In ReForm ist an diesen Geräten <strong>kein Defekt an diesem Teil vermerkt</strong>.
              Das heißt „gute Chance", nicht „geprüft in Ordnung" — nachsehen bleibt nötig.
            </div>
          )}

          {aussortiert && liste.length === 0 && (
            <div className={`${karte} text-sm text-[#65676b] dark:text-[#b0b3b8]`}>
              <p className="mb-2">
                Zu diesem Modell gibt es keinen brauchbaren Spender. Aufgeschlüsselt:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>{aussortiert.teilDefekt} × genau dieses Teil ist defekt oder fehlt</li>
                <li>{aussortiert.totalschaden} × Totalschaden / ausgeschlachtet</li>
                <li>{aussortiert.nichtFreigegeben} × noch nicht zur Verwertung freigegeben</li>
                <li>{aussortiert.bereitsEntnommen} × Teil ist bereits heraus</li>
              </ul>
            </div>
          )}

          <div className="space-y-2">
            {liste.map((t) => (
              <div
                key={t.logId}
                className={`${karte} flex flex-wrap items-start gap-3 ${
                  gewaehlt.has(t.logId) ? "ring-2 ring-[#0064d2]" : ""
                }`}
              >
                {darfPickup && (
                  <input
                    type="checkbox"
                    checked={gewaehlt.has(t.logId)}
                    onChange={() => umschalten(t.logId)}
                    aria-label={`Gerät ${formatLogId(t.logId)} für Pickup wählen`}
                    className="mt-1 w-6 h-6 shrink-0 accent-[#0064d2]"
                  />
                )}

                <div className="flex-1 min-w-[220px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                      {formatLogId(t.logId)}
                    </span>
                    {t.zustand && (
                      <span className="text-xs px-2 py-0.5 rounded bg-[#f0f2f5] dark:bg-[#3a3b3c] text-[#65676b] dark:text-[#b0b3b8]">
                        Zustand {t.zustand}
                      </span>
                    )}
                    {t.sicherheit === "GEBRAUCHTSPUREN" && (
                      // Nicht nur über die Farbe — Status muss auch ohne Farbsehen lesbar sein.
                      <span className="text-xs px-2 py-0.5 rounded bg-[#fff3cd] dark:bg-[#3d3016] text-[#664d03] dark:text-[#ffda6a]">
                        ⚠ Gebrauchsspuren vermerkt
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
                    {t.bezeichnung}
                  </div>
                  {t.defekte.length > 0 && (
                    <details className="mt-1.5">
                      <summary className="text-xs text-[#65676b] dark:text-[#b0b3b8] cursor-pointer">
                        {t.defekte.length} andere{t.defekte.length === 1 ? "r" : ""} Defekt
                        {t.defekte.length === 1 ? "" : "e"} am Gerät
                      </summary>
                      <ul className="mt-1 text-xs text-[#65676b] dark:text-[#b0b3b8] list-disc pl-5">
                        {t.defekte.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>

                {/* Der Fundort — der eigentliche Grund für diese Seite. */}
                <div className="text-right shrink-0">
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Stellplatz</div>
                  <div className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {t.stellplatz ?? "—"}
                  </div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">Colli</div>
                  <div className="font-mono text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {t.colli ?? "—"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setMeldeLogId(t.logId)}
                  className="text-xs px-3 min-h-[44px] rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] shrink-0"
                >
                  Teil war weg
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Pickup anlegen ──────────────────────────────────────────────── */}
      <Modal open={pickupOffen} onClose={() => setPickupOffen(false)} title="Pickup-Auftrag anlegen">
        <div className="space-y-4">
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            {gewaehlteTreffer.length} {gewaehlteTreffer.length === 1 ? "Gerät" : "Geräte"} werden zum
            Holen aufgelistet.
          </p>
          <div>
            <label className={label} htmlFor="ts-auftrag">
              Name des Auftrags
            </label>
            <input
              id="ts-auftrag"
              className={eingabe}
              value={auftragName}
              onChange={(e) => setAuftragName(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPickupOffen(false)}
              className="px-4 min-h-[44px] rounded-lg border border-[#ced4da] dark:border-[#3e4042]"
            >
              Abbrechen
            </button>
            <button
              type="button"
              disabled={pickupErstellen.isPending}
              onClick={() => void pickupAnlegen()}
              className="px-4 min-h-[44px] rounded-lg bg-[#04B475] text-white font-semibold disabled:opacity-40"
            >
              {pickupErstellen.isPending ? "Legt an…" : "Auftrag anlegen"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── „Teil war weg" melden ───────────────────────────────────────── */}
      <Modal
        open={meldeLogId !== null}
        onClose={() => setMeldeLogId(null)}
        title="Teil war nicht mehr drin"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Gerät <strong>{meldeLogId ? formatLogId(meldeLogId) : ""}</strong> erscheint dann für{" "}
            <strong>{teiltyp}</strong> nicht mehr in der Suche. Andere Teile desselben Geräts bleiben
            sichtbar.
          </p>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
            Für ausgebaute Teile ist das nicht nötig: Wer über den Einlager-Assistenten bucht, wird
            automatisch erkannt.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMeldeLogId(null)}
              className="px-4 min-h-[44px] rounded-lg border border-[#ced4da] dark:border-[#3e4042]"
            >
              Abbrechen
            </button>
            <button
              type="button"
              disabled={entnahmeMelden.isPending}
              onClick={() => meldeLogId && void alsWegMelden(meldeLogId)}
              className="px-4 min-h-[44px] rounded-lg bg-[#202F61] text-white font-semibold disabled:opacity-40"
            >
              Vermerken
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function TeilespenderPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[#65676b] dark:text-[#b0b3b8]">Lädt…</div>}>
      <TeilespenderPageInner />
    </Suspense>
  );
}
