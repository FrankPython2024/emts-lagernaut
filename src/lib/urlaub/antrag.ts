// ── Urlaubsantrag als Word-Datei (29.09.2026) ─────────────────────────────────
//
// Wunsch Frank: Zu jedem eingetragenen Urlaub den AfB-Urlaubsantrag erzeugen —
// „genau so" wie das Original, nur mit den jeweiligen Daten.
// Deshalb KEIN nachgebautes Dokument, sondern Franks Original als Vorlage
// (src/lib/urlaub/vorlage/urlaubsantrag.docx): Nur Texte sind durch Platzhalter
// ersetzt, in die drei Kästchen ist ein Textfeld für das „X" eingesetzt. Alle
// anderen Teile der Datei sind Byte für Byte das Original (geprüft beim Bau).
//
// ⚠️ Die Vorlage liegt bewusst NICHT unter public/ — sie ist nicht öffentlich.
// Reine Logik (bekommt die Vorlage als Buffer), Test: `npm run test:urlaub`.

import { leseZip, schreibeZip } from "@/lib/zip/einfach";

export const URLAUBSARTEN = ["ERHOLUNG", "UNBEZAHLT", "SONDER"] as const;
export type Urlaubsart = (typeof URLAUBSARTEN)[number];
export const URLAUBSART_TEXT: Record<Urlaubsart, string> = {
  ERHOLUNG: "Erholungsurlaub", UNBEZAHLT: "Unbezahlter Urlaub", SONDER: "Sonderurlaub",
};

export type AntragDaten = {
  nachname:    string;
  vorname:     string;
  personalnr:  string;
  /** „JJJJ-MM-TT" */
  von:         string;
  bis:         string;
  tage:        number;
  urlaubsart:  Urlaubsart;
  sondergrund: string | null;
  /** Datum unten neben „Sömmerda," — „JJJJ-MM-TT" */
  datum:       string;
};

const UNTERSTRICHE = "__________________________________________________";

export const deDatum = (tag: string) => `${tag.slice(8, 10)}.${tag.slice(5, 7)}.${tag.slice(0, 4)}`;
export const deZahl = (n: number) => String(n).replace(".", ",");

function xmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Füllt die Vorlage; wirft, wenn ein Platzhalter fehlt oder übrig bleibt. */
export function fuelleAntrag(vorlage: Buffer, d: AntragDaten): Buffer {
  const eintraege = leseZip(vorlage);
  const werte: Record<string, string> = {
    NACHNAME:    d.nachname.trim(),
    VORNAME:     d.vorname.trim(),
    PERSONALNR:  d.personalnr.trim(),
    VON:         deDatum(d.von),
    BIS:         deDatum(d.bis),
    TAGE:        deZahl(d.tage),
    // Ohne Grund bleibt die Unterstrich-Linie des Originals stehen.
    SONDERGRUND: d.urlaubsart === "SONDER" && d.sondergrund?.trim() ? d.sondergrund.trim() : UNTERSTRICHE,
    DATUM:       deDatum(d.datum),
    X_ERHOLUNG:  d.urlaubsart === "ERHOLUNG" ? "X" : "",
    X_UNBEZAHLT: d.urlaubsart === "UNBEZAHLT" ? "X" : "",
    X_SONDER:    d.urlaubsart === "SONDER" ? "X" : "",
  };
  let gefunden = false;
  const neu = eintraege.map((e) => {
    if (e.name === "word/document.xml") {
      gefunden = true;
      let xml = e.daten.toString("utf8");
      for (const [k, v] of Object.entries(werte)) {
        const platzhalter = `{{${k}}}`;
        if (!xml.includes(platzhalter)) throw new Error(`Vorlage ohne Platzhalter ${platzhalter}`);
        xml = xml.split(platzhalter).join(xmlText(v));
      }
      const rest = /\{\{[A-Z_]+\}\}/.exec(xml);
      if (rest) throw new Error(`Platzhalter übrig: ${rest[0]}`);
      return { name: e.name, daten: Buffer.from(xml, "utf8") };
    }
    if (e.name === "docProps/core.xml") {
      // „Zuletzt geändert von" soll die antragstellende Person sein, nicht Frank.
      const xml = e.daten.toString("utf8").replace(
        /<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/,
        `<cp:lastModifiedBy>${xmlText(`${d.nachname.trim()}, ${d.vorname.trim()}`)}</cp:lastModifiedBy>`,
      );
      return { name: e.name, daten: Buffer.from(xml, "utf8") };
    }
    return e;
  });
  if (!gefunden) throw new Error("Vorlage ohne word/document.xml");
  return schreibeZip(neu);
}

/** Dateiname: „Urlaubsantrag Roth 2026-10-07.docx" */
export function antragDateiname(nachname: string, von: string): string {
  return `Urlaubsantrag ${nachname.trim() || "Antrag"} ${von}.docx`;
}
