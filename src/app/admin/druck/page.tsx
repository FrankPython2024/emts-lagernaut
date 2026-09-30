"use client";

// ── 3D-Druck: Druckliste + Vorlagen (Paket 1, 24.09.2026) ────────────────────
// Druckliste = Nachfrage aus den Anfragen gegen Bestand und Vorlagen
// (Regel: src/lib/druck/druckliste.ts). Vorlagen = selbst konstruierte Teile
// mit Druckdatei, Foto und passenden Gerätemodellen.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { DruckerStatus } from "@/components/druck/DruckerStatus";
import { DruckenKnopf } from "@/components/druck/DruckenKnopf";
import { DruckAuswertung } from "@/components/druck/DruckAuswertung";
import { gruppiereNachHersteller, passtSuche } from "@/lib/druck/vorlagenFilter";

type Reiter = "liste" | "vorlagen" | "auswertung";
const REITER_KEY = "druck-reiter";

function fmtDauer(min: number | null): string | null {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

const karte = "bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm";
const knopfBlau = "inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-[#0064d2] text-white text-sm font-bold hover:bg-[#00509f] transition-colors min-h-[56px]";
const knopfRand = "inline-flex items-center justify-center gap-2 px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] text-sm font-bold hover:border-[#008BD2] transition-colors min-h-[56px]";
const chip = "inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold";

export default function DruckPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfLesen = has("ARTIKEL_VIEW");
  const darfPflegen = has("ARTIKEL_EDIT");
  const darfEinbuchen = has("ARTIKEL_EINLAGERN");
  const [reiter, setReiter] = useState<Reiter>("liste");
  const [suche, setSuche] = useState("");
  const [hersteller, setHersteller] = useState("Alle");
  useEffect(() => {
    try { const r = localStorage.getItem(REITER_KEY); if (r === "liste" || r === "vorlagen" || r === "auswertung") setReiter(r); } catch { /* egal */ }
  }, []);
  const wechsle = (r: Reiter) => { setReiter(r); try { localStorage.setItem(REITER_KEY, r); } catch { /* egal */ } };

  const vorlagen = api.druck.liste.useQuery(undefined, { enabled: !permsLoading && darfLesen });
  const liste = api.druck.druckliste.useQuery(undefined, { enabled: !permsLoading && darfLesen });

  if (permsLoading) return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  if (!darfLesen) return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Kein Zugriff (ARTIKEL_VIEW).</div>;

  // Neueste Druckdatei je Vorlage — für den Download-Knopf in der Druckliste.
  const druckDatei = new Map<number, { id: number; dateiname: string }>();
  const projektDatei = new Map<number, { id: number; dateiname: string }>();
  for (const v of vorlagen.data ?? []) {
    const d = v.dateien.find((x) => x.art === "DRUCK");
    if (d) druckDatei.set(v.id, d);
    const p = v.dateien.find((x) => x.art === "PROJEKT");
    if (p) projektDatei.set(v.id, p);
  }

  // Vorlagen: Suche + Hersteller (Wunsch Frank 30.09.2026). Chips zählen über alle,
  // bei „Alle" stehen die Hersteller als Abschnitte untereinander.
  const alleGruppen = gruppiereNachHersteller(vorlagen.data ?? []);
  const sichtbareGruppen = gruppiereNachHersteller((vorlagen.data ?? []).filter((v) => passtSuche(v, suche)))
    .filter((g) => hersteller === "Alle" || g.hersteller === hersteller);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">🖨️ 3D-Druck</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Druckvorlagen für Füße und Kleinteile. Die Druckliste zeigt, was gebraucht wird.
          </p>
        </div>
        {darfPflegen && <Link href="/admin/druck/neu" className={knopfBlau}>＋ Neue Vorlage</Link>}
      </div>

      <DruckerStatus />

      <div role="tablist" className="flex gap-2 flex-wrap">
        {([["liste", "📋 Druckliste"], ["vorlagen", `🗂️ Vorlagen${vorlagen.data ? ` (${vorlagen.data.length})` : ""}`], ["auswertung", "📊 Auswertung"]] as const).map(([r, text]) => (
          <button
            key={r}
            role="tab"
            id={`druck-reiter-${r}`}
            aria-controls="druck-reiter-inhalt"
            aria-selected={reiter === r}
            onClick={() => wechsle(r)}
            className={`px-4 rounded-xl text-sm font-bold min-h-[56px] transition-colors ${reiter === r
              ? "bg-[#202F61] text-white dark:bg-[#0064d2]"
              : "bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb]"}`}
          >
            {text}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="druck-reiter-inhalt" aria-labelledby={`druck-reiter-${reiter}`}>
      {reiter === "auswertung" ? (
        <DruckAuswertung darfPflegen={darfPflegen} />
      ) : reiter === "liste" ? (
        liste.isLoading ? (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Rechne Nachfrage…</p>
        ) : liste.isError ? (
          <p className="text-sm text-[#c01818] dark:text-[#ff6b6b]">Fehler: {liste.error.message} <button className="underline" onClick={() => void liste.refetch()}>Erneut versuchen</button></p>
        ) : liste.data && (
          <div className="space-y-6">
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
              Grundlage: Anfragen der letzten {liste.data.tage} Tage (ohne Storno und Test), offene Anfragen und Bestand.
              Ziel ist ein Vorrat für {liste.data.vorratTage} Tage.
              {liste.data.versorgt > 0 && <> · <strong>{liste.data.versorgt}</strong> mit Vorlage sind ausreichend auf Lager.</>}
            </p>

            <section className="space-y-3">
              <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
                🖨️ Jetzt drucken <span className="text-[#008BD2] dark:text-[#45bdff]">({liste.data.drucken.length})</span>
              </h2>
              {liste.data.drucken.length === 0 ? (
                <div className="text-center py-8 text-sm text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
                  {liste.data.anzahlVorlagen === 0
                    ? "Noch keine Vorlagen angelegt. Unten steht, wofür sich eine lohnt."
                    : "✓ Alles da, was mit den vorhandenen Vorlagen gedruckt werden kann."}
                </div>
              ) : (
                <div className="space-y-2">
                  {liste.data.drucken.map((z) => {
                    const d = druckDatei.get(z.vorlageId) ?? projektDatei.get(z.vorlageId);
                    const nurProjekt = !druckDatei.get(z.vorlageId);
                    return (
                      <div key={`${z.key}-${z.teiltyp}`} className={`${karte} p-4 flex items-center gap-4 flex-wrap`}>
                        <div className="min-w-0 flex-1">
                          <div className="font-black text-[#202F61] dark:text-[#e4e6eb]">{z.name} · {z.teiltyp}</div>
                          <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                            Bestand {z.bestand} · offen {z.offenStueck} · {z.stueck} Stück in 90 Tagen
                            {z.reichweiteTage != null && <> · reicht ~{z.reichweiteTage} Tage</>}
                          </div>
                          <Link href={`/admin/druck/${z.vorlageId}`} className="text-xs font-bold text-[#0064d2] dark:text-[#45bdff] hover:underline">
                            Vorlage: {z.vorlageName}
                          </Link>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-black text-[#8A5A00] dark:text-[#f7b928]">{z.fehlt} Stück</div>
                          {z.platten != null && <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8]">≈ {z.platten} {z.platten === 1 ? "Platte" : "Platten"}</div>}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {d ? (
                            <a href={`/api/druck/datei/${d.id}`} className={knopfBlau} title={d.dateiname}>{nurProjekt ? "⬇ Projekt (noch nicht geslict)" : "⬇ Druckdatei"}</a>
                          ) : (
                            <Link href={`/admin/druck/${z.vorlageId}`} className={knopfRand}>Datei fehlt</Link>
                          )}
                          {druckDatei.get(z.vorlageId) && (
                            <DruckenKnopf klein titel={z.vorlageName}
                              dateiId={druckDatei.get(z.vorlageId)!.id} dateiname={druckDatei.get(z.vorlageId)!.dateiname}
                              material={(vorlagen.data ?? []).find((v) => v.id === z.vorlageId)?.material} />
                          )}
                          {darfEinbuchen && <Link href={`/admin/druck/${z.vorlageId}#fertig`} className={knopfRand}>✓ Druck fertig</Link>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
                ✏️ Konstruieren lohnt sich <span className="text-[#008BD2] dark:text-[#45bdff]">({liste.data.konstruieren.length})</span>
              </h2>
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Gefragt, aber noch keine Vorlage (ab 2 Anfragen). Oben steht, was der Bestand nicht deckt.</p>
              {liste.data.konstruieren.length === 0 ? (
                <div className="text-center py-8 text-sm text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">Nichts offen.</div>
              ) : (
                <div className={`${karte} divide-y divide-[#ced4da] dark:divide-[#3e4042]`}>
                  {liste.data.konstruieren.map((z) => (
                    <div key={`${z.key}-${z.teiltyp}`} className="p-3 flex items-center gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[#202F61] dark:text-[#e4e6eb]">{z.name} · {z.teiltyp}</div>
                        <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                          {z.anfragen} Anfragen · {z.stueck} Stück in 90 Tagen
                          {z.offenStueck > 0 && <> · <strong className="text-[#8A5A00] dark:text-[#f7b928]">{z.offenStueck} offen</strong></>}
                          {z.bestand > 0 && <> · Bestand {z.bestand}</>}
                        </div>
                      </div>
                      <div className="text-right min-w-[110px]">
                        {z.fehlt > 0 ? (
                          <div className="text-lg font-black text-[#8A5A00] dark:text-[#f7b928]">{z.fehlt} fehlen</div>
                        ) : (
                          <div className="text-sm font-bold text-[#037A4F] dark:text-[#3ddc97]">
                            ✓ Bestand reicht{z.reichweiteTage != null && z.reichweiteTage < 3650 ? ` ~${z.reichweiteTage} T.` : ""}
                          </div>
                        )}
                      </div>
                      {darfPflegen && (
                        <Link
                          href={`/admin/druck/neu?key=${encodeURIComponent(z.key)}&anzeige=${encodeURIComponent(z.name)}&teiltyp=${encodeURIComponent(z.teiltyp)}`}
                          className={knopfRand}
                        >
                          ＋ Vorlage anlegen
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )
      ) : vorlagen.isLoading ? (
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Vorlagen…</p>
      ) : vorlagen.isError ? (
        <p className="text-sm text-[#c01818] dark:text-[#ff6b6b]">Fehler: {vorlagen.error.message}</p>
      ) : (vorlagen.data ?? []).length === 0 ? (
        <div className="text-center py-10 text-sm text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
          Noch keine Vorlagen. {darfPflegen && <Link href="/admin/druck/neu" className="font-bold text-[#008BD2]">Erste anlegen</Link>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="search"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              aria-label="Vorlagen durchsuchen"
              placeholder="Suchen: Gerät, Name, Teiltyp – z. B. „830 hinten“"
              className="flex-1 min-w-[240px] px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] text-base outline-none focus:border-[#008BD2] min-h-[56px]"
            />
            <div role="group" aria-label="Hersteller" className="flex flex-wrap gap-2">
              {[{ hersteller: "Alle", anzahl: (vorlagen.data ?? []).length }, ...alleGruppen.map((g) => ({ hersteller: g.hersteller, anzahl: g.vorlagen.length }))].map((h) => (
                <button
                  key={h.hersteller}
                  type="button"
                  aria-pressed={hersteller === h.hersteller}
                  onClick={() => setHersteller(h.hersteller)}
                  className={`px-4 rounded-xl text-sm font-bold min-h-[56px] border transition-colors ${hersteller === h.hersteller
                    ? "bg-[#202F61] text-white border-[#202F61] dark:bg-[#0064d2] dark:border-[#0064d2]"
                    : "bg-white dark:bg-[#242526] border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:border-[#008BD2]"}`}
                >
                  {h.hersteller} <span className="opacity-70">({h.anzahl})</span>
                </button>
              ))}
            </div>
          </div>

          {sichtbareGruppen.length === 0 ? (
            <div className="text-center py-8 text-sm text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
              Keine Vorlage passt{suche.trim() ? <> zu „{suche.trim()}“</> : null}{hersteller !== "Alle" ? ` bei ${hersteller}` : ""}.{" "}
              <button type="button" className="font-bold text-[#008BD2]" onClick={() => { setSuche(""); setHersteller("Alle"); }}>Alle zeigen</button>
            </div>
          ) : sichtbareGruppen.map((g) => (
            <section key={g.hersteller} className="space-y-2">
              <h2 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
                {g.hersteller} <span className="text-[#008BD2] dark:text-[#45bdff]">({g.vorlagen.length})</span>
              </h2>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))" }}>
          {g.vorlagen.map((v) => {
            const d = druckDatei.get(v.id);
            const p = projektDatei.get(v.id);
            const details = [
              v.stueckProPlatte ? `${v.stueckProPlatte} Stück/Platte` : null,
              fmtDauer(v.druckzeitMin),
              v.material,
            ].filter(Boolean).join(" · ");
            return (
              <div key={v.id} className={`${karte} overflow-hidden flex flex-col ${v.aktiv ? "" : "opacity-60"}`}>
                <Link href={`/admin/druck/${v.id}`} className="block">
                  <VorlagenBild vorlageId={v.id} name={v.name} fotoAm={v.fotoAm} dateiId={d?.id ?? null} />
                  <div className="p-4 space-y-2">
                    <div className="font-black text-[#202F61] dark:text-[#e4e6eb]">{v.name}{!v.aktiv && " (inaktiv)"}</div>
                    <div className="flex flex-wrap gap-1">
                      {v.teiltypen.map((t) => <span key={t} className={`${chip} bg-[#008BD2]/10 text-[#0064d2] dark:text-[#45bdff]`}>{t}</span>)}
                    </div>
                    <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                      {v.modelle.length === 0 ? <span className="text-[#8A5A00] dark:text-[#f7b928] font-bold">⚠ noch kein Gerät zugeordnet</span>
                        : <>{v.modelle.slice(0, 3).map((m) => m.anzeige).join(", ")}{v.modelle.length > 3 && ` +${v.modelle.length - 3}`}</>}
                    </div>
                    {details && <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{details}</div>}
                    <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                      Bestand <strong>{v.bestand}</strong> · {v.stueck90} Stück in 90 Tagen{v.offenStueck > 0 && <> · <strong className="text-[#8A5A00] dark:text-[#f7b928]">{v.offenStueck} offen</strong></>}
                    </div>
                    {v.letzterDruck && (
                      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                        Zuletzt gedruckt: {new Date(v.letzterDruck.createdAt).toLocaleDateString("de-DE")} · {v.letzterDruck.stueck} Stück
                      </div>
                    )}
                  </div>
                </Link>
                {d && (
                  <div className="px-4 pb-2">
                    <DruckenKnopf klein titel={v.name} dateiId={d.id} dateiname={d.dateiname} material={v.material} />
                  </div>
                )}
                <div className="px-4 pb-4 mt-auto flex gap-2">
                  {d ? <a href={`/api/druck/datei/${d.id}`} className={`${knopfBlau} flex-1`} title={d.dateiname}>⬇ Druckdatei</a>
                    : p ? <a href={`/api/druck/datei/${p.id}`} className={`${knopfRand} flex-1`} title={p.dateiname}>⬇ Projekt</a>
                    : <span className="flex-1 text-xs text-[#8A5A00] dark:text-[#f7b928] font-bold self-center">⚠ keine Druckdatei</span>}
                  {darfEinbuchen && <Link href={`/admin/druck/${v.id}#fertig`} className={knopfRand} title="Druck fertig — einbuchen" aria-label={`${v.name}: Druck fertig — einbuchen`}>✓</Link>}
                  <Link href={`/admin/druck/${v.id}`} className={knopfRand}>{darfPflegen ? "Bearbeiten" : "Details"}</Link>
                </div>
              </div>
            );
          })}
        </div>
            </section>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * Bild einer Vorlage: eigenes Foto, sonst die Draufsicht aus der Druckdatei (von
 * Bambu Studio erzeugt, transparent in Filamentfarbe → heller Grund), sonst Symbol.
 */
function VorlagenBild({ vorlageId, name, fotoAm, dateiId }: { vorlageId: number; name: string; fotoAm: Date | string | null; dateiId: number | null }) {
  const [fehlt, setFehlt] = useState(false);
  const src = fotoAm ? `/api/druck/foto/${vorlageId}?v=${new Date(fotoAm).getTime()}`
    : dateiId && !fehlt ? `/api/druck/vorschau/${dateiId}?ansicht=oben` : null;
  return (
    <div className={`h-40 flex items-center justify-center ${fotoAm ? "bg-[#f0f2f5] dark:bg-[#18191a]" : "bg-white border-b border-[#eef0f2] dark:border-[#3e4042]"}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} loading="lazy" onError={() => setFehlt(true)} className={`h-full w-full object-contain ${fotoAm ? "" : "p-3"}`} />
      ) : (
        <span className="text-4xl" aria-hidden>🖨️</span>
      )}
    </div>
  );
}
