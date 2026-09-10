/**
 * Tests für das Mapping des ReForm-Verwertungs-Exports
 * (src/modules/teilespender/mapping.ts).
 *
 * Ausführen:  npx tsx tests/teilespender.test.ts   (oder: npm run test:teilespender)
 *
 * Der Kern ist die letzte Gruppe: **Der Schlüssel aus dem Export und der aus
 * einer Anfrage müssen zusammenfinden.** Daran hängt die ganze Suche. Der Export
 * schreibt „ThinkPad L14 Gen 2 20X1S3T400", die Anfrage heißt
 * „Lenovo - ThinkPad L14 Gen 2" — gemessen an 934 echten Anfragen am
 * 09.09.2026: über den Schlüssel 97,3 % Treffer, über den rohen Namen 0,1 %.
 *
 * Alle Beispielzeilen stammen aus dem Export vom 09.09.2026.
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import { mappeSpenderZeile, fehlendeSpalten } from "../src/modules/teilespender/mapping";
import { modellSchluessel } from "../src/modules/teilespender/service";

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
    console.error(`     Erwartet: ${JSON.stringify(expected)}`);
    console.error(`     Bekommen: ${JSON.stringify(actual)}`);
  }
}

/** Eine Rohzeile wie papaparse sie liefert. */
function zeile(over: Record<string, string> = {}): Record<string, string> {
  return {
    LogId: "213.215.911",
    Hersteller: "Lenovo",
    Bezeichnung: "ThinkPad L14 Gen 2 20X1S3T400",
    Geräteart: "Notebook",
    Unterart: "",
    SNR: "PF2ABCDE",
    Zustand: "R-B",
    Defekte: "Akku defekt, Bios PW",
    Bemerkung: "",
    "Refurbishment nicht möglich": "1",
    Stellplatz: "ETL-HL-7-7-2",
    Colli: "3.186.244",
    Lager: "AfB Sömmerda",
    Lagernummer: "120",
    Prozessor: "Intel Core i5-1135G7",
    "AfB-Prozessorgeneration": "11",
    EK: "186,03",
    "auf Lager gebucht am": "2026-08-18 07:43:46.50",
    "Verweildauer auf Lager": "22",
    ...over,
  };
}

// ── Pflichtspalten ──────────────────────────────────────────────────────────
console.log("\n── Kopfzeile prüfen ──");

check("vollständige Kopfzeile", fehlendeSpalten(Object.keys(zeile())), []);
check(
  "fehlende Defekte-Spalte fällt auf",
  fehlendeSpalten(["LogId", "Bezeichnung", "Refurbishment nicht möglich"]),
  ["Defekte"],
);
check(
  "Lagerfuchs-Export wird nicht verwechselt",
  fehlendeSpalten(["LogId", "Bezeichnung", "Verbleib", "Colli", "Stellplatz"]),
  ["Defekte", "Refurbishment nicht möglich"],
);
// BOM am ersten Header darf die Prüfung nicht kippen.
check(
  "BOM am ersten Header stört nicht",
  fehlendeSpalten(["﻿LogId", "Defekte", "Refurbishment nicht möglich", "Bezeichnung"]),
  [],
);

// ── Zeile abbilden ──────────────────────────────────────────────────────────
console.log("\n── Zeile abbilden ──");

const m = mappeSpenderZeile(zeile());
check("LogID übernommen", m?.logId, "213.215.911");
check("Hersteller", m?.felder.hersteller, "Lenovo");
check("Stellplatz", m?.felder.stellplatz, "ETL-HL-7-7-2");
check("Colli", m?.felder.colli, "3.186.244");
check("Defekte roh gespeichert", m?.felder.defekteRoh, "Akku defekt, Bios PW");
check("Prozessorgeneration als Zahl", m?.felder.prozessorGen, 11);
check("EK deutsches Komma", m?.felder.ek, 186.03);
check("Verweildauer", m?.felder.verweildauerTage, 22);
check("ohne LogID keine Zeile", mappeSpenderZeile(zeile({ LogId: "" })), null);

console.log("\n── Freigabe zur Verwertung ──");

check("1 heißt freigegeben", mappeSpenderZeile(zeile())?.felder.verwertungFrei, true);
check("0 heißt nicht freigegeben", mappeSpenderZeile(zeile({ "Refurbishment nicht möglich": "0" }))?.felder.verwertungFrei, false);
// ⚠️ 14 Zeilen im Export vom 09.09.2026 sind leer. Leer gilt bewusst als NICHT
// freigegeben — lieber ein Spender zu wenig als ein zerlegtes Verkaufsgerät.
check("leer gilt als NICHT freigegeben", mappeSpenderZeile(zeile({ "Refurbishment nicht möglich": "" }))?.felder.verwertungFrei, false);

console.log("\n── Bemerkung statt Begründung ──");

// Der Vorgänger-Mapper liest „Begründung"; diese Spalte gibt es im Export nicht.
check("Bemerkung wird gelesen", mappeSpenderZeile(zeile({ Bemerkung: "Kunde storniert" }))?.felder.bemerkung, "Kunde storniert");
check("leere Bemerkung → null", mappeSpenderZeile(zeile({ Bemerkung: "" }))?.felder.bemerkung, null);

// ── Der Schlüssel — das Herzstück ───────────────────────────────────────────
console.log("\n── Export-Schlüssel trifft Anfrage-Schlüssel ──");

/** Trifft die Export-Zeile den Namen, unter dem eine Anfrage läuft? */
function trifft(bezeichnung: string, hersteller: string, anfrageName: string): boolean {
  const ausExport = mappeSpenderZeile(zeile({ Bezeichnung: bezeichnung, Hersteller: hersteller }))?.felder.modellKey;
  return ausExport === modellSchluessel(anfrageName);
}

// Echte Paare aus Export und Anfragen-Tabelle.
check(
  "Maschinennummer im Export, Bindestrich in der Anfrage",
  trifft("ThinkPad L14 Gen 2 20X1S3T400", "Lenovo", "Lenovo - ThinkPad L14 Gen 2"),
  true,
);
check(
  "Anfrage ohne Bindestrich",
  trifft("ThinkPad T580 20L9S0T800", "Lenovo", "Lenovo ThinkPad T580"),
  true,
);
check(
  "Groß-/Kleinschreibung egal",
  trifft("Latitude 5520", "Dell", "Dell Latitude 5520"),
  true,
);
check(
  "Kleinschreibung im Serienteil",
  trifft("Thinkpad T14s Gen 1 20UHS00R00", "Lenovo", "Lenovo - Thinkpad T14s Gen 1"),
  true,
);
// Fujitsu schreibt die Serie im Export durchgehend in Großbuchstaben.
check(
  "LIFEBOOK in Versalien trifft LifeBook",
  trifft("LIFEBOOK U7510", "Fujitsu", "Fujitsu LifeBook U7510"),
  true,
);

// ⚠️ Bekannte Lücke, hier festgehalten statt beschönigt: „7U15A1" hat sechs
// Zeichen und liegt damit unter der Längengrenze der Maschinennummer-Erkennung
// (die bei 8 liegt, damit echte Modellnamen wie „T14s" oder „G5" nicht
// mitgerissen werden). Diese Geräte stehen unter einem eigenen Schlüssel und
// werden über den regulären Namen nicht gefunden.
//
// Gemessen am Export vom 09.09.2026: **6 von 7.357 Geräten** (0,08 %), gegenüber
// 142 Geräten unter der sauberen Schreibweise. Der Fehler geht in die
// ungefährliche Richtung — ein Spender zu wenig, nie ein falsches Teil. Die
// Grenze zu senken würde echte Modellnamen zerschneiden und wäre der schlechtere
// Tausch.
check(
  "Restnummer unter 8 Zeichen bleibt hängen (bekannte Lücke)",
  trifft("Lifebook U7510 7U15A1", "Fujitsu", "Fujitsu LifeBook U7510"),
  false,
);

// Genauso wichtig: Nachbarmodelle dürfen NICHT zusammenfallen. Ein falscher
// Treffer schickt jemanden mit einem unpassenden Teil zurück an die Bank.
check(
  "andere Generation trifft nicht",
  trifft("ThinkPad L14 Gen 3 21C1S0T800", "Lenovo", "Lenovo - ThinkPad L14 Gen 2"),
  false,
);
check(
  "andere Baugröße trifft nicht",
  trifft("Latitude 5420", "Dell", "Dell Latitude 5520"),
  false,
);
check(
  "andere Serie trifft nicht",
  trifft("ThinkPad T580 20L9S0T800", "Lenovo", "Lenovo ThinkPad P580"),
  false,
);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
