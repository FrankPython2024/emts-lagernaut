/**
 * Tests für die Urlaubsplanung (src/lib/urlaub/tage.ts, team.ts).
 *
 * Ausführen:  npx tsx tests/urlaub.test.ts   (oder: npm run test:urlaub)
 * Reine Logik, kein Netz, keine Datenbank.
 */

import {
  ostersonntag, feiertageThueringen, istArbeitstag, arbeitstage, ueberschneiden, urlaubskonto,
  istGueltigesDatum, tageZwischen,
} from "../src/lib/urlaub/tage";
import { istImUrlaubTeam } from "../src/lib/urlaub/team";

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.error(`  ❌ ${label}\n     Erwartet: ${JSON.stringify(expected)}\n     Bekommen: ${JSON.stringify(actual)}`); }
}

console.log("\n── Ostern ──");
check("2026: 5. April", ostersonntag(2026), "2026-04-05");
check("2027: 28. März", ostersonntag(2027), "2027-03-28");
check("2025: 20. April", ostersonntag(2025), "2025-04-20");
check("2030: 21. April", ostersonntag(2030), "2030-04-21");

console.log("\n── Feiertage Thüringen 2026 ──");
const f26 = feiertageThueringen(2026);
check("11 Feiertage", f26.size, 11);
check("Karfreitag 3.4.", f26.get("2026-04-03"), "Karfreitag");
check("Ostermontag 6.4.", f26.get("2026-04-06"), "Ostermontag");
check("Himmelfahrt 14.5.", f26.get("2026-05-14"), "Christi Himmelfahrt");
check("Pfingstmontag 25.5.", f26.get("2026-05-25"), "Pfingstmontag");
check("Weltkindertag 20.9. (Thüringen)", f26.get("2026-09-20"), "Weltkindertag");
check("Reformationstag 31.10.", f26.get("2026-10-31"), "Reformationstag");
check("kein Fronleichnam (nur Eichsfeld)", f26.get("2026-06-04"), undefined);
check("Heiligabend kein Feiertag", f26.get("2026-12-24"), undefined);

console.log("\n── Arbeitstage ──");
check("Montag ist Arbeitstag", istArbeitstag("2026-09-28"), true);
check("Samstag nicht", istArbeitstag("2026-10-03"), false);
check("Tag der Einheit an einem Samstag", istArbeitstag("2026-10-03"), false);
check("Freitag 1.5. nicht", istArbeitstag("2026-05-01"), false);
check("eine Woche Mo–Fr = 5", arbeitstage({ von: "2026-10-05", bis: "2026-10-09" }), 5);
check("zwei Wochen mit Wochenende = 10", arbeitstage({ von: "2026-10-05", bis: "2026-10-18" }), 10);
check("Osterwoche Mo–Fr mit Karfreitag = 4", arbeitstage({ von: "2026-03-30", bis: "2026-04-03" }), 4);
check("Woche mit Ostermontag = 4", arbeitstage({ von: "2026-04-06", bis: "2026-04-10" }), 4);
check("halber Tag = 0,5", arbeitstage({ von: "2026-10-05", bis: "2026-10-05", halberTag: true }), 0.5);
check("halber Tag am Samstag = 0", arbeitstage({ von: "2026-10-10", bis: "2026-10-10", halberTag: true }), 0);
check("halber Tag über mehrere Tage wird ignoriert", arbeitstage({ von: "2026-10-05", bis: "2026-10-06", halberTag: true }), 2);
check("Weihnachten 21.12.–1.1. = 8 (24./31. zählen, 25.12. und 1.1. nicht)", arbeitstage({ von: "2026-12-21", bis: "2027-01-01" }), 8);
check("… davon 2026: 8", arbeitstage({ von: "2026-12-21", bis: "2027-01-01" }, 2026), 8);
check("… davon 2027: 0 (1.1. ist Feiertag)", arbeitstage({ von: "2026-12-21", bis: "2027-01-01" }, 2027), 0);
check("über Silvester anteilig: 28.12.–8.1. → 2026: 4, 2027: 5", [arbeitstage({ von: "2026-12-28", bis: "2027-01-08" }, 2026), arbeitstage({ von: "2026-12-28", bis: "2027-01-08" }, 2027)], [4, 5]);

console.log("\n── Überschneidung ──");
check("überlappend", ueberschneiden({ von: "2026-10-05", bis: "2026-10-09" }, { von: "2026-10-08", bis: "2026-10-12" }), true);
check("nur am Wochenende berührt → nein", ueberschneiden({ von: "2026-10-05", bis: "2026-10-10" }, { von: "2026-10-10", bis: "2026-10-11" }), false);
check("getrennt", ueberschneiden({ von: "2026-10-05", bis: "2026-10-06" }, { von: "2026-10-07", bis: "2026-10-08" }), false);

console.log("\n── Urlaubskonto ──");
const k = urlaubskonto({
  anspruch: 30, uebertrag: 2.5, jahr: 2026,
  eintraege: [
    { art: "URLAUB", status: "GENEHMIGT", von: "2026-10-05", bis: "2026-10-09" },
    { art: "URLAUB", status: "GEPLANT", von: "2026-12-21", bis: "2027-01-01" },
    { art: "URLAUB", status: "GEPLANT", von: "2026-11-02", bis: "2026-11-02", halberTag: true },
    { art: "KRANK", status: "GENEHMIGT", von: "2026-10-12", bis: "2026-10-16" },
  ],
});
check("genehmigt 5, geplant 8,5, Krank zählt nicht", [k.genehmigt, k.geplant], [5, 8.5]);
check("verfügbar = 30 + 2,5 − 5 − 8,5 = 19", k.verfuegbar, 19);

console.log("\n── Datum & Team ──");
check("gültiges Datum", istGueltigesDatum("2026-02-28"), true);
check("30. Februar ungültig", istGueltigesDatum("2026-02-30"), false);
check("falsches Format", istGueltigesDatum("28.02.2026"), false);
check("tageZwischen inkl. Enden", tageZwischen("2026-09-29", "2026-10-01"), ["2026-09-29", "2026-09-30", "2026-10-01"]);
check("FRANK (1) im Team", istImUrlaubTeam(1), true);
check("CR (12) und RS (15) im Team", [istImUrlaubTeam(12), istImUrlaubTeam(15)], [true, true]);
check("FS-Techniker-Konto (2) NICHT", istImUrlaubTeam(2), false);
check("Arlett (36, Admin) NICHT", istImUrlaubTeam(36), false);
check("Ronny Wellnitz (17) NICHT", istImUrlaubTeam(17), false);
check("Id als Text", istImUrlaubTeam("12"), true);
check("ohne Id", istImUrlaubTeam(undefined), false);

console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
