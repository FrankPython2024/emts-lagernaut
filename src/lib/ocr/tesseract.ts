import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { normalisiere } from "@/modules/teilenummern/normalisierung";

const fuehreAus = promisify(execFile);

// ── Teilenummern vom Foto lesen, ohne fremdes Kontingent ─────────────────────
//
// Tesseract läuft im eigenen Container. Keine Anmeldung, keine Tagesgrenze,
// kein Netz nach draußen — und rund eine Sekunde statt der knapp neunzehn, die
// die Anfrage an Gemini gekostet hat.
//
// ⚠️ Was hier NICHT passiert: verstehen. Tesseract liest Zeichen, sonst nichts.
// Teiltyp und Hersteller kommen weiterhin nur aus der Bilderkennung oder vom
// Menschen. Dafür erfindet Tesseract auch nichts — im Zweifel verstümmelt er,
// und eine verstümmelte Nummer findet in der Suche schlicht nichts. Ein
// sichtbares Scheitern ist hier mehr wert als eine flüssige Falschaussage.
//
// ── Was am 21.08.2026 an vier echten Teilen gemessen wurde ──────────────────
//
//   gedrucktes Etikett   HP-Akku       SS03XL        gelesen ✓
//   gedrucktes Etikett   Tastatur      SN20V43652    gelesen ✓
//   Siebdruck Platine    USB-Board     DA0X8JTB8D0   NICHT gelesen
//   Siebdruck Platine    Mainboard     NM-C931       NICHT gelesen
//   Prägung Kunststoff   D-Cover       EAX3J004A1S   NICHT gelesen
//
// Kontrastanhebung und Graustufen halfen beim Siebdruck NICHT (eigener Lauf,
// selbe Bilder). Die Grenze verläuft an der Oberfläche, nicht an der Schärfe.
// Deshalb ist das hier ein VORLAUF, kein Ersatz: Was Tesseract nicht liest,
// geht auf Knopfdruck weiter an die Bilderkennung.

/** Betriebsart „ein Block Text". Der Unterschied ist gewaltig — siehe unten. */
const PSM = "6";

/** Nach dieser Zeit gilt ein Bild als nicht lesbar. Lieber weiter als warten. */
const ZEITLIMIT_MS = 8_000;

export type OcrErgebnis = {
  /** Kandidaten in der Reihenfolge, in der sie angeboten werden sollen. */
  nummern:  string[];
  /** Roher Text, gekürzt — nur zur Fehlersuche, nicht für die Anzeige. */
  auszug:   string;
  dauerMs:  number;
};

/**
 * Taugt diese Zeichenkette als Teilenummer-Kandidat?
 *
 * ⚠️ Strenger als `istPlausibel` beim Scannen, und das ist an Messwerten
 * kalibriert. Die lockere Regel (ab 5 Zeichen, mindestens eine Ziffer) ließ
 * `2S01L` vom USB-Board und `22020` vom D-Cover durch — reinen Lesemüll, der
 * echt aussieht. Genau solche Kandidaten sind gefährlich: Sie stünden dem
 * Menschen als Vorschlag gegenüber, ohne dass irgendetwas dahinter ist.
 *
 * Mindestens sechs Zeichen UND Buchstaben UND Ziffern schneidet den gemessenen
 * Müll weg und lässt jede echte Nummer durch:
 *   SS03XL ✓  SN20V43652 ✓  5N20V43724 ✓  CMFNBL84US ✓
 *   2S01L ✗   22020 ✗       383085 ✗      3ICP6 ✗
 *
 * Reine Ziffernfolgen fallen bewusst mit heraus. Sie sind fast nie das, wonach
 * sich suchen lässt, und ein Foto liefert reichlich davon (Datumscodes,
 * Kabelaufdrucke, Bauteilwerte).
 */
export function istNummernKandidat(roh: string): boolean {
  const n = normalisiere(roh);
  return /^[A-Z0-9]{6,20}$/.test(n) && /[0-9]/.test(n) && /[A-Z]/.test(n);
}

/**
 * Reihenfolge der Vorschläge.
 *
 * Teilenummern liegen erfahrungsgemäß zwischen acht und vierzehn Zeichen und
 * mischen Buchstaben und Ziffern kräftig. Was dem näher kommt, steht vorn —
 * der Mensch soll nicht suchen müssen.
 */
function guete(n: string): number {
  const ziffern = (n.match(/[0-9]/g) ?? []).length;
  const mischung = Math.min(ziffern, n.length - ziffern);
  const laenge = n.length >= 8 && n.length <= 14 ? 2 : 0;
  return mischung + laenge;
}

/**
 * Ein Bild lesen. Fehler werden verschluckt — ein unleserliches Bild ist ein
 * normaler Ausgang, kein Defekt.
 */
async function leseBild(pfad: string): Promise<string> {
  try {
    const { stdout } = await fuehreAus(
      "tesseract",
      [pfad, "stdout", "-l", "eng", "--psm", PSM],
      { timeout: ZEITLIMIT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    return "";
  }
}

/**
 * Alle mitgeschickten Bilder lesen und die Kandidaten einsammeln.
 *
 * ⚠️ ALLE Bilder, auch die Übersicht. Beim Messen war das ganze Bild bei
 * Etiketten sogar besser als der Zuschnitt: Ein starres Raster schneidet mitten
 * durch die Beschriftung, und was durchtrennt ist, liest niemand mehr. Deshalb
 * wird beides gelesen und vereinigt, statt sich auf eine Quelle zu verlassen.
 */
export async function leseNummern(
  bilder: { base64: string; mimeType: string }[],
): Promise<OcrErgebnis> {
  const beginn = Date.now();
  if (bilder.length === 0) return { nummern: [], auszug: "", dauerMs: 0 };

  const ordner = await mkdtemp(join(tmpdir(), "ocr-"));
  try {
    const pfade = await Promise.all(bilder.map(async (b, i) => {
      const endung = b.mimeType === "image/png" ? "png" : b.mimeType === "image/webp" ? "webp" : "jpg";
      const p = join(ordner, `bild${i}.${endung}`);
      await writeFile(p, Buffer.from(b.base64, "base64"));
      return p;
    }));

    const texte = await Promise.all(pfade.map(leseBild));
    const text = texte.join("\n");

    const gefunden = new Set<string>();
    for (const stueck of text.split(/[^A-Za-z0-9]+/)) {
      if (istNummernKandidat(stueck)) gefunden.add(normalisiere(stueck));
    }

    const nummern = Array.from(gefunden)
      .sort((a, b) => guete(b) - guete(a) || a.localeCompare(b))
      .slice(0, 8);

    return {
      nummern,
      auszug: text.replace(/\s+/g, " ").trim().slice(0, 400),
      dauerMs: Date.now() - beginn,
    };
  } finally {
    await rm(ordner, { recursive: true, force: true }).catch(() => {});
  }
}

/** Ist Tesseract im Container vorhanden? Einmal geprüft, dann gemerkt. */
let vorhanden: boolean | null = null;

export async function istEingerichtet(): Promise<boolean> {
  if (vorhanden !== null) return vorhanden;
  try {
    await fuehreAus("tesseract", ["--version"], { timeout: 3_000 });
    vorhanden = true;
  } catch {
    vorhanden = false;
  }
  return vorhanden;
}
