/**
 * Tests für die Wegführung im Pickup (src/lib/pickup/route.ts).
 *
 * Ausführen:  npx tsx tests/pickupRoute.test.ts   (oder: npm run test:route)
 *
 * Anlass: Am Handgerät suchte man zu lange, womit man anfängt — die Liste zeigte
 * Collis nach Menge statt einen Weg. Beispiel „Richard 179" (23.09.2026): Start am
 * hinteren Ende, dann 07-32 → 07-30 → 07-32 → 07-30 → 07-28 → 07-30 → 07-32 → …
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import {
  zerlegeStellplatz, gangVon, ordneWeg, planeRunden, naechsterHalt, richtungVon,
} from "../src/lib/pickup/route";

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

// Echte Verteilung aus Auftrag #183 „Richard 179" (Stellplatz → gesuchte Geräte).
const RICHARD: [string, number][] = [
  ["HL-06-05-01", 1], ["HL-06-06-01", 3], ["HL-06-07-01", 3], ["HL-06-08-01", 1], ["HL-06-08-02", 8],
  ["HL-06-11-01", 6], ["HL-06-12-02", 10], ["HL-06-17-01", 3], ["HL-06-18-01", 3], ["HL-06-19-01", 10],
  ["HL-06-22-01", 13], ["HL-06-23-01", 2], ["HL-06-24-01", 2], ["HL-07-01-01", 1], ["HL-07-02-01", 3],
  ["HL-07-03-01", 7], ["HL-07-07-01", 9], ["HL-07-08-01", 12], ["HL-07-08-02", 14], ["HL-07-11-01", 14],
  ["HL-07-12-01", 3], ["HL-07-14-01", 1], ["HL-07-15-01", 7], ["HL-07-16-01", 6], ["HL-07-17-01", 6],
  ["HL-07-19-01", 1], ["HL-07-22-01", 7], ["HL-07-23-01", 7], ["HL-07-28-01", 1], ["HL-07-30-01", 11],
  ["HL-07-32-01", 4],
];

console.log("\n── Stellplatz zerlegen ──");
check("Hochregal", zerlegeStellplatz("HL-07-08-02"), { prefix: "HL", zahlen: [7, 8, 2] });
check("ohne führende Nullen", zerlegeStellplatz("HL-1-1-3"), { prefix: "HL", zahlen: [1, 1, 3] });
check("ETL mit Halle", zerlegeStellplatz("ETL-HL-4-2-1"), { prefix: "ETL-HL", zahlen: [4, 2, 1] });
check("reiner Text", zerlegeStellplatz("Broker"), { prefix: "BROKER", zahlen: [] });

console.log("\n── Gegenüberliegende Reihen = ein Gang ──");
check("06 und 07 liegen gegenüber", gangVon(6) === gangVon(7), true);
check("05 gehört nicht dazu", gangVon(5) === gangVon(6), false);

console.log("\n── Laufreihenfolge ──");
const wegR = ordneWeg(RICHARD.map(([k]) => k));
check("alle 31 Stellplätze dabei", wegR.length, 31);
check("beginnt vorne im Gang", wegR.slice(0, 4), ["HL-07-01-01", "HL-07-02-01", "HL-07-03-01", "HL-06-05-01"]);
check(
  "links und rechts im Wechsel (Platz 12: 06 direkt neben 07)",
  Math.abs(wegR.indexOf("HL-06-12-02") - wegR.indexOf("HL-07-12-01")),
  1,
);
check("Ebene innerhalb eines Platzes", wegR.indexOf("HL-06-08-01") < wegR.indexOf("HL-06-08-02"), true);
check("endet hinten", wegR[wegR.length - 1], "HL-07-32-01");
check(
  "Reihenfolge hängt nicht von der Eingabe ab",
  ordneWeg([...RICHARD.map(([k]) => k)].reverse()),
  wegR,
);

const schlange = ordneWeg(["HL-04-01-01", "HL-04-09-01", "HL-06-01-01", "HL-06-09-01"]);
check(
  "Schlangenlinie: erster Gang hinauf, zweiter herunter",
  schlange,
  ["HL-04-01-01", "HL-04-09-01", "HL-06-09-01", "HL-06-01-01"],
);
check(
  "Lücke zwischen Gängen bricht die Schlangenlinie nicht",
  ordneWeg(["HL-02-01-01", "HL-02-05-01", "HL-08-01-01", "HL-08-05-01"]),
  ["HL-02-01-01", "HL-02-05-01", "HL-08-05-01", "HL-08-01-01"],
);
check("ohne Stellplatz immer zuletzt", ordneWeg(["", "HL-06-05-01", "Broker"]).at(-1), "");
check(
  "andere Formate natürlich sortiert (2 vor 10)",
  ordneWeg(["ETL-HL-4-10-1", "ETL-HL-4-2-1"]),
  ["ETL-HL-4-2-1", "ETL-HL-4-10-1"],
);

console.log("\n── 80/20: Hauptrunde und Restrunde ──");
const offenR = new Map(RICHARD);
const rundenR = planeRunden(offenR, wegR);
check("Hauptrunde trägt mindestens 80 %", rundenR.anteilHaupt >= 0.8, true);
check("Hauptrunde ist deutlich kleiner als alle Plätze", rundenR.haupt.size < 31 * 0.7, true);
check("die beiden vollsten sind drin", rundenR.haupt.has("HL-07-08-02") && rundenR.haupt.has("HL-07-11-01"), true);
check("Einzelstücke landen in der Restrunde", [...rundenR.haupt].some((k) => offenR.get(k) === 1), false);
check(
  "wenige Stellplätze: keine Restrunde",
  planeRunden(new Map([["A", 5], ["B", 1], ["C", 1]]), ["A", "B", "C"]).haupt.size,
  3,
);
check("nichts offen: leere Hauptrunde", planeRunden(new Map([["A", 0]]), ["A"]).haupt.size, 0);

console.log("\n── Nächster Halt ──");
const start = naechsterHalt({ weg: wegR, offen: offenR, haupt: rundenR.haupt, aktuell: null, richtung: 1 });
check("Start am vollsten Stellplatz (14, früher auf dem Weg)", start, "HL-07-08-02");
check(
  "bleibt stehen, solange dort etwas offen ist",
  naechsterHalt({ weg: wegR, offen: offenR, haupt: rundenR.haupt, aktuell: "HL-06-22-01", richtung: 1 }),
  "HL-06-22-01",
);

const klein = ["A", "B", "C", "D", "E"];
const alle = new Set(klein);
check(
  "nächstgelegener offener Halt",
  naechsterHalt({ weg: klein, offen: new Map([["A", 1], ["B", 0], ["C", 0], ["D", 0], ["E", 1]]), haupt: alle, aktuell: "D", richtung: -1 }),
  "E",
);
check(
  "Gleichstand: in Laufrichtung weiter (vorwärts)",
  naechsterHalt({ weg: klein, offen: new Map([["B", 1], ["C", 0], ["D", 1]]), haupt: alle, aktuell: "C", richtung: 1 }),
  "D",
);
check(
  "Gleichstand: in Laufrichtung weiter (rückwärts)",
  naechsterHalt({ weg: klein, offen: new Map([["B", 1], ["C", 0], ["D", 1]]), haupt: alle, aktuell: "C", richtung: -1 }),
  "B",
);
check(
  "Hauptrunde vor Restrunde, auch wenn ein Rest-Platz näher liegt",
  naechsterHalt({ weg: klein, offen: new Map([["B", 1], ["C", 0], ["E", 9]]), haupt: new Set(["E"]), aktuell: "C", richtung: 1 }),
  "E",
);
check(
  "Hauptrunde leer → Restrunde",
  naechsterHalt({ weg: klein, offen: new Map([["B", 1], ["C", 0], ["E", 0]]), haupt: new Set(["E"]), aktuell: "C", richtung: 1 }),
  "B",
);
check(
  "alles erledigt → kein Halt",
  naechsterHalt({ weg: klein, offen: new Map([["A", 0]]), haupt: alle, aktuell: "A", richtung: 1 }),
  null,
);
check("Richtung aus einem Wechsel", richtungVon(klein, "B", "D", -1), 1);
check("Richtung ohne Vorgänger bleibt", richtungVon(klein, null, "D", -1), -1);

console.log("\n── Durchgespielt: ganzer Auftrag „Richard 179\" ──");
{
  const offen = new Map(RICHARD);
  const haupt = rundenR.haupt;
  let aktuell: string | null = null;
  let richtung: 1 | -1 = 1;
  const besucht: string[] = [];
  let weg = 0;
  let wenden = 0;
  for (let i = 0; i < 100; i++) {
    const n = naechsterHalt({ weg: wegR, offen, haupt, aktuell, richtung });
    if (n === null) break;
    if (aktuell !== null) {
      weg += Math.abs(wegR.indexOf(n) - wegR.indexOf(aktuell));
      const neu = richtungVon(wegR, aktuell, n, richtung);
      if (neu !== richtung) wenden++;
      richtung = neu;
    }
    besucht.push(n);
    offen.set(n, 0); // alles an diesem Platz gescannt
    aktuell = n;
  }
  check("jeder Stellplatz genau einmal", besucht.length === 31 && new Set(besucht).size === 31, true);
  const letzterHaupt = Math.max(...besucht.map((k, i) => (haupt.has(k) ? i : -1)));
  const ersterRest = besucht.findIndex((k) => !haupt.has(k));
  check("erst die komplette Hauptrunde, dann der Rest", letzterHaupt < ersterRest, true);
  const geraeteNachHaupt = RICHARD.filter(([k]) => haupt.has(k)).reduce((s, [, n]) => s + n, 0);
  console.log(`     Hauptrunde: ${haupt.size} von 31 Stellplätzen, ${geraeteNachHaupt} von 179 Geräten`);
  console.log(`     Weglänge (Plätze in Laufreihenfolge): ${weg}, Richtungswechsel: ${wenden}`);
  check("höchstens drei Richtungswechsel (Hauptrunde, Rückweg, Restrunde)", wenden <= 3, true);
}

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
