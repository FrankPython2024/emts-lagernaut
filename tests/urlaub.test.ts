/**
 * Tests für die Urlaubsplanung (src/lib/urlaub/tage.ts, team.ts).
 *
 * Ausführen:  npx tsx tests/urlaub.test.ts   (oder: npm run test:urlaub)
 * Reine Logik, kein Netz, keine Datenbank.
 */

import {
  ostersonntag, feiertageThueringen, freieTage, feiertag, istArbeitstag, arbeitstage, ueberschneiden, urlaubskonto,
  istGueltigesDatum, tageZwischen,
} from "../src/lib/urlaub/tage";
import { istImUrlaubTeam, darfBearbeiten } from "../src/lib/urlaub/team";
import { besteZeitpunkte, vorschlagsBudget } from "../src/lib/urlaub/brueckentage";

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
check("Heiligabend kein GESETZLICHER Feiertag", f26.get("2026-12-24"), undefined);

console.log("\n── Betriebsfrei bei AfB: 24.12. und 31.12. ──");
check("13 freie Tage 2026 (11 gesetzlich + 2 betriebsfrei)", freieTage(2026).size, 13);
check("Heiligabend frei", feiertag("2026-12-24"), "Heiligabend (betriebsfrei)");
check("Silvester frei", feiertag("2026-12-31"), "Silvester (betriebsfrei)");
check("24.12.2026 (Do) ist kein Arbeitstag", istArbeitstag("2026-12-24"), false);
check("31.12.2026 (Do) ist kein Arbeitstag", istArbeitstag("2026-12-31"), false);
check("23.12. bleibt Arbeitstag", istArbeitstag("2026-12-23"), true);
check("freieTage nach Datum sortiert", [...freieTage(2026).keys()].slice(-4), ["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31"]);

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
check("nur Wochenende (Sa–So) = 0 Arbeitstage → wird abgelehnt", arbeitstage({ von: "2026-10-10", bis: "2026-10-11" }), 0);
check("nur freie Tage (24.–27.12.2026) = 0", arbeitstage({ von: "2026-12-24", bis: "2026-12-27" }), 0);
check("über ein Wochenende hinweg (Fr–Mo) = 2", arbeitstage({ von: "2026-10-09", bis: "2026-10-12" }), 2);
check("halber Tag am Samstag = 0", arbeitstage({ von: "2026-10-10", bis: "2026-10-10", halberTag: true }), 0);
check("halber Tag über mehrere Tage wird ignoriert", arbeitstage({ von: "2026-10-05", bis: "2026-10-06", halberTag: true }), 2);
check("Weihnachten 21.12.–1.1. = 6 (24./25./31.12. und 1.1. frei)", arbeitstage({ von: "2026-12-21", bis: "2027-01-01" }), 6);
check("… davon 2026: 6", arbeitstage({ von: "2026-12-21", bis: "2027-01-01" }, 2026), 6);
check("… davon 2027: 0 (1.1. ist Feiertag)", arbeitstage({ von: "2026-12-21", bis: "2027-01-01" }, 2027), 0);
check("über Silvester anteilig: 28.12.–8.1. → 2026: 3, 2027: 5", [arbeitstage({ von: "2026-12-28", bis: "2027-01-08" }, 2026), arbeitstage({ von: "2026-12-28", bis: "2027-01-08" }, 2027)], [3, 5]);
check("halber Tag an Heiligabend = 0", arbeitstage({ von: "2026-12-24", bis: "2026-12-24", halberTag: true }), 0);

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
check("genehmigt 5, geplant 6,5, Krank zählt nicht", [k.genehmigt, k.geplant], [5, 6.5]);
check("verfügbar = 30 + 2,5 − 5 − 6,5 = 21", k.verfuegbar, 21);

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

console.log("\n── Nur eigene Einträge bearbeiten ──");
check("Ronny (15) bei Ronny → ja", darfBearbeiten(15, 15), true);
check("Ronny (15) bei Frank (1) → nein", darfBearbeiten(15, 1), false);
check("Frank (1) bei Christian (12) → nein", darfBearbeiten(1, 12), false);
check("Id als Text", darfBearbeiten("12", 12), true);
check("Nicht im Team, auch nicht bei sich selbst (Arlett 36)", darfBearbeiten(36, 36), false);
check("ohne Anmeldung → nein", darfBearbeiten(undefined, 1), false);

console.log("\n── Brückentage: beste Zeitpunkte ──");
const rest26 = besteZeitpunkte({ von: "2026-09-30", bis: "2026-12-31", maxUrlaubstage: 10, anzahl: 20 });
const kurzV = (v: { urlaubVon: string; urlaubBis: string; freiVon: string; freiBis: string; urlaubstage: number; freieTage: number }) =>
  `${v.urlaubstage}:${v.urlaubVon}..${v.urlaubBis}->${v.freieTage}:${v.freiVon}..${v.freiBis}`;
check("Rest 2026: Oktober/November nichts (3.10. und 31.10. sind Samstage)", rest26.every((v) => v.urlaubVon >= "2026-12-01"), true);
check("Weihnachten 2026: 3 Tage (28.–30.12.) → 11 frei (24.12.–3.1.)", rest26.some((v) => kurzV(v) === "3:2026-12-28..2026-12-30->11:2026-12-24..2027-01-03"), true);
check("Weihnachten 2026: 6 Tage → 16 frei (19.12.–3.1.)", rest26.some((v) => kurzV(v) === "6:2026-12-21..2026-12-30->16:2026-12-19..2027-01-03"), true);
check("Stufen ohne Mehrwert fallen weg (2 Tage an Weihnachten)", rest26.some((v) => v.urlaubstage === 2), false);
check("Bester zuerst: Faktor 5", rest26[0]?.faktor, 5);
const j27 = besteZeitpunkte({ von: "2027-01-01", bis: "2027-12-31", maxUrlaubstage: 10, anzahl: 30 });
check("Ostern 2027: Gründonnerstag → 5 frei (25.–29.3.)", j27.some((v) => kurzV(v) === "1:2027-03-25..2027-03-25->5:2027-03-25..2027-03-29"), true);
check("Ostern 2027: 4 Tage → 10 frei", j27.some((v) => kurzV(v) === "4:2027-03-22..2027-03-25->10:2027-03-20..2027-03-29"), true);
check("Himmelfahrt 2027: Brückentag Fr 7.5. → 4 frei", j27.some((v) => kurzV(v) === "1:2027-05-07..2027-05-07->4:2027-05-06..2027-05-09"), true);
check("nie unter doppelt so vielen freien Tagen", j27.every((v) => v.faktor >= 2), true);
check("jeder Tipp hängt an einem freien Werktag", j27.every((v) => v.anlass.length > 0), true);
check("Budget 1 → nur Ein-Tages-Tipps", besteZeitpunkte({ von: "2027-01-01", bis: "2027-12-31", maxUrlaubstage: 1 }).every((v) => v.urlaubstage === 1), true);
const gesperrt = besteZeitpunkte({ von: "2026-09-30", bis: "2026-12-31", maxUrlaubstage: 10, sperren: [{ von: "2026-12-28", bis: "2026-12-28" }] });
check("gesperrte Tage (schon eingetragen) werden nie vorgeschlagen", gesperrt.every((v) => !(v.urlaubVon <= "2026-12-28" && "2026-12-28" <= v.urlaubBis)), true);
check("Budget: Rest begrenzt die Auswahl (5 gewählt, 2 frei → 2)", vorschlagsBudget(true, 2, 5), 2);
check("Budget: kein Urlaub mehr → 0 (keine Vorschläge)", vorschlagsBudget(true, 0, 5), 0);
check("Budget: überzogen (−1,5) → 0", vorschlagsBudget(true, -1.5, 5), 0);
check("Budget: halber Rest abgerundet (1,5 → 1)", vorschlagsBudget(true, 1.5, 5), 1);
check("Budget: genug frei → die Auswahl gilt", vorschlagsBudget(true, 21, 5), 5);
check("Budget: ohne Anspruch → nicht rechenbar", vorschlagsBudget(false, 0, 5), null);
check("Freizeit links nie vor dem frühesten Tag (keine Vergangenheit)",
  besteZeitpunkte({ von: "2026-12-28", bis: "2026-12-31", maxUrlaubstage: 3 }).every((v) => v.freiVon >= "2026-12-28"), true);

console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
