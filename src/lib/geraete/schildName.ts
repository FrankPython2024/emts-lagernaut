/**
 * Zerlegt einen Gerätenamen in die drei Zeilen eines Karton-Schilds.
 *
 * Die Schilder am Regal sehen so aus:
 *
 *     [Dell-Logo]        Precision            [AfB-Logo]
 *                          5570
 *
 *     [Dell-Logo]         Latitude            [AfB-Logo]
 *                           7320
 *                        Detachable
 *
 * Also: Serie klein oben, Modell groß darunter, optional ein Zusatz.
 *
 * ⚠️ Die AfB-/Hersteller-Maschinennummer muss weg. „ThinkPad T590 20N5S1M000"
 * gehört als „ThinkPad / T590" aufs Schild — die 20N5S1M000 beschreibt eine
 * konkrete Konfiguration, nicht das Modell, und im Karton liegen Teile aus
 * mehreren Konfigurationen desselben Modells. Stünde sie drauf, sähe der Karton
 * enger aus, als er ist, und jemand legt ein passendes Teil daneben.
 *
 * Reine Logik ohne DB — prüfbar über tests/schildName.test.ts.
 */

import { ERLAUBTE_HERSTELLER_LISTE } from "@/lib/geraete/herstellerFilter";

export type SchildName = {
  /** Herstellername in der Schreibweise des Projekts, z. B. "Lenovo". null = unbekannt. */
  hersteller: string | null;
  /** Produktlinie, kleine Zeile oben. Kann leer sein, wenn der Name keine hergibt. */
  serie:      string;
  /** Modellbezeichnung, große Zeile. Das eigentliche Erkennungsmerkmal. */
  modell:     string;
  /** Dritte Zeile, z. B. "Detachable". Leer, wenn es nichts zu ergänzen gibt. */
  zusatz:     string;
};

/**
 * Bekannte Produktlinien. Nur zur Erkennung der SCHREIBWEISE und mehrteiliger
 * Namen — ein unbekannter erster Begriff wird trotzdem als Serie genommen,
 * damit neue Linien nicht durchs Raster fallen.
 */
const SERIEN = [
  // Lenovo
  "ThinkPad", "ThinkBook", "ThinkCentre", "ThinkStation", "IdeaPad", "Yoga", "Legion",
  // HP
  "EliteBook", "ProBook", "ZBook", "EliteDesk", "ProDesk", "EliteOne", "Pavilion",
  "Chromebook", "ElitePad", "Envy", "Spectre",
  // Dell
  "Latitude", "Precision", "OptiPlex", "Vostro", "Inspiron", "XPS",
  // Fujitsu
  "LifeBook", "Lifebook", "Celsius", "Esprimo", "Stylistic",
] as const;

/** Zusätze, die als eigene dritte Zeile gehören statt an die Modellnummer geklebt. */
const ZUSAETZE = ["Detachable", "Convertible", "Touch", "Tablet", "2-in-1"] as const;

/**
 * Sieht dieses Wort nach einer Maschinen-/Konfigurationsnummer aus?
 *
 * Beispiele aus echten Exporten: 20N5S1M000, 20QQS0KL00, 20W5S2KSDE, 5CG0326GZ5.
 * Merkmale: mindestens 8 Zeichen, nur Großbuchstaben und Ziffern, und BEIDES
 * kommt vor.
 *
 * ⚠️ Die Längengrenze ist der Schutz vor Fehlalarm. Echte Modellnamen wie
 * „T14s", „G5", „840", „5570" oder „X1" liegen alle darunter. Bei 6 oder 7
 * würde „EB840G7" oder ähnliches mitgerissen.
 */
export function istMaschinennummer(wort: string): boolean {
  const w = wort.trim();
  if (w.length < 8) return false;
  if (!/^[A-Z0-9]+$/.test(w)) return false;
  return /[A-Z]/.test(w) && /[0-9]/.test(w);
}

/** Findet die im Projekt übliche Schreibweise eines Herstellers. */
function erkenneHersteller(wort: string): string | null {
  const l = wort.trim().toLowerCase();
  return ERLAUBTE_HERSTELLER_LISTE.find((h) => h.toLowerCase() === l) ?? null;
}

/** Findet die kanonische Schreibweise einer bekannten Serie ("thinkpad" → "ThinkPad"). */
function erkenneSerie(wort: string): string | null {
  const l = wort.trim().toLowerCase();
  return SERIEN.find((s) => s.toLowerCase() === l) ?? null;
}

function istZusatz(wort: string): string | null {
  const l = wort.trim().toLowerCase();
  return ZUSAETZE.find((z) => z.toLowerCase() === l) ?? null;
}

/**
 * Erkennungsschlüssel eines Schilds — entscheidet, ob es „dasselbe Schild" ist.
 *
 * Aus Hersteller, Serie, Modell und Zusatz, klein geschrieben und auf
 * Buchstaben/Ziffern reduziert. Damit gelten „Lenovo ThinkPad T480s",
 * „lenovo thinkpad t480s" und „Lenovo  ThinkPad  T480s" als ein und dasselbe
 * Schild.
 *
 * ⚠️ Das FACH gehört bewusst NICHT dazu. Ein Modell kann umziehen, ohne dass
 * daraus ein anderes Schild wird — sonst gälte jeder Umzug als neues Schild und
 * die Frage „gibt es das schon?" wäre nicht mehr beantwortbar.
 */
export function schildSchluessel(s: Pick<SchildName, "hersteller" | "serie" | "modell" | "zusatz">): string {
  return [s.hersteller ?? "", s.serie, s.modell, s.zusatz]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Zerlegt einen Gerätenamen für das Schild.
 *
 * Verträgt beide Schreibweisen des Projekts: MIT Hersteller-Präfix
 * (`GeraeteLookup.bereinigt`, z. B. „HP EliteBook 840 G5") und OHNE
 * (`Artikel.bezeichnung`, z. B. „EliteBook 840 G5"). Ein separat bekannter
 * Hersteller kann übergeben werden und gewinnt gegenüber dem Namen.
 */
export function zerlegeGeraetename(name: string, herstellerBekannt?: string | null): SchildName {
  const woerter = (name ?? "").trim().split(/\s+/).filter((w) => w.length > 0);

  let hersteller = herstellerBekannt ? erkenneHersteller(herstellerBekannt) ?? herstellerBekannt.trim() : null;

  // Führenden Hersteller aus dem Namen nehmen, falls vorhanden.
  if (woerter.length > 0) {
    const treffer = erkenneHersteller(woerter[0]!);
    if (treffer) {
      if (!hersteller) hersteller = treffer;
      woerter.shift();
    }
  }

  // Maschinennummern hinten abschneiden — es können mehrere sein.
  while (woerter.length > 1 && istMaschinennummer(woerter[woerter.length - 1]!)) {
    woerter.pop();
  }

  // Zusätze vom Ende abtrennen (in Originalreihenfolge wieder zusammensetzen).
  const zusaetze: string[] = [];
  while (woerter.length > 1) {
    const z = istZusatz(woerter[woerter.length - 1]!);
    if (!z) break;
    zusaetze.unshift(z);
    woerter.pop();
  }

  // Serie = erstes Wort, in kanonischer Schreibweise falls bekannt.
  let serie = "";
  if (woerter.length > 1) {
    const kanonisch = erkenneSerie(woerter[0]!);
    serie = kanonisch ?? woerter[0]!;
    woerter.shift();
  }

  return {
    hersteller,
    serie,
    modell: woerter.join(" "),
    zusatz: zusaetze.join(" "),
  };
}
