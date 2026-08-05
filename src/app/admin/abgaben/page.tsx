"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { printAuslagerbeleg, belegNrFuerAbgabe } from "@/lib/print/auslagerbeleg";

// ── Material-Abgaben an andere Niederlassungen ───────────────────────────────
// Festplatten und Arbeitsspeicher werden hier erfasst und an andere
// Niederlassungen abgegeben. Technisch ist jede Abgabe eine normale
// AUSGANG-Buchung mit Ziel — der Bestand läuft also über dieselbe geprüfte
// Logik wie überall sonst.

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const nf   = (n: number) => n.toLocaleString("de-DE");

const ZEITRAEUME = [
  { key: 30,   label: "30 Tage" },
  { key: 90,   label: "90 Tage" },
  { key: 365,  label: "365 Tage" },
  { key: null, label: "Gesamt" },
] as const;

export default function AbgabenPage() {
  const { show } = useToast();
  const utils = api.useUtils();

  const [tage, setTage]               = useState<number | null>(90);
  const [artikelSuche, setArtikelSuche] = useState("");
  const [artikelId, setArtikelId]     = useState("");
  const [menge, setMenge]             = useState("1");
  const [zielId, setZielId]           = useState("");
  const [notiz, setNotiz]             = useState("");
  const [neueNL, setNeueNL]           = useState("");
  const [nlOffen, setNlOffen]         = useState(false);

  const niederlassungen = api.abgaben.niederlassungen.useQuery();
  const auswertung      = api.abgaben.auswertung.useQuery({ tage });
  const letzte          = api.abgaben.letzte.useQuery({ limit: 50 });
  const artikelListe    = api.lager.getAll.useQuery(
    { search: artikelSuche.trim() || undefined, page: 1, limit: 50 },
    { staleTime: 30_000 },
  );

  function neuLaden() {
    void utils.abgaben.invalidate();
    void utils.lager.invalidate();
  }

  const abgeben = api.abgaben.abgeben.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.menge}× ${r.artikel} → ${r.niederlassung} (Rest: ${r.neuerBestand})`, "success");
      setMenge("1"); setNotiz(""); setArtikelId("");
      neuLaden();
      // Beleg direkt anbieten — im Alltag geht die Sendung sofort raus.
      printAuslagerbeleg({
        belegNr:     belegNrFuerAbgabe(r.buchungId, r.datum),
        datum:       r.datum,
        mitarbeiter: r.mitarbeiter,
        absender:    r.absender,
        empfaenger:  r.niederlassung,
        notiz:       r.notiz,
        positionen:  [{ bezeichnung: r.artikel, kategorie: r.kategorie, menge: r.menge, preis: r.preis }],
      });
    },
    onError: (e) => show(e.message, "error"),
  });

  const nlAnlegen = api.abgaben.niederlassungAnlegen.useMutation({
    onSuccess: (n) => { show(`✅ „${n.name}" angelegt`, "success"); setNeueNL(""); neuLaden(); },
    onError:   (e) => show(e.message, "error"),
  });

  const nlAendern = api.abgaben.niederlassungAendern.useMutation({
    onSuccess: () => { show("Gespeichert", "success"); neuLaden(); },
    onError:   (e) => show(e.message, "error"),
  });

  // Sammelbeleg: mehrere Abgaben derselben Niederlassung auf EIN Dokument.
  // Im Alltag geht oft mehreres in einer Sendung raus.
  const [markiert, setMarkiert] = useState<Set<number>>(new Set());

  function markierungUmschalten(id: number) {
    setMarkiert((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function sammelbelegDrucken() {
    const zeilen = (letzte.data ?? []).filter((b) => markiert.has(b.id));
    if (zeilen.length === 0) return;

    const ziele = new Set(zeilen.map((b) => b.niederlassung?.id));
    if (ziele.size > 1) {
      show("Bitte nur Abgaben an dieselbe Niederlassung markieren — ein Beleg hat einen Empfänger.", "warning");
      return;
    }

    const erste = zeilen[0]!;
    printAuslagerbeleg({
      // Nummer der ältesten markierten Buchung — bleibt beim Nachdruck gleich.
      belegNr:     belegNrFuerAbgabe(Math.min(...zeilen.map((z) => z.id)), erste.datum),
      datum:       erste.datum,
      mitarbeiter: erste.mitarbeiter,
      absender:    {
        name:    erste.artikel.standort?.name ?? "Lager",
        adresse: erste.artikel.standort?.adresse ?? null,
      },
      empfaenger:  erste.niederlassung?.name ?? "—",
      positionen:  zeilen.map((b) => ({
        bezeichnung: b.artikel.bezeichnung,
        kategorie:   b.artikel.kategorie,
        menge:       b.menge,
        preis:       b.artikel.preis,
      })),
    });
  }

  const artikel = artikelListe.data?.artikel ?? [];
  const gewaehlt = artikel.find((a) => String(a.id) === artikelId);
  const kannBuchen = !!artikelId && !!zielId && Number(menge) > 0 && !abgeben.isPending;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">📦 Abgaben an Niederlassungen</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
            Festplatten, Arbeitsspeicher und anderes Material, das an andere Standorte der Gruppe geht.
          </p>
        </div>
        <div className="flex bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] rounded-xl overflow-hidden">
          {ZEITRAEUME.map(({ key, label }) => (
            <button key={label} onClick={() => setTage(key)}
              className={`px-4 py-2 text-sm font-semibold transition-colors ${
                tage === key ? "bg-[#202F61] text-white"
                             : "text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Abgabe erfassen ───────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">Abgabe erfassen</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold mb-1 text-[#1a1a1a] dark:text-[#e4e6eb]">Artikel suchen</label>
            <input
              type="text" value={artikelSuche} onChange={(e) => { setArtikelSuche(e.target.value); setArtikelId(""); }}
              placeholder="z. B. SSD 512, DDR4 8GB …"
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-semibold mb-1 text-[#1a1a1a] dark:text-[#e4e6eb]">Artikel</label>
            <select value={artikelId} onChange={(e) => setArtikelId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]">
              <option value="">— Artikel wählen —</option>
              {artikel.map((a) => (
                <option key={a.id} value={a.id} disabled={a.bestand <= 0}>
                  {a.bezeichnung} · {a.kategorie} · Bestand {a.bestand}{a.bestand <= 0 ? " (leer)" : ""}
                </option>
              ))}
            </select>
            {gewaehlt && (
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
                Verfügbar: <strong>{gewaehlt.bestand}</strong>
                {" · "}
                <a href={`/admin/artikel/${gewaehlt.id}`} className="underline">Artikel öffnen (Preis pflegen)</a>
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1 text-[#1a1a1a] dark:text-[#e4e6eb]">Stückzahl</label>
            <input type="number" min={1} value={menge} onChange={(e) => setMenge(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1 text-[#1a1a1a] dark:text-[#e4e6eb]">Niederlassung</label>
            <select value={zielId} onChange={(e) => setZielId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]">
              <option value="">— Ziel wählen —</option>
              {(niederlassungen.data ?? []).filter((n) => n.aktiv).map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-semibold mb-1 text-[#1a1a1a] dark:text-[#e4e6eb]">Notiz (optional)</label>
            <input type="text" value={notiz} onChange={(e) => setNotiz(e.target.value)}
              placeholder="z. B. Lieferschein-Nr."
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
          </div>
        </div>

        <button
          onClick={() => abgeben.mutate({
            artikelId: Number(artikelId), menge: Number(menge),
            niederlassungId: Number(zielId), notiz: notiz.trim() || undefined,
          })}
          disabled={!kannBuchen}
          className="mt-4 px-6 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50"
        >
          {abgeben.isPending ? "Wird gebucht…" : "Abgabe buchen"}
        </button>
      </div>

      {/* ── Auswertung ────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">Auswertung</h2>
        {auswertung.isLoading && <div className="h-24 bg-[#f0f2f5] dark:bg-[#3e4042] rounded-lg animate-pulse" />}
        {auswertung.data && (
          <>
            <div className="mb-4">
              <div className="text-3xl font-black text-[#04B475]">{euro(auswertung.data.gesamtWert)}</div>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                {nf(auswertung.data.gesamtMenge)} Stück abgegeben · statistischer Wert, keine Forderung
                {auswertung.data.ohnePreis > 0 && (
                  <span className="text-[#f7b928]">
                    {" · "}⚠️ {nf(auswertung.data.ohnePreis)} davon ohne hinterlegten Preis (nicht im Wert)
                  </span>
                )}
              </div>
            </div>

            {auswertung.data.proNiederlassung.length === 0 ? (
              <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] py-4 text-center">Keine Abgaben im Zeitraum</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                    <th className="text-left py-2 pr-3">Niederlassung</th>
                    <th className="text-right py-2 px-3">Stück</th>
                    <th className="text-right py-2 pl-3">ca. Wert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                  {auswertung.data.proNiederlassung.map((z) => (
                    <tr key={z.id}>
                      <td className="py-2 pr-3 font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{z.name}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-[#65676b] dark:text-[#b0b3b8]">
                        {nf(z.menge)}{z.ohnePreis > 0 && <span className="text-[#f7b928]"> ({z.ohnePreis} o. Preis)</span>}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{euro(z.wert)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* ── Letzte Abgaben ────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Letzte Abgaben</h2>
          {markiert.size > 0 && (
            <button onClick={sammelbelegDrucken}
              className="px-4 py-2 text-sm font-bold rounded-xl bg-[#202F61] text-white hover:bg-[#18244a]">
              📄 Sammelbeleg für {markiert.size} Position{markiert.size === 1 ? "" : "en"}
            </button>
          )}
        </div>
        {(letzte.data ?? []).length === 0 ? (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] py-4 text-center">Noch nichts abgegeben</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                  <th className="w-8 py-2"><span className="sr-only">Für Sammelbeleg markieren</span></th>
                  <th className="text-left py-2 pr-3">Datum</th>
                  <th className="text-left py-2 px-3">Artikel</th>
                  <th className="text-right py-2 px-3">Stück</th>
                  <th className="text-left py-2 px-3">Ziel</th>
                  <th className="text-left py-2 px-3">Von</th>
                  <th className="text-right py-2 pl-3">Beleg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                {(letzte.data ?? []).map((b) => (
                  <tr key={b.id}>
                    <td className="py-2">
                      <input
                        type="checkbox" checked={markiert.has(b.id)}
                        onChange={() => markierungUmschalten(b.id)}
                        className="w-4 h-4 cursor-pointer"
                        aria-label={`${b.artikel.bezeichnung} für Sammelbeleg markieren`}
                      />
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-[#65676b] dark:text-[#b0b3b8]">
                      {new Date(b.datum).toLocaleDateString("de-DE")}
                    </td>
                    <td className="py-2 px-3 text-[#1a1a1a] dark:text-[#e4e6eb]">{b.artikel.bezeichnung}</td>
                    <td className="py-2 px-3 text-right tabular-nums font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{b.menge}</td>
                    <td className="py-2 px-3 text-[#1a1a1a] dark:text-[#e4e6eb]">{b.niederlassung?.name ?? "—"}</td>
                    <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8]">{b.mitarbeiter}</td>
                    <td className="py-2 pl-3 text-right">
                      <button
                        onClick={() => printAuslagerbeleg({
                          belegNr:     belegNrFuerAbgabe(b.id, b.datum),
                          datum:       b.datum,
                          mitarbeiter: b.mitarbeiter,
                          absender:    {
                            name:    b.artikel.standort?.name ?? "Lager",
                            adresse: b.artikel.standort?.adresse ?? null,
                          },
                          empfaenger:  b.niederlassung?.name ?? "—",
                          notiz:       b.notiz,
                          positionen:  [{
                            bezeichnung: b.artikel.bezeichnung,
                            kategorie:   b.artikel.kategorie,
                            menge:       b.menge,
                            preis:       b.artikel.preis,
                          }],
                        })}
                        className="text-xs font-bold px-2.5 py-1 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                        title={`Beleg ${belegNrFuerAbgabe(b.id, b.datum)} drucken`}
                      >
                        📄
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Niederlassungen verwalten ─────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <button onClick={() => setNlOffen((v) => !v)}
          className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] flex items-center gap-2">
          <span>{nlOffen ? "▾" : "▸"}</span> Niederlassungen verwalten
          <span className="text-xs font-normal text-[#65676b] dark:text-[#b0b3b8]">
            ({(niederlassungen.data ?? []).filter((n) => n.aktiv).length} aktiv)
          </span>
        </button>

        {nlOffen && (
          <div className="mt-4 space-y-3">
            <div className="flex gap-3 flex-wrap">
              <input type="text" value={neueNL} onChange={(e) => setNeueNL(e.target.value)}
                placeholder="Name der Niederlassung"
                className="flex-1 min-w-[220px] px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
              <button onClick={() => neueNL.trim() && nlAnlegen.mutate({ name: neueNL.trim() })}
                disabled={!neueNL.trim() || nlAnlegen.isPending}
                className="px-5 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50">
                Anlegen
              </button>
            </div>

            <ul className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
              {(niederlassungen.data ?? []).map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3 py-2">
                  <span className={n.aktiv ? "text-[#1a1a1a] dark:text-[#e4e6eb]" : "text-[#90939a] line-through"}>
                    {n.name}
                  </span>
                  <button
                    onClick={() => nlAendern.mutate({ id: n.id, aktiv: !n.aktiv })}
                    className="text-xs font-bold px-3 py-1 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                  >
                    {n.aktiv ? "Deaktivieren" : "Aktivieren"}
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Niederlassungen mit bereits erfassten Abgaben werden nicht gelöscht, sondern auf inaktiv
              gesetzt — sonst verlöre die Auswertung ihren Bezug.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
