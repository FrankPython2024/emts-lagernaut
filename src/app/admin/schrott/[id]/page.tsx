"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";

// ── Schrottabholung: ein Auftrag ─────────────────────────────────────────────
//
// Oben die Eingabemaske, darunter die Tabelle, unten die Summen. Nach dem
// Hinzufügen springt der Fokus zurück auf die Colli-Nummer — so lassen sich
// zwanzig Collis erfassen, ohne die Hand von der Tastatur zu nehmen. Ein
// Handscanner tippt die Nummer und drückt Enter, das genügt.

const MAX_STELLPLAETZE = 33;

// Farben je Abfallschlüssel, in der Reihenfolge des ersten Auftretens.
// ⚠️ Die Farbe trägt KEINE eigene Aussage — der Schlüssel steht als Zahl
// daneben. Sie hilft nur, die Gruppen beim Überfliegen zu trennen, deshalb
// reicht eine helle Tönung und der Text behält seinen normalen Kontrast.
const GRUPPENFARBEN = ["#008BD2", "#04B475", "#f7b928", "#7F77DD", "#D85A30", "#65676b"];

function kg(n: number): string {
  return n.toLocaleString("de-DE");
}

export default function SchrottAuftragSeite() {
  const params = useParams<{ id: string }>();
  const auftragId = Number(params?.id);
  const { has } = usePermissions();
  const darfBearbeiten = has("SCHROTT_MANAGE");
  const { show } = useToast();

  const auftrag  = api.schrott.auftrag.useQuery({ id: auftragId }, { enabled: Number.isFinite(auftragId) });
  const arten    = api.schrott.abfallarten.useQuery();

  // Eingabefelder. Abfalllager und Versandart merken sich ihren letzten Wert —
  // innerhalb eines Auftrags ändern sie sich praktisch nie.
  const [colliNummer, setColliNummer] = useState("");
  const [abfalllager, setAbfalllager] = useState("Produktlager");
  const [abfallartId, setAbfallartId] = useState<number | null>(null);
  const [brutto, setBrutto]           = useState("");
  const [netto, setNetto]             = useState("");
  const [versandart, setVersandart]   = useState("GIBO");
  const nummerRef = useRef<HTMLInputElement>(null);

  const [artOffen, setArtOffen] = useState(false);
  const [neueArt, setNeueArt]   = useState({ bezeichnung: "", kurzform: "", schluessel: "", taraKg: "85" });

  const gewaehlteArt = arten.data?.find((a) => a.id === abfallartId) ?? null;

  const hinzufuegen = api.schrott.colliHinzufuegen.useMutation({
    onSuccess: () => {
      void auftrag.refetch();
      setColliNummer(""); setBrutto(""); setNetto("");
      nummerRef.current?.focus();
    },
    onError: (e) => show(e.message, "error"),
  });
  const loeschen = api.schrott.colliLoeschen.useMutation({
    onSuccess: () => void auftrag.refetch(),
    onError:   (e) => show(e.message, "error"),
  });
  const artAnlegen = api.schrott.abfallartAnlegen.useMutation({
    onSuccess: (a) => {
      void arten.refetch();
      setAbfallartId(a.id);
      setArtOffen(false);
      setNeueArt({ bezeichnung: "", kurzform: "", schluessel: "", taraKg: "85" });
      show("Abfallart angelegt", "success");
    },
    onError: (e) => show(e.message, "error"),
  });

  // Brutto eingeben, Netto rechnet sich über das Leergewicht der Abfallart.
  // Überschreibbar: Wer einen anderen Behälter hat, tippt Netto einfach selbst.
  function bruttoGeaendert(wert: string) {
    setBrutto(wert);
    const b = Number(wert);
    const tara = gewaehlteArt?.taraKg;
    if (Number.isFinite(b) && b > 0 && tara != null) setNetto(String(Math.max(0, b - tara)));
  }

  // ── Sortierung und Farbgruppen ──────────────────────────────────────────
  // Sortiert nach Abfallschlüssel, darin nach Abfallart, darin nach
  // Erfassungsreihenfolge. So stehen zusammen, was zusammen entsorgt wird.
  const zeilen = useMemo(() => {
    const c = [...(auftrag.data?.collis ?? [])];
    c.sort((a, b) =>
      a.schluessel.localeCompare(b.schluessel)
      || a.kurzform.localeCompare(b.kurzform)
      || a.position - b.position);
    return c;
  }, [auftrag.data]);

  const farbeVon = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of zeilen) {
      if (!m.has(z.schluessel)) m.set(z.schluessel, GRUPPENFARBEN[m.size % GRUPPENFARBEN.length]!);
    }
    return m;
  }, [zeilen]);

  // Summen je Schlüssel — beim Abfallnachweis wird pro Schlüsselnummer gemeldet.
  const proSchluessel = useMemo(() => {
    const m = new Map<string, { anzahl: number; brutto: number; netto: number; kurz: Set<string> }>();
    for (const z of zeilen) {
      const e = m.get(z.schluessel) ?? { anzahl: 0, brutto: 0, netto: 0, kurz: new Set<string>() };
      e.anzahl++; e.brutto += z.bruttoKg; e.netto += z.nettoKg; e.kurz.add(z.kurzform);
      m.set(z.schluessel, e);
    }
    return [...m.entries()];
  }, [zeilen]);

  const stellplaetze = zeilen.length;
  const gesamtBrutto = zeilen.reduce((s, z) => s + z.bruttoKg, 0);
  const gesamtNetto  = zeilen.reduce((s, z) => s + z.nettoKg, 0);

  // ── Für die E-Mail ──────────────────────────────────────────────────────
  async function kopieren() {
    const kopf = ["Colli", "Abfalllager", "Abfallschlüsselnummer", "Bruttogewicht", "Nettogewicht", "Abfallart", "Versandart"];
    const daten = zeilen.map((z) => [z.colliNummer, z.abfalllager, z.schluessel, String(z.bruttoKg), String(z.nettoKg), z.kurzform, z.versandart]);

    const text = [
      kopf.join("\t"),
      ...daten.map((r) => r.join("\t")),
      "",
      `${stellplaetze} Stellplätze\tGesamtgewicht\t${gesamtBrutto}\t${gesamtNetto}`,
    ].join("\n");

    const td = "padding:4px 8px;border:1px solid #999;";
    const html = `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt">
<tr>${kopf.map((h) => `<th style="${td}background:#008BD2;color:#fff;text-align:left">${h}</th>`).join("")}</tr>
${daten.map((r) => `<tr>${r.map((c, i) => `<td style="${td}${i === 3 || i === 4 ? "text-align:right" : ""}">${c}</td>`).join("")}</tr>`).join("\n")}
<tr><td style="${td}font-weight:bold">${stellplaetze} Stellplätze</td><td style="${td}"></td><td style="${td}font-weight:bold">Gesamtgewicht</td><td style="${td}text-align:right;font-weight:bold">${gesamtBrutto}</td><td style="${td}text-align:right;font-weight:bold">${gesamtNetto}</td><td style="${td}"></td><td style="${td}"></td></tr>
</table>`;

    try {
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
        show("Kopieren nicht möglich. Bitte die Tabelle markieren und kopieren", "error");
      }
    }
  }

  const eingabe = "w-full px-3 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[48px]";
  const bereit = colliNummer.trim() && abfallartId && Number(brutto) > 0 && Number(netto) >= 0;

  if (auftrag.isLoading) return <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Wird geladen…</p>;
  if (!auftrag.data)     return <p className="text-sm text-[#8A5A00] dark:text-[#f7b928]">Auftrag nicht gefunden.</p>;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/schrott" className="text-sm font-bold text-[#0064d2] dark:text-[#45bdff]">← Alle Aufträge</Link>
        <h1 className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] mt-1">{auftrag.data.bezeichnung}</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
          {new Date(auftrag.data.datum).toLocaleDateString("de-DE")} · angelegt von {auftrag.data.erstelltVon}
        </p>
      </div>

      {/* ── Eingabemaske ─────────────────────────────────────────────────── */}
      {darfBearbeiten && (
        <div className="rounded-xl border border-[#008BD2]/40 bg-[#008BD2]/5 p-5 space-y-3">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <div>
              <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Colli-Nummer</label>
              <input
                ref={nummerRef} autoFocus value={colliNummer}
                onChange={(e) => setColliNummer(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && bereit) document.getElementById("schrott-hinzu")?.click(); }}
                placeholder="scannen oder tippen" className={`${eingabe} font-mono`} />
            </div>
            <div>
              <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Abfalllager</label>
              <input value={abfalllager} onChange={(e) => setAbfalllager(e.target.value)} className={eingabe} />
            </div>
            <div className="min-w-[240px]">
              <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Abfallart</label>
              <select value={abfallartId ?? ""} onChange={(e) => setAbfallartId(Number(e.target.value) || null)} className={eingabe}>
                <option value="">bitte wählen</option>
                {(arten.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.bezeichnung} — {a.schluessel}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Brutto (kg)</label>
              <input inputMode="numeric" value={brutto} onChange={(e) => bruttoGeaendert(e.target.value)} className={`${eingabe} tabular-nums`} />
            </div>
            <div>
              <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
                Netto (kg)
                {gewaehlteArt?.taraKg != null && (
                  <span className="ml-1 font-normal text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    (Tara {gewaehlteArt.taraKg})
                  </span>
                )}
              </label>
              <input inputMode="numeric" value={netto} onChange={(e) => setNetto(e.target.value)} className={`${eingabe} tabular-nums`} />
            </div>
            <div>
              <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Versandart</label>
              <input value={versandart} onChange={(e) => setVersandart(e.target.value)} className={eingabe} />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <button
              id="schrott-hinzu"
              onClick={() => hinzufuegen.mutate({
                auftragId, colliNummer, abfalllager,
                abfallartId: abfallartId!, bruttoKg: Number(brutto), nettoKg: Number(netto), versandart,
              })}
              disabled={!bereit || hinzufuegen.isPending}
              className="px-5 py-3 rounded-xl bg-[#04B475] text-white font-bold text-base min-h-[56px] disabled:opacity-50"
            >
              {hinzufuegen.isPending ? "…" : "+ Colli hinzufügen"}
            </button>
            <button
              onClick={() => setArtOffen((v) => !v)}
              className="px-4 py-3 rounded-xl border-2 border-[#0064d2] text-[#0064d2] dark:text-[#45bdff] font-bold text-sm min-h-[56px]"
            >
              {artOffen ? "Abbrechen" : "Abfallart fehlt?"}
            </button>
          </div>

          {/* Abfallart bei Bedarf direkt hier anlegen — dort, wo sie fehlt. */}
          {artOffen && (
            <div className="rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-4 space-y-3">
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
                <div className="min-w-[240px]">
                  <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Bezeichnung</label>
                  <input value={neueArt.bezeichnung} onChange={(e) => setNeueArt({ ...neueArt, bezeichnung: e.target.value })}
                    placeholder="z. B. Bildschirme, LCD" className={eingabe} />
                </div>
                <div>
                  <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Kurzform</label>
                  <input value={neueArt.kurzform} onChange={(e) => setNeueArt({ ...neueArt, kurzform: e.target.value })}
                    placeholder="z. B. Bildsch." className={eingabe} />
                </div>
                <div>
                  <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Schlüsselnummer</label>
                  <input value={neueArt.schluessel} onChange={(e) => setNeueArt({ ...neueArt, schluessel: e.target.value })}
                    placeholder="160213" className={`${eingabe} font-mono`} />
                </div>
                <div>
                  <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Leergewicht (kg)</label>
                  <input inputMode="numeric" value={neueArt.taraKg} onChange={(e) => setNeueArt({ ...neueArt, taraKg: e.target.value })} className={`${eingabe} tabular-nums`} />
                </div>
              </div>
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                Die Kurzform steht später in der Auftragstabelle. Sie muss die Arten
                unterscheidbar halten: Zwei Arten mit demselben Schlüssel und
                derselben Kurzform wären in der Tabelle nicht auseinanderzuhalten.
              </p>
              <button
                onClick={() => artAnlegen.mutate({
                  bezeichnung: neueArt.bezeichnung.trim(),
                  kurzform:    neueArt.kurzform.trim(),
                  schluessel:  neueArt.schluessel.trim(),
                  taraKg:      neueArt.taraKg.trim() === "" ? null : Number(neueArt.taraKg),
                  sortierung:  500,
                })}
                disabled={neueArt.bezeichnung.trim().length < 2 || neueArt.kurzform.trim().length < 1 || neueArt.schluessel.trim().length < 4 || artAnlegen.isPending}
                className="px-5 py-3 rounded-xl bg-[#0064d2] text-white font-bold text-sm min-h-[48px] disabled:opacity-50"
              >
                {artAnlegen.isPending ? "…" : "Abfallart anlegen und auswählen"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Summen ───────────────────────────────────────────────────────── */}
      <div className={`rounded-xl border-2 p-5 ${stellplaetze > MAX_STELLPLAETZE ? "border-[#c62828] bg-[#c62828]/8" : "border-[#038F5C] bg-[#04B475]/8"}`}>
        <div className="flex gap-6 flex-wrap items-baseline">
          <div>
            <div className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] tabular-nums">{stellplaetze}</div>
            <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">Stellplätze</div>
          </div>
          <div>
            <div className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] tabular-nums">{kg(gesamtBrutto)}</div>
            <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">kg brutto</div>
          </div>
          <div>
            <div className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] tabular-nums">{kg(gesamtNetto)}</div>
            <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wide">kg netto</div>
          </div>
          <button
            onClick={kopieren}
            disabled={stellplaetze === 0}
            className="ml-auto px-5 py-3 rounded-xl bg-[#202F61] text-white font-bold text-base min-h-[56px] disabled:opacity-40"
          >
            📋 Für E-Mail kopieren
          </button>
        </div>
        {stellplaetze > MAX_STELLPLAETZE && (
          <p className="text-sm font-black text-[#c62828] dark:text-[#ff8a80] mt-3">
            Mehr als {MAX_STELLPLAETZE} Stellplätze. Auf einen LKW passen {MAX_STELLPLAETZE}.
          </p>
        )}
      </div>

      {/* ── Die Tabelle ──────────────────────────────────────────────────── */}
      {zeilen.length === 0 ? (
        <div className="text-center py-16 text-[#65676b] dark:text-[#b0b3b8] border border-dashed border-[#ced4da] dark:border-[#3e4042] rounded-2xl">
          Noch kein Colli erfasst. Oben eintragen.
        </div>
      ) : (
        <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#ced4da] dark:border-[#3e4042] text-left">
                <th className="py-2 px-3 font-bold text-[#65676b] dark:text-[#b0b3b8]">Colli</th>
                <th className="py-2 px-3 font-bold text-[#65676b] dark:text-[#b0b3b8]">Abfalllager</th>
                <th className="py-2 px-3 font-bold text-[#65676b] dark:text-[#b0b3b8]">Schlüssel</th>
                <th className="py-2 px-3 font-bold text-[#65676b] dark:text-[#b0b3b8] text-right">Brutto</th>
                <th className="py-2 px-3 font-bold text-[#65676b] dark:text-[#b0b3b8] text-right">Netto</th>
                <th className="py-2 px-3 font-bold text-[#65676b] dark:text-[#b0b3b8]">Abfallart</th>
                <th className="py-2 px-3 font-bold text-[#65676b] dark:text-[#b0b3b8]">Versand</th>
                {darfBearbeiten && <th className="py-2 px-3" />}
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => {
                const farbe = farbeVon.get(z.schluessel)!;
                return (
                  <tr key={z.id}
                    className="border-b border-[#ced4da]/60 dark:border-[#3e4042]/60"
                    style={{ backgroundColor: `${farbe}14`, boxShadow: `inset 4px 0 0 ${farbe}` }}>
                    <td className="py-2 px-3 font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{z.colliNummer}</td>
                    <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8]">{z.abfalllager}</td>
                    <td className="py-2 px-3 font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{z.schluessel}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]">{kg(z.bruttoKg)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]">{kg(z.nettoKg)}</td>
                    <td className="py-2 px-3 text-[#1a1a1a] dark:text-[#e4e6eb]">{z.kurzform}</td>
                    <td className="py-2 px-3 text-[#65676b] dark:text-[#b0b3b8]">{z.versandart}</td>
                    {darfBearbeiten && (
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => { if (window.confirm(`Colli ${z.colliNummer} entfernen?`)) loeschen.mutate({ id: z.id }); }}
                          className="text-xs font-bold text-[#c62828] dark:text-[#ff8a80] px-2 py-1">
                          entfernen
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Summen je Schlüsselnummer — so wird der Abfall auch gemeldet. */}
      {proSchluessel.length > 1 && (
        <div className="rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] p-5">
          <div className="text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">Je Abfallschlüssel</div>
          <div className="space-y-1.5">
            {proSchluessel.map(([schl, e]) => (
              <div key={schl} className="flex items-center gap-3 flex-wrap text-sm">
                <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: farbeVon.get(schl) }} aria-hidden />
                <span className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb] w-20">{schl}</span>
                <span className="text-[#65676b] dark:text-[#b0b3b8] flex-1 min-w-[140px]">{[...e.kurz].join(", ")}</span>
                <span className="tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {e.anzahl} Stellplätze · {kg(e.brutto)} kg brutto · {kg(e.netto)} kg netto
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
