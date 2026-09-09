"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { GRADING_OPTIONS } from "@/modules/einlagern/constants";

// ── Weg D: das ganze Gerät einlagern ─────────────────────────────────────────
//
// Für Geräte, die nicht in den Verkauf gehen und später ausgeschlachtet werden.
// Bis dahin liegen sie als Teilevorrat im Regal.
//
// ⚠️ Es wird NICHTS gebucht. Ein Spendergerät zählt nicht auf den Bestand
// seiner Teile — erst das Zerlegen erzeugt echte EINGANG-Buchungen. Sonst
// startete eine Anfrage als NEU statt BEDARF und das Auslagern fände nichts.
//
// Der Kern des Bildschirms sind die Häkchen: Alles ist angehakt, abgewählt wird,
// was schon draußen ist. Das ist bewusst herum — an einem Gerät fehlt in der
// Regel nichts oder wenig, und wer zwanzig Häkchen setzen muss, setzt sie nicht.

type Gefunden = { name: string; logId: string | null };

const karte = "rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5";
const knopf = "px-5 py-3 rounded-xl font-bold text-base min-h-[56px]";

export function StepKomplettGeraet({
  standortId, onBack,
}: {
  standortId: number;
  onBack:     () => void;
}) {
  const { show } = useToast();
  const eingabeRef = useRef<HTMLInputElement>(null);

  const [query,    setQuery]    = useState("");
  const [suchQ,    setSuchQ]    = useState<string | null>(null);
  const [gefunden, setGefunden] = useState<Gefunden | null>(null);
  const [grading,  setGrading]  = useState<string>("");
  const [lagerplatz, setLagerplatz] = useState("");
  const [notiz,    setNotiz]    = useState("");
  // Teiltyp-Name → steckt noch im Gerät?
  const [drin, setDrin] = useState<Record<string, boolean>>({});
  const [fertig, setFertig] = useState<{ id: number; logId: string } | null>(null);

  useEffect(() => { eingabeRef.current?.focus(); }, []);

  const suche = api.einlagern.geraetSuchen.useQuery(
    { query: suchQ ?? "" },
    { enabled: !!suchQ, retry: false, staleTime: 0 },
  );

  // Gefundenes Gerät übernehmen.
  useEffect(() => {
    if (!suche.data || !suchQ) return;
    setSuchQ(null);
    if (suche.data.gefunden) {
      setGefunden({ name: suche.data.name, logId: suche.data.logId ?? null });
    } else {
      show("Zu dieser LogID ist kein Gerät hinterlegt.", "warning");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suche.data]);

  const teiltypen = api.spenderGeraet.teiltypenFuer.useQuery(
    { geraet: gefunden?.name ?? "" },
    { enabled: !!gefunden },
  );

  // Alles anhaken, sobald die Liste da ist.
  useEffect(() => {
    if (!teiltypen.data) return;
    setDrin(Object.fromEntries(teiltypen.data.map((t) => [t.name, true])));
  }, [teiltypen.data]);

  // Liegt für dieses Modell schon ein ETL-Fach fest? Dann gehört das Gerät dorthin.
  const regal = api.einlagern.modellImRegal.useQuery(
    { geraetName: gefunden?.name ?? "", logId: gefunden?.logId ?? undefined },
    { enabled: !!gefunden, staleTime: 0 },
  );
  const fachVorschlag = regal.data?.imRegal ? regal.data.fachCode ?? null : null;

  const anlegen = api.spenderGeraet.anlegen.useMutation({
    onSuccess: (r) => { setFertig(r); show("✅ Gerät eingelagert", "success"); },
    onError:   (e) => show(e.message, "error"),
  });

  const anzahlDrin = useMemo(() => Object.values(drin).filter(Boolean).length, [drin]);
  const anzahlFehlt = (teiltypen.data?.length ?? 0) - anzahlDrin;

  function zuruecksetzen() {
    setQuery(""); setGefunden(null); setGrading(""); setLagerplatz("");
    setNotiz(""); setDrin({}); setFertig(null);
    setTimeout(() => eingabeRef.current?.focus(), 50);
  }

  function speichern() {
    if (!gefunden || !teiltypen.data) return;
    if (!grading) { show("Bitte ein Grading wählen.", "error"); return; }
    // Hersteller steckt als erstes Wort im aufgelösten Namen. Die Bezeichnung
    // wird OHNE Präfix gespeichert — wie Artikel.bezeichnung im ganzen Projekt.
    const teile = gefunden.name.trim().split(/\s+/);
    const hersteller = teile.length > 1 ? teile[0]! : null;
    const bezeichnung = teile.length > 1 ? teile.slice(1).join(" ") : gefunden.name.trim();

    anlegen.mutate({
      logId:       gefunden.logId ?? query.trim(),
      hersteller,
      bezeichnung,
      grading:     grading as "A+" | "A" | "B" | "C",
      lagerplatz:  lagerplatz.trim() || null,
      standortId,
      notiz:       notiz.trim() || null,
      komponenten: teiltypen.data.map((t) => ({ teiltyp: t.name, vorhanden: !!drin[t.name] })),
    });
  }

  // ── Fertig ────────────────────────────────────────────────────────────────
  if (fertig) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className={`${karte} text-center`}>
          <div className="text-6xl mb-2">🖥️</div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Gerät liegt im Regal</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            <span className="font-mono">{fertig.logId}</span>
            {lagerplatz.trim() && <> · {lagerplatz.trim()}</>}
          </p>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-3">
            Es wurde nichts eingebucht. Die Teile zählen erst auf den Bestand,
            wenn das Gerät zerlegt wird.
          </p>
          <div className="flex gap-3 justify-center flex-wrap mt-5">
            <button onClick={zuruecksetzen} className={`${knopf} bg-[#0064d2] text-white`}>
              Noch ein Gerät
            </button>
            <Link href="/admin/spendergeraete" className={`${knopf} border-2 border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] inline-flex items-center`}>
              Zu den Spendergeräten
            </Link>
            <button onClick={onBack} className={`${knopf} border-2 border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]`}>
              Zurück zum Start
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="px-4 py-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] min-h-[56px] font-bold">
          ← Zurück
        </button>
        <div>
          <h1 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🖥️ Komplettes Gerät einlagern</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Für Geräte, die später zerlegt werden.
          </p>
        </div>
      </div>

      {/* ── 1. Gerät ──────────────────────────────────────────────────────── */}
      <div className={karte}>
        <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-2">1. Welches Gerät?</div>
        {!gefunden ? (
          <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) setSuchQ(query.trim()); }}
            className="flex gap-2 flex-wrap">
            <input
              ref={eingabeRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="LogID scannen oder eintippen…"
              className="flex-1 min-w-[220px] px-4 py-3 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] font-mono text-base min-h-[56px] outline-none focus:border-[#0064d2]"
            />
            <button type="submit" disabled={suche.isFetching} className={`${knopf} bg-[#0064d2] text-white disabled:opacity-50`}>
              {suche.isFetching ? "…" : "Suchen"}
            </button>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-black text-lg text-[#1a1a1a] dark:text-[#e4e6eb]">{gefunden.name}</div>
              {gefunden.logId && <div className="font-mono text-sm text-[#65676b] dark:text-[#b0b3b8]">{gefunden.logId}</div>}
            </div>
            <button onClick={zuruecksetzen}
              className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-bold min-h-[44px]">
              Anderes Gerät
            </button>
          </div>
        )}
      </div>

      {gefunden && (
        <>
          {/* ── 2. Grading ──────────────────────────────────────────────── */}
          <div className={karte}>
            <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">2. In welchem Zustand ist es?</div>
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-3">
              Das Grading des ganzen Geräts, nicht der einzelnen Teile.
            </p>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              {GRADING_OPTIONS.map((g) => {
                const aktiv = grading === g.value;
                return (
                  <button key={g.value} onClick={() => setGrading(g.value)}
                    aria-pressed={aktiv}
                    className={`text-left px-4 py-3 rounded-xl border-2 min-h-[56px] transition-colors ${
                      aktiv
                        ? "border-[#0064d2] bg-[#0064d2]/8"
                        : "border-[#ced4da] dark:border-[#3e4042] hover:border-[#0064d2]"
                    }`}>
                    <div className="font-black text-[#1a1a1a] dark:text-[#e4e6eb]">
                      {g.icon} {g.value} · {g.label}
                    </div>
                    <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{g.beschreibung}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 3. Komponenten ──────────────────────────────────────────── */}
          <div className={karte}>
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
              <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">3. Was ist noch drin?</div>
              <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                <b className="text-[#038F5C] dark:text-[#04B475]">{anzahlDrin} drin</b>
                {anzahlFehlt > 0 && <> · <b className="text-[#8A5A00] dark:text-[#f7b928]">{anzahlFehlt} fehlt</b></>}
              </div>
            </div>
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-3">
              Alles ist angehakt. Hake ab, was schon herausgenommen wurde.
            </p>

            {teiltypen.isLoading && <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Wird geladen…</p>}

            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
              {teiltypen.data?.map((t) => {
                const an = !!drin[t.name];
                return (
                  <label key={t.name}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl border-2 cursor-pointer min-h-[56px] transition-colors ${
                      an
                        ? "border-[#04B475] bg-[#04B475]/6"
                        : "border-[#ced4da] dark:border-[#3e4042] opacity-60"
                    }`}>
                    <input
                      type="checkbox"
                      checked={an}
                      onChange={(e) => setDrin((v) => ({ ...v, [t.name]: e.target.checked }))}
                      className="w-6 h-6 accent-[#04B475] shrink-0"
                    />
                    <span className="text-xl" aria-hidden>{t.icon}</span>
                    <span className="min-w-0">
                      <span className="block font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{t.label}</span>
                      {/* Wort statt nur Farbe — Zustand nie allein über Farbe. */}
                      <span className={`block text-xs font-bold ${an ? "text-[#038F5C] dark:text-[#04B475]" : "text-[#8A5A00] dark:text-[#f7b928]"}`}>
                        {an ? "ist drin" : "fehlt schon"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {teiltypen.data && teiltypen.data.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                <button
                  onClick={() => setDrin(Object.fromEntries(teiltypen.data!.map((t) => [t.name, true])))}
                  className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm font-bold text-[#65676b] dark:text-[#b0b3b8] min-h-[44px]">
                  Alle anhaken
                </button>
                <button
                  onClick={() => setDrin(Object.fromEntries(teiltypen.data!.map((t) => [t.name, false])))}
                  className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-sm font-bold text-[#65676b] dark:text-[#b0b3b8] min-h-[44px]">
                  Alle abhaken
                </button>
              </div>
            )}
          </div>

          {/* ── 4. Wohin ────────────────────────────────────────────────── */}
          <div className={karte}>
            <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-2">4. Wo liegt es?</div>
            {fachVorschlag && (
              <button
                onClick={() => setLagerplatz(fachVorschlag)}
                className="mb-2 px-4 py-2 rounded-lg border-2 border-[#008BD2] text-[#008BD2] font-bold text-sm min-h-[44px]">
                📍 Fach dieses Modells übernehmen: {fachVorschlag}
              </button>
            )}
            <input
              value={lagerplatz}
              onChange={(e) => setLagerplatz(e.target.value)}
              placeholder="z. B. ETL-9-3-2 oder Palette 4"
              className="w-full px-4 py-3 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] min-h-[56px] outline-none focus:border-[#0064d2]"
            />
            <textarea
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
              rows={2}
              placeholder="Notiz, optional — z. B. „Displayscharnier gebrochen“"
              className="w-full mt-2 px-4 py-2 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            />
          </div>

          {/* ── Speichern ───────────────────────────────────────────────── */}
          <div className={karte}>
            <button
              onClick={speichern}
              disabled={!grading || anlegen.isPending || !teiltypen.data}
              className={`${knopf} w-full bg-[#04B475] text-white disabled:opacity-50`}>
              {anlegen.isPending ? "Wird gespeichert…" : "Gerät einlagern"}
            </button>
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-2 text-center">
              Es wird nichts auf den Bestand gebucht. Das passiert erst beim Zerlegen.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
