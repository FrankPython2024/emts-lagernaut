"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

// ── Bestellanfragen Eigenbedarf ──────────────────────────────────────────────
// Ersetzt die wöchentliche Excel-Liste. Montags werden alle offenen Positionen
// als Tabelle kopiert, per Mail an den Standortleiter geschickt (der sie zum
// Einkauf weitergibt) und danach auf „bestellt" gesetzt.
//
// Der Kopiertext geht als HTML in die Zwischenablage, damit er in Outlook als
// echte Tabelle ankommt. Als Rückfall liegt derselbe Inhalt zusätzlich als
// Text mit Tabulatoren drin — den nimmt jedes Programm an.

const STATUS_LABEL: Record<string, string> = {
  OFFEN: "Offen", BESTELLT: "Bestellt", GELIEFERT: "Geliefert", STORNIERT: "Storniert",
};
const STATUS_STIL: Record<string, string> = {
  OFFEN:     "bg-[#f7b928]/15 text-[#a67908] dark:text-[#f7b928] border-[#f7b928]/40",
  BESTELLT:  "bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] border-[#0064d2]/30",
  GELIEFERT: "bg-[#04B475]/10 text-[#038F5C] dark:text-[#04B475] border-[#04B475]/30",
  STORNIERT: "bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] border-[#ced4da] dark:border-[#3e4042]",
};

const SPALTEN = ["Anzahl", "Hersteller", "Artikelbeschreibung", "Link zum Artikel", "Datum", "Verwendungsort / Person"];

const datumDe = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("de-DE") : "";

export default function BestellanfragenPage() {
  const { show } = useToast();
  const utils = api.useUtils();

  const [filter, setFilter] = useState<"OFFEN" | "BESTELLT" | "GELIEFERT" | "STORNIERT" | null>(null);
  const [suche, setSuche]   = useState("");
  const [form, setForm]     = useState({ anzahl: "1", hersteller: "", beschreibung: "", link: "", verwendungsort: "" });
  const [vorschau, setVorschau] = useState(false);

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
    onSuccess: () => neuLaden(), onError: (e) => show(e.message, "error"),
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

    const zellen = zuVersenden.map((b) => [
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
      `<p>Bestellanfrage Eigenbedarf &ndash; AfB S&ouml;mmerda &ndash; ${heute}</p>` +
      `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt">` +
      `<tr style="background:#202F61;color:#fff;font-weight:bold">` +
      SPALTEN.map((s) => `<th align="left">${esc(s)}</th>`).join("") + `</tr>` +
      zellen.map((z) => `<tr>` + z.map((w, i) =>
        i === 3 && w
          ? `<td><a href="${esc(w)}">${esc(w)}</a></td>`
          : `<td>${esc(w)}</td>`).join("") + `</tr>`).join("") +
      `</table>` +
      `<p>${zuVersenden.length} Positionen, ${zuVersenden.reduce((s, b) => s + b.anzahl, 0)} St&uuml;ck gesamt</p>`;

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
      show("📋 Tabelle kopiert — jetzt in die Mail einfügen", "success");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        show("📋 Als Text kopiert (Tabellenformat vom Browser nicht unterstützt)", "warning");
      } catch {
        show("Kopieren nicht möglich — bitte Text unten manuell markieren", "error");
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
            {(["OFFEN", "BESTELLT", "GELIEFERT"] as const).map((s) => (
              <button key={s} onClick={() => setFilter(filter === s ? null : s)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${STATUS_STIL[s]} ${filter === s ? "ring-2 ring-offset-1 ring-[#0064d2]" : ""}`}>
                {STATUS_LABEL[s]}: {s === "OFFEN" ? zaehler.data.offen : s === "BESTELLT" ? zaehler.data.bestellt : zaehler.data.geliefert}
              </button>
            ))}
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
                <tr className="bg-[#202F61] text-white">
                  {SPALTEN.map((s) => <th key={s} className="text-left px-2 py-1.5 font-bold">{s}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                {zuVersenden.map((b) => (
                  <tr key={b.id}>
                    <td className="px-2 py-1.5 tabular-nums font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{b.anzahl}</td>
                    <td className="px-2 py-1.5 text-[#1a1a1a] dark:text-[#e4e6eb]">{b.hersteller ?? ""}</td>
                    <td className="px-2 py-1.5 text-[#1a1a1a] dark:text-[#e4e6eb]">{b.beschreibung}</td>
                    <td className="px-2 py-1.5 text-[#0064d2] dark:text-[#45bdff] max-w-[220px] truncate">{b.link ?? ""}</td>
                    <td className="px-2 py-1.5 tabular-nums text-[#65676b] dark:text-[#b0b3b8]">{heute}</td>
                    <td className="px-2 py-1.5 text-[#65676b] dark:text-[#b0b3b8]">{b.verwendungsort ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {zuVersenden.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-[#f0f2f5] dark:border-[#3e4042]">
            <button
              onClick={() => versendet.mutate({ ids: zuVersenden.map((b) => b.id) })}
              disabled={versendet.isPending}
              className="px-4 py-2 text-sm font-bold rounded-xl bg-[#04B475]/10 text-[#038F5C] dark:text-[#04B475] border border-[#04B475]/30 hover:bg-[#04B475]/20 disabled:opacity-50">
              ✓ Ist raus — als bestellt markieren
            </button>
            <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Erst klicken, wenn die Mail wirklich verschickt ist. Danach zählen die Positionen als bestellt.
            </span>
          </div>
        )}
      </div>

      {/* ── Neue Position ───────────────────────────────────────────────── */}
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
              <tr className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8]">
                <th className="px-3 py-2 text-right">Anz.</th>
                <th className="px-3 py-2 text-left">Artikel</th>
                <th className="px-3 py-2 text-left">Verwendung</th>
                <th className="px-3 py-2 text-left">Angefordert</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
              {(liste.data ?? []).map((b) => (
                <tr key={b.id} className="hover:bg-[#f0f2f5] dark:hover:bg-[#18191a]">
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{b.anzahl}</td>
                  <td className="px-3 py-2">
                    <div className="text-[#1a1a1a] dark:text-[#e4e6eb]">
                      {b.hersteller && <span className="font-semibold">{b.hersteller} </span>}
                      {b.beschreibung}
                    </div>
                    {b.link && (
                      <a href={b.link} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-[#0064d2] dark:text-[#45bdff] underline break-all">
                        {b.link.length > 70 ? b.link.slice(0, 70) + "…" : b.link}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[#65676b] dark:text-[#b0b3b8]">{b.verwendungsort ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">
                    {datumDe(b.angefordertAm)}<br />
                    <span className="text-[#90939a]">{b.angefordertVon}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 text-xs font-bold rounded border whitespace-nowrap ${STATUS_STIL[b.status]}`}>
                      {STATUS_LABEL[b.status]}
                    </span>
                    {b.versendetAm && (
                      <div className="text-[10px] text-[#90939a] mt-0.5">raus: {datumDe(b.versendetAm)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1.5 justify-end flex-wrap">
                      {b.status === "BESTELLT" && (
                        <button onClick={() => aendern.mutate({ id: b.id, status: "GELIEFERT" })}
                          className="px-2.5 py-1 text-xs font-bold rounded-lg bg-[#04B475]/10 text-[#038F5C] dark:text-[#04B475] border border-[#04B475]/30 hover:bg-[#04B475]/20">
                          ✓ Geliefert
                        </button>
                      )}
                      {b.status === "OFFEN" && (
                        <button onClick={() => aendern.mutate({ id: b.id, status: "STORNIERT" })}
                          className="px-2.5 py-1 text-xs font-bold rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">
                          Storno
                        </button>
                      )}
                      {b.status === "STORNIERT" && (
                        <button onClick={() => aendern.mutate({ id: b.id, status: "OFFEN" })}
                          className="px-2.5 py-1 text-xs font-bold rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">
                          Zurückholen
                        </button>
                      )}
                      <button onClick={() => { if (confirm(`„${b.beschreibung.slice(0, 60)}" wirklich löschen?`)) loeschen.mutate({ id: b.id }); }}
                        className="px-2.5 py-1 text-xs font-bold rounded-lg text-[#fa3e3e] hover:bg-[#fa3e3e]/10">
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(liste.data ?? []).length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-[#65676b] dark:text-[#b0b3b8]">
                  Keine Positionen
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
