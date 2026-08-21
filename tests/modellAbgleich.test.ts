/**
 * Tests für den Modell-Abgleich (src/modules/teilenummern/modellAbgleich.ts).
 *
 * Ausführen:  npx tsx tests/modellAbgleich.test.ts   (oder: npm run test:abgleich)
 *
 * Die Fundstellen unten sind ECHT: Ergebnis der Suche nach DA0X8JTB8D0 über
 * unsere SearXNG-Instanz am 20.08.2026, unverändert übernommen. Genau an
 * diesen acht Texten ist der alte Abgleich gescheitert — er fand kein einziges
 * ProBook 440 G6, obwohl fünf davon das Board ausdrücklich so zuordnen.
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import {
  tokenisiere,
  zerlegeModell,
  bereiteStellenVor,
  gleicheModellAb,
  type Textstelle,
} from "../src/modules/teilenummern/modellAbgleich";

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

// ── Zerlegung ───────────────────────────────────────────────────────────────
console.log("\n══ ZERLEGUNG ══");

check("440G6 ohne Leerzeichen wird getrennt",
  tokenisiere("HP 440G6 Board"),
  ["HP", "440", "G6", "BOARD"]);

check("ProBook 440 G6 → Serie, Zahl, Generation",
  zerlegeModell("ProBook 440 G6"),
  { serie: ["PROBOOK"], zahl: "440", gen: "G6" });

check("ProBook x360 440 G1 → x360 bleibt Serienwort",
  zerlegeModell("ProBook x360 440 G1"),
  { serie: ["PROBOOK", "X360"], zahl: "440", gen: "G1" });

check("Latitude 5490 → keine Generation",
  zerlegeModell("Latitude 5490"),
  { serie: ["LATITUDE"], zahl: "5490", gen: null });

check("ThinkPad T480s → keine eigenständige Zahl (nur wörtlich vergleichbar)",
  zerlegeModell("ThinkPad T480s"),
  { serie: ["THINKPAD", "T480S"], zahl: null, gen: null });

// ── Die echten Fundstellen zu DA0X8JTB8D0 ───────────────────────────────────

const FUNDSTELLEN: Textstelle[] = [
  {
    titel:   "DA0X8JTB8D0 E114139 USB Board For HP ProBook 440 445R G6 G7 ZHAN ... - eBay",
    ausriss: "Original DA0X8JTB8D0 E114139 USB Small Board For HP ProBook 440 445R G6 G7 ZHAN 66 PRO 14 G2 Laptop USB Card Board Note: This accessory may have some traces of transportation, 9-95 new, tested well, rest assured to buy.",
  },
  {
    titel:   "Zahara USB Power Switch ON-FF Button Board DA0X8JTB8D0 ...",
    ausriss: "Buy Zahara USB Power Switch ON-FF Button Board DA0X8JTB8D0 L44578-001 Replacement for HP 440 G6 440 G7 / 450 G6 450 G7 / 445 G6 445 G7 / 455 G6 455 G7 / 430 ...",
  },
  {
    titel:   "HP ProBook 15.6” 450 G7 Genuine Laptop USB Port Board w/Cable ...",
    ausriss: "Specifications ; BrandHP ; ConditionUsed ; CategoryCables & Connectors ; Screen Size15.6\" ; Part NumberDA0X8JTB8D0 ...",
  },
  {
    titel:   "GinTai USB Power Button Board Without Cable for HP 440 G6 /440 ...",
    ausriss: "Buy GinTai USB Power Button Board Without Cable for HP 440 G6 /440 G7 /450 G6 | 450 G7 /445 G6 /445 G7 /455 G6/ 455 G7/ DA0X8JTB8D0 L44578-001 USB Power ...",
  },
  {
    titel:   "L44578-001 For HP ProBook 440 450 G6 Power USB Board ... - eBay",
    ausriss: "Find many great new & used options and get the best deals for L44578-001 For HP ProBook 440 450 G6 Power USB Board DA0X8JTB8D0 at the best online prices at ...",
  },
  {
    titel:   "New DA0X8JTB8D0 For HP 440 G6 445 G6 66 14 G2 USB ... - eBay",
    ausriss: "New DA0X8JTB8D0 For HP 440 G6 445 G6 66 14 G2 USB Board Power Switch Module. Tanona International Limited (4905).",
  },
  {
    titel:   "HP ProBook 14” 440 G7 Genuine Laptop USB Port Board w/Cable ...",
    ausriss: "Stock picture. Specifications. Board TypeUSB Board. Part NumberDA0X8JTB8D0. Connector Type ...",
  },
  {
    titel:   "Amazon.com: CSEZWASM New USB Interface Board for HP 440 G6 ...",
    ausriss: "Buy CSEZWASM New USB Interface Board for HP 440 G6 445 G6 66 14 G2 USB Board DA0X8JTB8D0: Laptop Replacement Parts - Amazon.com ✓ FREE DELIVERY possible on ...",
  },
];

const STELLEN = bereiteStellenVor(FUNDSTELLEN);

/** Kurzform fürs Prüfen: „FAMILIE [2,4]" bzw. „-" wenn kein Treffer. */
function kurz(hersteller: string, modell: string): string {
  const t = gleicheModellAb({ hersteller, modell }, STELLEN);
  return t ? `${t.art} [${t.belege.join(",")}]` : "-";
}

console.log("\n══ FAMILIENANGABEN (der eigentliche Fehler) ══");

// Das ist der Testfall schlechthin: vorher 0 Treffer, obwohl es in fünf
// Fundstellen steht.
check("HP ProBook 440 G6 wird gefunden",
  kurz("HP", "ProBook 440 G6"), "FAMILIE [1,2,4,5,6,8]");

check("HP ProBook 440 G7 wird gefunden",
  kurz("HP", "ProBook 440 G7"), "FAMILIE [1,2,4,7]");

check("HP ProBook 450 G6 wird gefunden",
  kurz("HP", "ProBook 450 G6"), "FAMILIE [2,4,5]");

check("HP ProBook 450 G7 wird gefunden",
  kurz("HP", "ProBook 450 G7"), "FAMILIE [2,3,4]");

check("HP ProBook 445 G6 wird gefunden",
  kurz("HP", "ProBook 445 G6"), "FAMILIE [2,4,6,8]");

check("HP ProBook 445 G7 wird gefunden",
  kurz("HP", "ProBook 445 G7"), "FAMILIE [2,4]");

check("HP ProBook 455 G6 wird gefunden",
  kurz("HP", "ProBook 455 G6"), "FAMILIE [2,4]");

check("HP ProBook 430 G6 wird gefunden (steht nur in Fundstelle 2)",
  kurz("HP", "ProBook 430 G6"), "FAMILIE [2]");

console.log("\n══ WAS NICHT PASSIEREN DARF ══");

// Nachbargenerationen. Sie stehen nirgends und dürfen nicht auftauchen —
// genau so ein Fehltreffer (G7 statt G6) hat den Fehler überhaupt erst
// sichtbar gemacht.
check("ProBook 440 G4 kommt nicht vor", kurz("HP", "ProBook 440 G4"), "-");
check("ProBook 440 G5 kommt nicht vor", kurz("HP", "ProBook 440 G5"), "-");
check("ProBook 440 G8 kommt nicht vor", kurz("HP", "ProBook 440 G8"), "-");
check("ProBook x360 440 G1 kommt nicht vor", kurz("HP", "ProBook x360 440 G1"), "-");

// „445 G6 66 14 G2": Ohne enges Fenster würde das G2 aus „ZHAN 66 Pro 14 G2"
// an die 445 andocken. Das ist der Grund für FENSTER = 3.
check("Das G2 aus ZHAN 66 Pro 14 G2 erzeugt kein ProBook 445 G2",
  kurz("HP", "ProBook 445 G2"), "-");
check("… und auch kein ProBook 440 G2",
  kurz("HP", "ProBook 440 G2"), "-");

// Hersteller-Klammer: In keiner Fundstelle steht Dell oder Lenovo.
check("Dell Latitude 5490 schlägt nicht an", kurz("Dell", "Latitude 5490"), "-");
check("Lenovo ThinkPad T480s schlägt nicht an", kurz("Lenovo", "ThinkPad T480s"), "-");

console.log("\n══ WÖRTLICHE TREFFER SCHLAGEN FAMILIE ══");

const AUSGESCHRIEBEN = bereiteStellenVor([
  { titel: "Genuine HP ProBook 440 G6 USB Board", ausriss: "Part DA0X8JTB8D0" },
  { titel: "for HP 440 G6 445 G6", ausriss: "DA0X8JTB8D0" },
]);

check("Voller Name im Text → WOERTLICH, nicht FAMILIE",
  (() => {
    const t = gleicheModellAb({ hersteller: "HP", modell: "ProBook 440 G6" }, AUSGESCHRIEBEN);
    return t ? `${t.art} [${t.belege.join(",")}]` : "-";
  })(),
  "WOERTLICH [1]");

console.log(`\n══════════════════════════════════════════`);
console.log(`  📊 ${passed} passed  |  ${failed} failed`);
console.log(`══════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
