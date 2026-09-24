/**
 * Tests für die Scan-Auswertung auf dem Gerät und die Warteschlange
 * (src/lib/pickup/scanAuswertung.ts).
 *
 * Ausführen:  npx tsx tests/pickupScan.test.ts   (oder: npm run test:scan)
 *
 * Anlass: Bei schwachem WLAN gingen Scans still verloren — ein zweiter Scan
 * während einer laufenden Anfrage wurde verworfen, Speicherfehler gaben keine
 * Rückmeldung, ein Netzfehler bei der Colli-Prüfung klang wie „nichts drin".
 *
 * Reine Logik, kein Netz, keine Datenbank.
 */

import {
  werteScanAus, fehlerArt, wartezeitMs, mitLokalenFunden, type ScanPositionBasis,
} from "../src/lib/pickup/scanAuswertung";

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

type P = ScanPositionBasis & { id: number; gefundenVonName: string | null; gefundenAm: Date | string | null };
const pos = (id: number, logId: string, colli: string | null, status = "OFFEN"): P =>
  ({ id, logId, colli, status, bezeichnung: `Gerät ${id}`, gefundenVonName: null, gefundenAm: null });

const LISTE: P[] = [
  pos(1, "212882865", "2.108.101"),
  pos(2, "212882866", "2.108.109"),
  pos(3, "212882867", "2.108.109", "GEFUNDEN"),
  pos(4, "212882868", "3.139.045", "GEFUNDEN"),
];
const KEINE_WAGEN = new Set<string>();
const scanL = (roh: string, wagen = KEINE_WAGEN) => werteScanAus({ roh, istColli: false, positionen: LISTE, hauptcollis: wagen });

console.log("\n── LogID-Auftrag: Geräte ──");
const g = scanL("212.882.865");
check("gesuchtes Gerät → gefunden", [g.art, g.art === "logid" && g.result], ["logid", "GEFUNDEN"]);
check("Punkte im Barcode stören nicht", g.art === "logid" && g.position?.id, 1);
const s = scanL("212882867");
check("schon gefunden → SCHON", s.art === "logid" && s.result, "SCHON");
const f = scanL("299999999");
check("nicht auf der Liste → FREMD, ohne Position", [f.art === "logid" && f.result, f.art === "logid" && f.position], ["FREMD", null]);

console.log("\n── LogID-Auftrag: Colli-Prüfung (wie pickup.colliPruefen) ──");
const c = scanL("2.108.109");
check("Colli mit offenem Gerät → 1 Treffer", c.art === "colli" && c.treffer.map((t) => t.logId), ["212882866"]);
check("Colli gehört zum Auftrag", c.art === "colli" && c.colliBekannt, true);
const leer = scanL("3139045");
check("Colli, alles schon gefunden → bekannt, 0 Treffer", leer.art === "colli" && [leer.colliBekannt, leer.treffer.length], [true, 0]);
const fremdColli = scanL("1234567");
check("fremder Colli → unbekannt, 0 Treffer", fremdColli.art === "colli" && [fremdColli.colliBekannt, fremdColli.treffer.length], [false, 0]);
check(
  "Treffer je LogID nur einmal",
  werteScanAus({ roh: "2108101", istColli: false, positionen: [...LISTE, pos(9, "212882865", "2.108.101")], hauptcollis: KEINE_WAGEN })
    .art === "colli",
  true,
);
const doppelt = werteScanAus({ roh: "2108101", istColli: false, positionen: [...LISTE, pos(9, "212882865", "2.108.101")], hauptcollis: KEINE_WAGEN });
check("… und zwar genau ein Treffer", doppelt.art === "colli" && doppelt.treffer.length, 1);

console.log("\n── Hauptcolli (Wagen) und Unbekanntes ──");
const wagen = new Set(["3183906"]);
check("bekannter Hauptcolli → Vorabscan", scanL("3.183.906", wagen).art, "vorabscan");
check("unbekannter 7-Steller bleibt Colli-Prüfung", scanL("3183907", wagen).art, "colli");
check("9-Steller ist nie ein Wagen, auch wenn gleich lautend", werteScanAus({ roh: "212882865", istColli: false, positionen: LISTE, hauptcollis: new Set(["212882865"]) }).art, "logid");
check("falsche Länge → nicht erkannt", scanL("12345").art, "unbekannt");
check("zusammengeklebte 18 Ziffern → nicht erkannt", scanL("212882865212882866").art, "unbekannt");
check("leer → nicht erkannt", scanL("").art, "unbekannt");

console.log("\n── Colli-Auftrag ──");
const COLLIS: P[] = [pos(1, "2108101", null), pos(2, "2108109", null, "GEFUNDEN")];
const scanC = (roh: string, w = KEINE_WAGEN) => werteScanAus({ roh, istColli: true, positionen: COLLIS, hauptcollis: w });
const cg = scanC("2.108.101");
check("gesuchter Colli → gefunden", cg.art === "logid" && cg.result, "GEFUNDEN");
check("gefundener Colli → SCHON", (() => { const r = scanC("2108109"); return r.art === "logid" && r.result; })(), "SCHON");
check("LogID im Colli-Auftrag → gehört nicht dazu", (() => { const r = scanC("212882865"); return r.art === "logid" && r.result; })(), "FREMD");
check("Hauptcolli im Colli-Auftrag → Vorabscan", scanC("3183906", wagen).art, "vorabscan");

console.log("\n── Fehler beim Speichern ──");
const trpc = (code: string) => ({ data: { code } });
check("Netz weg (kein Code) → wiederholen", fehlerArt(new TypeError("Failed to fetch")), "wiederholen");
check("502/Serverfehler → wiederholen", fehlerArt(trpc("INTERNAL_SERVER_ERROR")), "wiederholen");
check("Zeitüberschreitung → wiederholen", fehlerArt(trpc("TIMEOUT")), "wiederholen");
check("abgelaufene Sitzung → Scans behalten, anmelden", fehlerArt(trpc("UNAUTHORIZED")), "anmelden");
check("Auftrag abgeschlossen → aufgeben", fehlerArt(trpc("PRECONDITION_FAILED")), "aufgeben");
check("Auftrag gelöscht → aufgeben", fehlerArt(trpc("NOT_FOUND")), "aufgeben");
check("kein Recht → aufgeben", fehlerArt(trpc("FORBIDDEN")), "aufgeben");
check("null → wiederholen", fehlerArt(null), "wiederholen");
check("Wartezeiten steigen, gedeckelt", [0, 1, 2, 3, 4, 10].map(wartezeitMs), [1000, 2000, 4000, 8000, 15000, 15000]);

console.log("\n── Lokale Funde überlagern den Server-Stand ──");
const lokal = new Map([["212882865", 1_700_000_000_000]]);
const ueber = mitLokalenFunden(LISTE, lokal, "RK");
check("lokal gefunden erscheint abgehakt", ueber[0]!.status, "GEFUNDEN");
check("… mit meinem Kürzel", ueber[0]!.gefundenVonName, "RK");
check("andere bleiben unverändert", ueber[1]!.status, "OFFEN");
check("Server-Fund wird nicht überschrieben", mitLokalenFunden(LISTE, new Map([["212882867", 1]]), "RK")[2]!.gefundenVonName, null);
check("ohne lokale Funde: dieselbe Liste", mitLokalenFunden(LISTE, new Map(), "RK") === LISTE, true);

// ── Ergebnis ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} bestanden, ${failed} fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
