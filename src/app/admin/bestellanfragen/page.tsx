"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { usePermissions } from "@/hooks/usePermissions";

// ── Bestellanfragen Eigenbedarf ──────────────────────────────────────────────
// Ersetzt die wöchentliche Excel-Liste. Montags werden alle offenen Positionen
// als Tabelle kopiert, per Mail an den Standortleiter geschickt (der sie zum
// Einkauf weitergibt) und danach auf „bestellt" gesetzt.
//
// Der Kopiertext geht als HTML in die Zwischenablage, damit er in Outlook als
// echte Tabelle ankommt. Als Rückfall liegt derselbe Inhalt zusätzlich als
// Text mit Tabulatoren drin — den nimmt jedes Programm an.

// Reihenfolge = üblicher Verlauf einer Position, damit die Auswahl unten
// nicht erklärt werden muss.
const STATUS_REIHE = ["OFFEN", "BESTELLT", "GELIEFERT", "NICHT_GENEHMIGT", "STORNIERT"] as const;
type Status = (typeof STATUS_REIHE)[number];

const STATUS_LABEL: Record<string, string> = {
  OFFEN:           "Erfasst für nächste Bestellung",
  BESTELLT:        "Bestellt",
  GELIEFERT:       "Geliefert",
  NICHT_GENEHMIGT: "Nicht genehmigt",
  STORNIERT:       "Storniert",
};
// Kurzform für die schmalen Zähler-Knöpfe oben
const STATUS_KURZ: Record<string, string> = {
  OFFEN: "Erfasst", BESTELLT: "Bestellt", GELIEFERT: "Geliefert",
  NICHT_GENEHMIGT: "Nicht genehmigt", STORNIERT: "Storniert",
};
const STATUS_STIL: Record<string, string> = {
  OFFEN:           "bg-[#f7b928]/15 text-[#a67908] dark:text-[#f7b928] border-[#f7b928]/40",
  BESTELLT:        "bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] border-[#0064d2]/30",
  GELIEFERT:       "bg-[#04B475]/10 text-[#038F5C] dark:text-[#04B475] border-[#04B475]/30",
  NICHT_GENEHMIGT: "bg-[#fa3e3e]/10 text-[#c62828] dark:text-[#ff8a80] border-[#fa3e3e]/30",
  STORNIERT:       "bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] border-[#ced4da] dark:border-[#3e4042]",
};

// „Pos." vorweg, damit man sich in der Mail auf eine Zeile beziehen kann
// („Position 3 bitte streichen"). Die Nummer läuft je Sendung neu ab 1.
const SPALTEN = ["Pos.", "Anzahl", "Hersteller", "Artikelbeschreibung", "Link zum Artikel", "Datum", "Verwendungsort / Person"];

const datumDe = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("de-DE") : "";

export default function BestellanfragenPage() {
  const { show } = useToast();
  const utils = api.useUtils();

  // Drei Stufen: Einsicht (Seite überhaupt), Bedarf melden, verwalten.
  // Wer nur lesen darf, sieht die Liste und darf sie kopieren — das ändert
  // nichts. Verschicken, Status und Löschen bleiben der Verwaltung.
  const { has } = usePermissions();
  const darfErfassen  = has("BESTELLANFRAGE_CREATE");
  const darfVerwalten = has("BESTELLANFRAGE_MANAGE");

  const [filter, setFilter] = useState<Status | null>(null);
  const [suche, setSuche]   = useState("");
  const [form, setForm]     = useState({ anzahl: "1", hersteller: "", beschreibung: "", link: "", verwendungsort: "" });
  const [vorschau, setVorschau] = useState(false);
  // Bearbeiten läuft über einen Dialog statt in der Tabellenzeile — fünf Felder
  // wären dort nicht bedienbar, schon gar nicht auf einem schmalen Bildschirm.
  const [bearbeite, setBearbeite] = useState<{
    id: number; anzahl: string; hersteller: string; beschreibung: string;
    link: string; verwendungsort: string; notiz: string;
  } | null>(null);

  const liste   = api.bestellanfragen.liste.useQuery({ status: filter, suche: suche.trim() || undefined });
  const zaehler = api.bestellanfragen.zaehler.useQuery();
  const offene  = api.bestellanfragen.liste.useQuery({ status: "OFFEN", limit: 500 });

  const neuLaden = () => { void utils.bestellanfragen.invalidate(); };

  const anlegen = api.bestellanfragen.anlegen.useMutation({
    onSuccess: () => {
      show("✅ Position erfasst", "success");
      setForm({ anzahl: "1", hersteller: "", beschreibung: "", link: "", verwendungsort: "" });
      neuLaden();
    },
    onError: (e) => show(e.message, "error"),
  });

  const aendern  = api.bestellanfragen.aendern.useMutation({
    onSuccess: () => { setBearbeite(null); neuLaden(); },
    onError:   (e) => show(e.message, "error"),
  });
  const loeschen = api.bestellanfragen.loeschen.useMutation({
    onSuccess: () => { show("Position gelöscht", "success"); neuLaden(); },
    onError:   (e) => show(e.message, "error"),
  });
  const versendet = api.bestellanfragen.alsVersendetMarkieren.useMutation({
    onSuccess: (r) => { show(`✅ ${r.markiert} Positionen als bestellt markiert`, "success"); setVorschau(false); neuLaden(); },
    onError:   (e) => show(e.message, "error"),
  });

  const zuVersenden = offene.data ?? [];
  const heute = new Date().toLocaleDateString("de-DE");

  async function kopieren() {
    if (zuVersenden.length === 0) return;

    const zellen = zuVersenden.map((b, i) => [
      String(i + 1),
      String(b.anzahl),
      b.hersteller ?? "",
      b.beschreibung,
      b.link ?? "",
      heute,
      b.verwendungsort ?? "",
    ]);

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const html =
      `<p style="font-family:Arial,sans-serif;font-size:11pt">` +
      `<b>Bestellanfrage Eigenbedarf</b> &ndash; AfB S&ouml;mmerda &ndash; ${heute}</p>` +
      `<table cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:10.5pt;border:1px solid #cfe3f2">` +
      `<tr style="background:#008BD2;color:#ffffff;font-weight:bold">` +
      SPALTEN.map((s) => `<th align="left" style="border:1px solid #0079b8">${esc(s)}</th>`).join("") + `</tr>` +
      // Spalte 4 ist der Link: In der HTML-Fassung nur „zum Artikel" als
      // Verweis, sonst sprengen die teils 200 Zeichen langen Adressen jede
      // Tabelle. Die Textfassung unten behält die volle Adresse — dort wäre
      // ein Wort ohne Verweis wertlos.
      // Wechselnde Zeilenfarbe: Bei 15 Positionen verrutscht man sonst leicht.
      zellen.map((z, zi) =>
        `<tr style="background:${zi % 2 ? "#f4f9fd" : "#ffffff"}">` +
        z.map((w, i) =>
          i === 4 && w
            ? `<td style="border:1px solid #cfe3f2"><a href="${esc(w)}" style="color:#0079b8">zum Artikel</a></td>`
            : `<td style="border:1px solid #cfe3f2"${i <= 1 ? ' align="right"' : ""}>${esc(w)}</td>`,
        ).join("") + `</tr>`).join("") +
      `</table>` +
      `<p style="font-family:Arial,sans-serif;font-size:10.5pt;color:#555">` +
      `${zuVersenden.length} Positionen, ${zuVersenden.reduce((s, b) => s + b.anzahl, 0)} St&uuml;ck gesamt</p>`;

    const text = [SPALTEN.join("\t"), ...zellen.map((z) => z.join("\t"))].join("\n");

    try {
      // Beide Formate in die Zwischenablage: Outlook nimmt das HTML und macht
      // eine formatierte Tabelle daraus, alles andere greift auf den Text zurück.
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html":  new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      show("📋 Tabelle kopiert. Jetzt in die Mail einfügen", "success");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        show("📋 Als Text kopiert (Tabellenformat vom Browser nicht unterstützt)", "warning");
      } catch {
        show("Kopieren nicht möglich. Bitte Text unten manuell markieren", "error");
      }
    }
  }

  const eingabe = "w-full px-3 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">🛒 Bestellanfragen Eigenbedarf</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
            Wird montags gesammelt an die Standortleitung geschickt und von dort an den Einkauf weitergegeben.
          </p>
        </div>
        {zaehler.data && (
          <div className="flex gap-2 flex-wrap">
            {STATUS_REIHE.map((s) => {
              const n = zaehler.data[s] ?? 0;
              // Abgeschlossene Zustände nur zeigen, wenn es sie gibt — sonst
              // stehen dauerhaft zwei Nullen in der Kopfzeile.
              if (n === 0 && (s === "NICHT_GENEHMIGT" || s === "STORNIERT")) return null;
              return (
                <button key={s} onClick={() => setFilter(filter === s ? null : s)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${STATUS_STIL[s]} ${filter === s ? "ring-2 ring-offset-1 ring-[#0064d2]" : ""}`}>
                  {STATUS_KURZ[s]}: {n}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Montags-Versand ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border-2 border-[#f7b928]/40 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
          <div>
            <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">📤 Bestellliste verschicken</h2>
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">
              {zuVersenden.length === 0
                ? "Keine offenen Positionen."
                : `${zuVersenden.length} offene Positionen, ${zuVersenden.reduce((s, b) => s + b.anzahl, 0)} Stück gesamt.`}
            </p>
          </div>
          {zuVersenden.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setVorschau((v) => !v)}
                className="px-4 py-2.5 text-sm font-bold rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">
                {vorschau ? "Vorschau ausblenden" : "Vorschau anzeigen"}
              </button>
              <button onClick={kopieren}
                className="px-5 py-2.5 text-sm font-bold rounded-xl bg-[#202F61] text-white hover:bg-[#18244a]">
                📋 Tabelle kopieren
              </button>
            </div>
          )}
        </div>

        {vorschau && zuVersenden.length > 0 && (
          <div className="overflow-x-auto border border-[#ced4da] dark:border-[#3e4042] rounded-lg mb-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#008BD2] text-white">
                  {SPALTEN.map((s) => <th key={s} className="text-left px-2 py-1.5 font-bold">{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {zuVersenden.map((b, i) => (
                  <tr key={b.id} className={i % 2 ? "bg-[#f4f9fd] dark:bg-[#1c2b33]" : "bg-white dark:bg-[#242526]"}>
                    <td className="px-2 py-1.5 tabular-nums text-right text-[#65676b] dark:text-[#b0b3b8]">{i + 1}</td>
                    <td className="px-2 py-1.5 tabular-nums text-right font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{b.anzahl}</td>
                    <td className="px-2 py-1.5 text-[#1a1a1a] dark:text-[#e4e6eb]">{b.hersteller ?? ""}</td>
                    <td className="px-2 py-1.5 text-[#1a1a1a] dark:text-[#e4e6eb]">{b.beschreibung}</td>
                    <td className="px-2 py-1.5">
                      {b.link
                        ? <a href={b.link} target="_blank" rel="noopener noreferrer"
                            className="text-[#0064d2] dark:text-[#45bdff] underline">zum Artikel</a>
                        : <span className="text-[#90939a]">—</span>}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{heute}</td>
                    <td className="px-2 py-1.5 text-[#65676b] dark:text-[#b0b3b8]">{b.verwendungsort ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {zuVersenden.length > 0 && darfVerwalten && (
          <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-[#f0f2f5] dark:border-[#3e4042]">
            <button
              onClick={() => versendet.mutate({ ids: zuVersenden.map((b) => b.id) })}
              disabled={versendet.isPending}
              className="px-4 py-2 text-sm font-bold rounded-xl bg-[#04B475]/10 text-[#038F5C] dark:text-[#04B475] border border-[#04B475]/30 hover:bg-[#04B475]/20 disabled:opacity-50">
              ✓ Ist raus: als bestellt markieren
            </button>
            <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Erst klicken, wenn die Mail wirklich verschickt ist. Danach zählen die Positionen als bestellt.
            </span>
          </div>
        )}
      </div>

      {/* ── Neue Position ───────────────────────────────────────────────── */}
      {darfErfassen && (
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">Neue Position</h2>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-1">
            <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Anzahl *</label>
            <input type="number" min={1} value={form.anzahl}
              onChange={(e) => setForm({ ...form, anzahl: e.target.value })} className={eingabe} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Hersteller</label>
            <input type="text" value={form.hersteller} placeholder="z. B. Würth"
              onChange={(e) => setForm({ ...form, hersteller: e.target.value })} className={eingabe} />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Verwendungsort / Person</label>
            <input type="text" value={form.verwendungsort} placeholder="z. B. Refurbishment"
              onChange={(e) => setForm({ ...form, verwendungsort: e.target.value })} className={eingabe} />
          </div>
          <div className="md:col-span-6">
            <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Artikelbeschreibung *</label>
            <input type="text" value={form.beschreibung} placeholder="genaue Bezeichnung, wie sie bestellt werden soll"
              onChange={(e) => setForm({ ...form, beschreibung: e.target.value })} className={eingabe} />
          </div>
          <div className="md:col-span-6">
            <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Link zum Artikel</label>
            <input type="text" value={form.link} placeholder="https://…"
              onChange={(e) => setForm({ ...form, link: e.target.value })} className={eingabe} />
          </div>
        </div>
        <button
          onClick={() => anlegen.mutate({
            anzahl:         Number(form.anzahl) || 1,
            hersteller:     form.hersteller.trim()     || undefined,
            beschreibung:   form.beschreibung.trim(),
            link:           form.link.trim()           || undefined,
            verwendungsort: form.verwendungsort.trim() || undefined,
          })}
          disabled={form.beschreibung.trim().length < 2 || anlegen.isPending}
          className="mt-4 px-6 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50">
          {anlegen.isPending ? "…" : "Hinzufügen"}
        </button>
      </div>
      )}

      {/* ── Liste ───────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap p-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
            {filter ? STATUS_LABEL[filter] : "Alle Positionen"}
          </h2>
          <input type="text" value={suche} onChange={(e) => setSuche(e.target.value)}
            placeholder="Suchen…" className={`${eingabe} max-w-xs`} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#008BD2]/10 dark:bg-[#008BD2]/15 text-xs font-bold uppercase text-[#0079b8] dark:text-[#45bdff] border-b-2 border-[#008BD2]/30">
                <th className="px-3 py-2.5 text-right">Pos.</th>
                <th className="px-3 py-2.5 text-right">Anz.</th>
                <th className="px-3 py-2.5 text-left">Artikel</th>
                <th className="px-3 py-2.5 text-left">Verwendung</th>
                <th className="px-3 py-2.5 text-left">Angefordert</th>
                <th className="px-3 py-2.5 text-left">Status</th>
                {darfVerwalten && <th className="px-3 py-2.5 text-right">Aktionen</th>}
              </tr>
            </thead>
            <tbody>
              {(liste.data ?? []).map((b, i) => (
                // Zebrastreifen statt Trennlinien: ruhiger und bei langen Listen
                // verrutscht das Auge nicht so leicht.
                <tr key={b.id}
                  className={`${i % 2 ? "bg-[#f4f9fd] dark:bg-[#1c2b33]" : ""} hover:bg-[#008BD2]/10 dark:hover:bg-[#008BD2]/20 transition-colors`}>
                  <td className="px-3 py-2 text-right tabular-nums text-[#90939a]">{i + 1}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{b.anzahl}</td>
                  <td className="px-3 py-2">
                    <div className="text-[#1a1a1a] dark:text-[#e4e6eb]">
                      {b.hersteller && <span className="font-semibold">{b.hersteller} </span>}
                      {b.beschreibung}
                    </div>
                    {b.link && (
                      <a href={b.link} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-[#0064d2] dark:text-[#45bdff] underline">
                        zum Artikel ↗
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[#65676b] dark:text-[#b0b3b8]">{b.verwendungsort ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">
                    {datumDe(b.angefordertAm)}<br />
                    <span className="text-[#90939a]">{b.angefordertVon}</span>
                  </td>
                  <td className="px-3 py-2">
                    {/* Auswahlfeld statt wechselnder Knöpfe: Jeder Zustand ist
                        jederzeit erreichbar, auch Korrekturen zurück. */}
                    <select
                      value={b.status}
                      onChange={(e) => aendern.mutate({ id: b.id, status: e.target.value as Status })}
                      disabled={!darfVerwalten}
                      className={`px-2 py-1 text-xs font-bold rounded border outline-none ${darfVerwalten ? "cursor-pointer" : "cursor-default appearance-none"} ${STATUS_STIL[b.status]}`}
                      aria-label={`Status von ${b.beschreibung.slice(0, 40)}`}
                    >
                      {STATUS_REIHE.map((s) => (
                        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                    {b.versendetAm && (
                      <div className="text-[10px] text-[#90939a] mt-0.5">raus: {datumDe(b.versendetAm)}</div>
                    )}
                  </td>
                  {darfVerwalten && (
                  <td className="px-3 py-2">
                    <div className="flex gap-1.5 justify-end flex-wrap">
                      <button
                        onClick={() => setBearbeite({
                          id: b.id, anzahl: String(b.anzahl),
                          hersteller: b.hersteller ?? "", beschreibung: b.beschreibung,
                          link: b.link ?? "", verwendungsort: b.verwendungsort ?? "",
                          notiz: b.notiz ?? "",
                        })}
                        className="px-2.5 py-1 text-xs font-bold rounded-lg border border-[#0064d2]/30 text-[#0064d2] dark:text-[#45bdff] hover:bg-[#0064d2]/10">
                        ✏️
                      </button>
                      {/* Schnellzugriff für den häufigsten Schritt; alles Weitere
                          läuft über die Status-Auswahl links. */}
                      {b.status === "BESTELLT" && (
                        <button onClick={() => aendern.mutate({ id: b.id, status: "GELIEFERT" })}
                          className="px-2.5 py-1 text-xs font-bold rounded-lg bg-[#04B475]/10 text-[#038F5C] dark:text-[#04B475] border border-[#04B475]/30 hover:bg-[#04B475]/20">
                          ✓ Geliefert
                        </button>
                      )}
                      <button onClick={() => { if (confirm(`„${b.beschreibung.slice(0, 60)}" wirklich löschen?`)) loeschen.mutate({ id: b.id }); }}
                        className="px-2.5 py-1 text-xs font-bold rounded-lg text-[#fa3e3e] hover:bg-[#fa3e3e]/10">
                        🗑️
                      </button>
                    </div>
                  </td>
                  )}
                </tr>
              ))}
              {(liste.data ?? []).length === 0 && (
                <tr><td colSpan={darfVerwalten ? 7 : 6} className="text-center py-10 text-[#65676b] dark:text-[#b0b3b8]">
                  Keine Positionen
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bearbeiten ──────────────────────────────────────────────────── */}
      <Modal open={!!bearbeite} onClose={() => setBearbeite(null)} title="Position bearbeiten" width="max-w-2xl">
        {bearbeite && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Anzahl *</label>
                <input type="number" min={1} value={bearbeite.anzahl}
                  onChange={(e) => setBearbeite({ ...bearbeite, anzahl: e.target.value })} className={eingabe} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Hersteller</label>
                <input type="text" value={bearbeite.hersteller}
                  onChange={(e) => setBearbeite({ ...bearbeite, hersteller: e.target.value })} className={eingabe} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Artikelbeschreibung *</label>
              <input type="text" value={bearbeite.beschreibung}
                onChange={(e) => setBearbeite({ ...bearbeite, beschreibung: e.target.value })} className={eingabe} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Link zum Artikel</label>
              <input type="text" value={bearbeite.link}
                onChange={(e) => setBearbeite({ ...bearbeite, link: e.target.value })} className={eingabe} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Verwendungsort / Person</label>
              <input type="text" value={bearbeite.verwendungsort}
                onChange={(e) => setBearbeite({ ...bearbeite, verwendungsort: e.target.value })} className={eingabe} />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] mb-1">Notiz (intern)</label>
              <input type="text" value={bearbeite.notiz} placeholder="erscheint nicht in der Bestellliste"
                onChange={(e) => setBearbeite({ ...bearbeite, notiz: e.target.value })} className={eingabe} />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setBearbeite(null)}
                className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
                Abbrechen
              </button>
              <button
                onClick={() => aendern.mutate({
                  id:             bearbeite.id,
                  anzahl:         Number(bearbeite.anzahl) || 1,
                  hersteller:     bearbeite.hersteller.trim()     || null,
                  beschreibung:   bearbeite.beschreibung.trim(),
                  link:           bearbeite.link.trim()           || null,
                  verwendungsort: bearbeite.verwendungsort.trim() || null,
                  notiz:          bearbeite.notiz.trim()          || null,
                })}
                disabled={bearbeite.beschreibung.trim().length < 2 || aendern.isPending}
                className="flex-1 py-2.5 rounded-xl bg-[#0064d2] text-white font-bold hover:bg-blue-700 disabled:opacity-50">
                {aendern.isPending ? "…" : "Speichern"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
