"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { usePermissions } from "@/hooks/usePermissions";
import { AutoBereich, type AutoFund } from "./AutoBereich";

// ── Pflegeseite für Teilenummern ─────────────────────────────────────────────
//
// Hier wird nachgeschlagen, was an der Werkbank nicht nachgeschlagen werden
// soll. Wer ein Teil in der Hand hat, scannt und lagert ein; die Frage „in
// welche Modelle passt das" wird hier beantwortet, in Ruhe und einmal je Nummer.
//
// Der Hebel: Sobald eine Nummer Modelle bekommt, gilt das rückwirkend für ALLE
// Teile dieser Nummer, auch die, die längst im Regal liegen.

export default function TeilenummernPage() {
  const { show } = useToast();
  const utils = api.useUtils();
  const { has } = usePermissions();
  const darfPflegen = has("ARTIKEL_EDIT");

  const [nurOffen, setNurOffen] = useState(true);
  // Vorschläge je Nummer, nur im Fenster gehalten. Bewusst nicht gespeichert:
  // Was nicht bestätigt ist, soll nirgends aussehen wie ein Fakt.
  const [funde, setFunde] = useState<Record<number, AutoFund>>({});
  const status = api.teilenummern.sucheStatus.useQuery();
  const [suche,    setSuche]    = useState("");
  const [offen,    setOffen]    = useState<number | null>(null);

  const daten = api.teilenummern.liste.useQuery({ nurOffen, suche: suche.trim() || undefined });
  const neuLaden = () => { void utils.teilenummern.liste.invalidate(); };

  const aendern = api.teilenummern.aktualisieren.useMutation({
    onSuccess: () => { show("Gespeichert", "success"); neuLaden(); },
    onError:   (e) => show(e.message, "error"),
  });

  const automatisch = api.teilenummern.automatischSuchen.useMutation({
    onSuccess: (r, v) => {
      setFunde((f) => ({ ...f, [v.id]: r }));
      if (!r.ok) show(r.grund ?? "Nichts gefunden", "info");
      else if (r.vorschlaege.length === 0) show("Fundstellen da, aber kein bekanntes Modell darin", "info");
      else show(`${r.vorschlaege.length} Modelle vorgeschlagen`, "success");
    },
    onError: (e) => show(e.message, "error"),
  });

  const modelleSetzen = api.teilenummern.setzeModelle.useMutation({
    onSuccess: () => { show("Übernommen", "success"); neuLaden(); },
    onError:   (e) => show(e.message, "error"),
  });

  const namenZuordnen = api.teilenummern.ordneNamenZu.useMutation({
    onSuccess: (r) => {
      show(
        r.nichtGefunden.length === 0
          ? `${r.zugeordnet} Modelle zugeordnet`
          : `${r.zugeordnet} zugeordnet, ${r.nichtGefunden.length} nicht gefunden`,
        r.nichtGefunden.length === 0 ? "success" : "info",
      );
      neuLaden();
    },
    onError: (e) => show(e.message, "error"),
  });

  if (daten.isLoading) return <PageLoader />;
  const d = daten.data;

  const feld = "px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[44px]";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🔢 Teilenummern</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5 max-w-2xl">
            Die aufgedruckte Nummer ist die Identität eines Teils. Wird hier eine Modellliste
            hinterlegt, gilt sie rückwirkend für jedes Stück dieser Nummer.
          </p>
        </div>
        {d && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setNurOffen(true)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${nurOffen ? "bg-[#f7b928]/15 text-[#a67908] dark:text-[#f7b928] border-[#f7b928]/40 ring-2 ring-offset-1 ring-[#0064d2]" : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"}`}>
              Offen: {d.offen}
            </button>
            <button onClick={() => setNurOffen(false)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${!nurOffen ? "bg-[#008BD2]/15 text-[#0079b8] dark:text-[#45bdff] border-[#008BD2]/40 ring-2 ring-offset-1 ring-[#0064d2]" : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"}`}>
              Alle: {d.gesamt}
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input type="text" value={suche} onChange={(e) => setSuche(e.target.value)}
          placeholder="Nummer, Hersteller oder Teiltyp suchen…" className={`${feld} w-full max-w-md`} />
        {status.data && (
          <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
            {status.data.eingerichtet
              ? `Automatische Suche über ${status.data.quelle === "searxng" ? "die eigene Metasuche" : "Google"}: ${status.data.verbraucht} von ${status.data.tageslimit} Abfragen heute`
              : "Automatische Suche nicht eingerichtet. Modelle von Hand eintragen"}
          </span>
        )}
      </div>

      {d && d.zeilen.length === 0 && (
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-10 text-center text-[#65676b] dark:text-[#b0b3b8]">
          {nurOffen
            ? "Nichts offen. Sobald beim Einlagern eine neue Nummer gescannt wird, taucht sie hier auf."
            : "Noch keine Teilenummern erfasst."}
        </div>
      )}

      <div className="space-y-3">
        {(d?.zeilen ?? []).map((t) => {
          const auf = offen === t.id;
          return (
            <div key={t.id} className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
              <button
                onClick={() => setOffen(auf ? null : t.id)}
                className="w-full text-left p-4 flex items-center gap-3 flex-wrap hover:bg-[#008BD2]/5"
              >
                <span className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{t.nummer}</span>

                {t.geprueft
                  ? <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#04B475]/15 text-[#038F5C] dark:text-[#04B475] uppercase">geprüft</span>
                  : <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#f7b928]/15 text-[#a67908] dark:text-[#f7b928] uppercase">offen</span>}

                {t.istSeriennummer && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#fa3e3e]/15 text-[#c62828] dark:text-[#ff8a80] uppercase">Seriennummer</span>
                )}

                <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                  {[t.hersteller, t.teiltyp].filter(Boolean).join(" · ") || "noch ohne Angaben"}
                </span>

                <span className="ml-auto text-xs text-[#90939a] tabular-nums">
                  {t.modelle.length} Modell{t.modelle.length === 1 ? "" : "e"} · {t.sichtungen}× erfasst
                </span>
              </button>

              {/* Verdacht ganz bewusst nur als Hinweis, nicht als Automatik:
                  Eine Nummer, die erst einmal aufgetaucht ist, KANN eine
                  Seriennummer sein — sie kann aber auch einfach neu sein. */}
              {t.seriennummerVerdacht && !t.istSeriennummer && !t.geprueft && (
                <div className="px-4 pb-3 -mt-1 text-xs text-[#8A5A00] dark:text-[#f7b928]">
                  Bisher nur einmal gesehen. Könnte eine Seriennummer dieses einen Stücks sein.
                </div>
              )}

              {auf && (
                <div className="border-t border-[#ced4da] dark:border-[#3e4042] p-4 space-y-4">

                  {t.artikel.length > 0 && (
                    <div className="text-sm">
                      <span className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Artikel: </span>
                      <span className="text-[#65676b] dark:text-[#b0b3b8]">
                        {t.artikel.map((a) => `${a.bezeichnung} (Bestand ${a.bestand})`).join(" · ")}
                      </span>
                    </div>
                  )}

                  <div>
                    <div className="font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
                      Passende Modelle ({t.modelle.length})
                    </div>
                    {t.modelle.length === 0 ? (
                      <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                        Noch keine. Beim Einlagern über ein Spendergerät kommt automatisch eines dazu.
                      </p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {t.modelle.map((m) => (
                          <li key={m.modellId}
                            className={`text-xs px-2 py-1 rounded border ${
                              m.quelle === "SPENDER"
                                ? "bg-[#04B475]/10 text-[#038F5C] dark:text-[#04B475] border-[#04B475]/30"
                                : "bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] border-[#ced4da] dark:border-[#3e4042]"
                            }`}
                            title={m.quelle === "SPENDER" ? "Aus einem echten Spendergerät (sicher)" : m.quelle}
                          >
                            {m.name}{m.quelle === "SPENDER" ? " ✓" : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {darfPflegen && status.data?.eingerichtet && (
                    <AutoBereich
                      fund={funde[t.id]}
                      laeuft={automatisch.isPending && automatisch.variables?.id === t.id}
                      onSuchen={() => automatisch.mutate({ id: t.id })}
                      onUebernehmen={(ids) => modelleSetzen.mutate({ id: t.id, modellIds: ids })}
                      uebernahmeLaeuft={modelleSetzen.isPending}
                    />
                  )}

                  {darfPflegen && (
                    <>
                      <ModellEinfuegen
                        onSenden={(namen) => namenZuordnen.mutate({ id: t.id, namen })}
                        laeuft={namenZuordnen.isPending}
                      />

                      {/* Nummer korrigierbar: Scanner liefern oft den
                          Sammelbarcode statt der reinen Teilenummer, und der
                          steht im Netz nirgends. */}
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-1">
                          Teilenummer korrigieren
                        </label>
                        <input type="text" defaultValue={t.nummer}
                          onBlur={(e) => e.target.value.trim().toUpperCase() !== t.nummer && aendern.mutate({ id: t.id, nummer: e.target.value })}
                          className={`${feld} w-full font-mono max-w-md`} />
                        <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
                          Steht auf dem Etikett mehr als eine Nummer, nimm die kurze
                          Teilenummer. Ein langer Sammelbarcode lässt sich nicht nachschlagen.
                        </p>

                        {/* Anklickbare Kürzungen. Der Scan enthält Werk, Datum und
                            Stücknummer; die suchbare Nummer steckt vorne drin. Statt
                            tippen zu lassen, hier zum Antippen. */}
                        {t.kuerzungen.length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs font-bold text-[#8A5A00] dark:text-[#f7b928] mb-1">
                              Sieht nach Sammelbarcode aus. Passt eines davon zum Etikett?
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {t.kuerzungen.map((k) => (
                                <button key={k}
                                  onClick={() => aendern.mutate({ id: t.id, nummer: k })}
                                  className="text-xs font-mono px-2 py-1 rounded border border-[#0064d2]/40 text-[#0064d2] dark:text-[#45bdff] hover:bg-[#0064d2]/10">
                                  {k}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input type="text" defaultValue={t.hersteller ?? ""} placeholder="Hersteller"
                          onBlur={(e) => e.target.value !== (t.hersteller ?? "") && aendern.mutate({ id: t.id, hersteller: e.target.value })}
                          className={`${feld} w-full`} />
                        <input type="text" defaultValue={t.teiltyp ?? ""} placeholder="Teiltyp"
                          onBlur={(e) => e.target.value !== (t.teiltyp ?? "") && aendern.mutate({ id: t.id, teiltyp: e.target.value })}
                          className={`${feld} w-full`} />
                      </div>

                      <div className="flex gap-2 flex-wrap pt-1">
                        <button
                          onClick={() => aendern.mutate({ id: t.id, geprueft: !t.geprueft })}
                          className={`px-4 py-2 rounded-lg font-bold text-sm min-h-[44px] ${
                            t.geprueft
                              ? "border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"
                              : "bg-[#04B475] text-white"
                          }`}>
                          {t.geprueft ? "Wieder als offen markieren" : "✓ Geprüft: Liste stimmt"}
                        </button>
                        <button
                          onClick={() => aendern.mutate({ id: t.id, istSeriennummer: !t.istSeriennummer })}
                          className="px-4 py-2 rounded-lg font-bold text-sm min-h-[44px] border border-[#fa3e3e]/40 text-[#c62828] dark:text-[#ff8a80]">
                          {t.istSeriennummer ? "Doch eine Teilenummer" : "Ist eine Seriennummer"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Modellnamen als Text einfügen. Gedacht für „Liste aus dem Netz kopieren":
// eine Zeile oder ein Komma je Modell. Was nicht existiert, wird gemeldet
// statt still geschluckt — sonst glaubt man, es seien mehr zugeordnet.
function ModellEinfuegen({ onSenden, laeuft }: {
  onSenden: (namen: string[]) => void;
  laeuft:   boolean;
}) {
  const [text, setText] = useState("");
  const namen = text.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean);

  return (
    <div>
      <label className="block font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
        Modelle zuordnen
      </label>
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} rows={3}
        placeholder={"Ein Modell je Zeile, z. B.\nHP ProBook 440 G6\nHP ProBook 450 G7"}
        className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] font-mono text-sm"
      />
      <button
        onClick={() => { onSenden(namen); setText(""); }}
        disabled={namen.length === 0 || laeuft}
        className="mt-2 px-4 py-2 rounded-lg bg-[#0064d2] text-white font-bold text-sm disabled:opacity-50 min-h-[44px]">
        {laeuft ? "…" : `${namen.length} Modell${namen.length === 1 ? "" : "e"} zuordnen`}
      </button>
    </div>
  );
}
