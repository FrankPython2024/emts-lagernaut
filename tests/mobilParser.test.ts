/**
 * Tests für den Mobil-Ersatzteile-Parser (src/lib/mobil/parser.ts).
 *
 * Ausführen:  npx tsx tests/mobilParser.test.ts   (oder: npm run test:mobil)
 * Deckt die echten Daten-Fallstricke der CSV ab. Reine Logik, kein DB-Zugriff.
 */

import {
  bezeichnungNormalisieren,
  herstellerErkennen,
  modellErkennen,
  teiltypErkennen,
  farbeErkennen,
  zuordnen,
  keywordFreieErkennung,
  type MobilAliasTreffer,
} from "../src/lib/mobil/parser";

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

// ── Normalisierung ──────────────────────────────────────────────────────────
console.log("\n══ NORMALISIERUNG ══");
check(
  "Zeilenumbruch mitten im Text wird entfernt",
  bezeichnungNormalisieren("…für das\niPhone 15 Pro Max"),
  "…für das iphone 15 pro max",
);
check(
  "Mehrfach-Spaces + Tabs kollabieren",
  bezeichnungNormalisieren("  Akku   für\tiPhone  11  "),
  "akku für iphone 11",
);

// ── Hersteller (keyword-basiert) ────────────────────────────────────────────
console.log("\n══ HERSTELLER ══");
check("iPhone → Apple",  herstellerErkennen("display für iphone 12"), "Apple");
check("iPad → Apple",    herstellerErkennen("digitizer for ipad 10.2"), "Apple");
check("Galaxy → Samsung", herstellerErkennen("samsung galaxy s22 sim slot"), "Samsung");
check("SM- → Samsung",   herstellerErkennen("sim tray sm-g996"), "Samsung");
check("Pixel → Google",  herstellerErkennen("batteries for google pixel 7 pro"), "Google");
check("Redmi → Xiaomi",  herstellerErkennen("rear cover xiaomi redmi note 11"), "Xiaomi");
check("Diagnostic Battery 13Pro → keyword-frei null", herstellerErkennen("diagnostic battery 13pro 3095mah"), null);

// ── Teiltyp ─────────────────────────────────────────────────────────────────
console.log("\n══ TEILTYP ══");
check("battery → Akku",       teiltypErkennen("diagnostic battery 13pro 3095mah"), "Akku");
check("akku → Akku",          teiltypErkennen("akku (kompatibel), für iphone 11"), "Akku");
check("lcd touchscreen → Display", teiltypErkennen("lcd touchscreen (refurb), for iphone 11"), "Display");
check("reiner digitizer → Digitizer", teiltypErkennen("digitizer - black, for ipad 10.2"), "Digitizer");
check("Einheit mit 'assembly' (lcd+display+digitizer) → Displaymodul", teiltypErkennen("lcd display touchscreen digitizer assembly"), "Displaymodul");
check("reines Panel (lcd+display+digitizer, OHNE Modul-Marker) → Display", teiltypErkennen("lcd display touchscreen digitizer"), "Display");
check("reiner Digitizer (Touch-Glas, kein Panel/Modul) → Digitizer", teiltypErkennen("digitizer assembly - black, for ipad 10.2"), "Digitizer");
check("camera glass → Kameraglas", teiltypErkennen("camera glass for iphone x"), "Kameraglas");
check("camerglass (Tippfehler) → Kameraglas", teiltypErkennen("camerglass for iphone x - oem quality"), "Kameraglas");
check("rear cover → Backcover", teiltypErkennen("rear cover (pulled a) - gold, for iphone 12 pro"), "Backcover");
check("middle frame → Middle Frame", teiltypErkennen("middle frame (pulled a) - blue, for iphone 14"), "Middle Frame");
check("sim slot → SIM-Tray",  teiltypErkennen("samsung galaxy s21 sim slot dual sim tray"), "SIM-Tray");
check("Diagnosefunktion ohne Akku ≠ Akku (nur Display)", teiltypErkennen("bildschirmeinheit für iphone 14 plus (diagnosefunktion)"), "Display");
check("kein Teiltyp → null",  teiltypErkennen("samsung galaxy s22 ultra; sm-s908. original"), null);

// ── Gesamt-Zuordnung: SICHER ────────────────────────────────────────────────
console.log("\n══ ZUORDNUNG — SICHER ══");
function kurz(b: string) {
  const z = zuordnen(b);
  return { h: z.hersteller, m: z.modelle, t: z.teiltyp, sicher: z.sicher, mehrfach: z.mehrfachModell };
}
check("Display für iPhone 12 Pro Max OEM",
  kurz("Display für iPhone 12 Pro Max OEM"),
  { h: "Apple", m: ["iPhone 12 Pro Max"], t: "Display", sicher: true, mehrfach: false });
check("Diagnose-Akku für iPhone 13",
  kurz("Diagnose-Akku für iPhone 13"),
  { h: "Apple", m: ["iPhone 13"], t: "Akku", sicher: true, mehrfach: false });
check("keyword-frei: Diagnostic Battery 13Pro 3095mAh → iPhone 13 Pro, Apple abgeleitet",
  kurz("Diagnostic Battery 13Pro 3095mAh Standard Capacity"),
  { h: "Apple", m: ["iPhone 13 Pro"], t: "Akku", sicher: true, mehrfach: false });
check("glued Suffix: ...12ProMax... → iPhone 12 Pro Max",
  kurz("Diagnostic Battery 12ProMax Standard Capacity 3687mAh DB- 12ProMax Standard"),
  { h: "Apple", m: ["iPhone 12 Pro Max"], t: "Akku", sicher: true, mehrfach: false });
check("13Mini → iPhone 13 mini",
  kurz("Diagnostic Battery 13Mini 2406mAh Standard Capacity"),
  { h: "Apple", m: ["iPhone 13 mini"], t: "Akku", sicher: true, mehrfach: false });
check("X-Familie: Camera glass for iPhone X",
  kurz("Camera glass for iPhone X"),
  { h: "Apple", m: ["iPhone X"], t: "Kameraglas", sicher: true, mehrfach: false });
check("XS: Akku für iPhone Xs",
  kurz("Akku für iPhone Xs"),
  { h: "Apple", m: ["iPhone XS"], t: "Akku", sicher: true, mehrfach: false });
check("SE (3. Generation) NICHT nach '(3' abgeschnitten",
  kurz("Akku (kompatibel), für iPhone SE (3. Generation)"),
  { h: "Apple", m: ["iPhone SE (3. Generation)"], t: "Akku", sicher: true, mehrfach: false });
check("SE 2022 (Jahr)",
  kurz("Diagnostizierbarer Akku für iPhone SE 2022"),
  { h: "Apple", m: ["iPhone SE (2022)"], t: "Akku", sicher: true, mehrfach: false });
check("Referenznummer rwip101753 wird NICHT als Modell gelesen",
  kurz("iPhone 11 Pro Max Display OEM - RWIP100691"),
  { h: "Apple", m: ["iPhone 11 Pro Max"], t: "Display", sicher: true, mehrfach: false });
check("mAh-Wert (4-stellig) wird NICHT als Modell gelesen",
  kurz("Diagnostizierbarer 4730-mAh-Akku mit hoher Kapazität für das\niPhone 15 Pro Max"),
  { h: "Apple", m: ["iPhone 15 Pro Max"], t: "Akku", sicher: true, mehrfach: false });
check("iPad 10.2 (2019) Digitizer → Digitizer (nicht Display)",
  kurz("Digitizer - Black, For iPad 10.2 (2019-2020)"),
  { h: "Apple", m: ['iPad 10.2" (2019)'], t: "Digitizer", sicher: true, mehrfach: false });
check("Einheit mit 'Assembly' + Digitizer → Displaymodul (nicht Digitizer/Display)",
  kurz("iPhone X LCD Display Touchscreen Digitizer Assembly"),
  { h: "Apple", m: ["iPhone X"], t: "Displaymodul", sicher: true, mehrfach: false });
check("Samsung Galaxy S21 SIM-Tray",
  kurz("Samsung Galaxy S21 Sim Slot Phantom White OEM dual sim tray"),
  { h: "Samsung", m: ["Galaxy S21"], t: "SIM-Tray", sicher: true, mehrfach: false });
check("Google Pixel 8A",
  kurz("LCD Touchscreen for Google Pixel 8A"),
  { h: "Google", m: ["Pixel 8a"], t: "Display", sicher: true, mehrfach: false });

// ── Gesamt-Zuordnung: MEHRFACH-MODELL ───────────────────────────────────────
console.log("\n══ ZUORDNUNG — MEHRFACH-MODELL ══");
check("'12 / 12 Pro' = ZWEI Modelle (nicht eins)",
  kurz("Diagnose-Akku für iPhone 12 / 12 Pro"),
  { h: "Apple", m: ["iPhone 12", "iPhone 12 Pro"], t: "Akku", sicher: false, mehrfach: true });
check("'12/12 Pro' ohne Spaces ebenfalls zwei Modelle",
  kurz("Display für iPhone 12/12 Pro"),
  { h: "Apple", m: ["iPhone 12", "iPhone 12 Pro"], t: "Display", sicher: false, mehrfach: true });
check("'14 Pro/ 14 Pro Max'",
  kurz("Camera lenses for iPhone 14 Pro/ 14 Pro Max - OEM NEW Quality"),
  { h: "Apple", m: ["iPhone 14 Pro", "iPhone 14 Pro Max"], t: "Kameraglas", sicher: false, mehrfach: true });
check("'iPhone 8 & iPhone SE (2020 & 2022)' = drei Modelle",
  kurz("LCD Touchscreen (Refurb) - Black, For iPhone 8 & iPhone SE (2020 & 2022)"),
  { h: "Apple", m: ["iPhone 8", "iPhone SE (2020)", "iPhone SE (2022)"], t: "Display", sicher: false, mehrfach: true });

// ── Gesamt-Zuordnung: REVIEW (nichts raten) ─────────────────────────────────
console.log("\n══ ZUORDNUNG — REVIEW ══");
check("Gerät ohne Teiltyp → REVIEW",
  kurz("Samsung Galaxy S22 Ultra; SM-S908. Original"),
  { h: "Samsung", m: ["Galaxy S22 Ultra"], t: null, sicher: false, mehrfach: false });

// ── Keyword-freie Erkennung (neue Wortlaute) + Fehltreffer-Schutz (Audit M2/K1) ─
console.log("\n══ KEYWORD-FREI + FEHLTREFFER-SCHUTZ ══");
// iPhone-Akkus ohne "iPhone"-Keyword:
check("keyword-frei iPhone: Diagnostic Battery 13Pro → iPhone 13 Pro, Akku",
  kurz("Diagnostic Battery 13Pro 3095mAh Standard Capacity"),
  { h: "Apple", m: ["iPhone 13 Pro"], t: "Akku", sicher: true, mehrfach: false });
// Samsung ohne "Galaxy"/"Samsung"-Keyword:
check("keyword-frei Samsung: Backcover with Glue S22 → Galaxy S22, Backcover",
  kurz("Backcover with Glue S22 - OEM NEW"),
  { h: "Samsung", m: ["Galaxy S22"], t: "Backcover", sicher: true, mehrfach: false });
check("keyword-frei Samsung: Display for S20 Ultra → Galaxy S20 Ultra, Display",
  kurz("Display for S20 Ultra Color Cosmic Gray"),
  { h: "Samsung", m: ["Galaxy S20 Ultra"], t: "Display", sicher: true, mehrfach: false });
check("keyword-frei Samsung: S10+ → Galaxy S10 Plus",
  keywordFreieErkennung(bezeichnungNormalisieren("Backcover S10+ OEM")),
  { hersteller: "Samsung", modelle: ["Galaxy S10 Plus"] });

// FEHLTREFFER-SCHUTZ (MUSS): Fremd-Hersteller dürfen NIE keyword-frei zu iPhone werden.
check("MUSS: Rear Cover … Xiaomi Redmi Note 11 → Xiaomi (NICHT iPhone 11)",
  zuordnen("Rear Cover - Tarnish, Xiaomi Redmi Note 11").hersteller, "Xiaomi");
check("MUSS: LCD Touchscreen, Google Pixel 8 → Google (NICHT iPhone 8)",
  zuordnen("LCD Touchscreen, Google Pixel 8").hersteller, "Google");
// Direkt auf der Schutzfunktion: Fremd-Keyword ⇒ kein keyword-freier Treffer.
check("Schutz: 'redmi note 11' ⇒ keywordFreieErkennung = null",
  keywordFreieErkennung("rear cover - tarnish, xiaomi redmi note 11"), null);
check("Schutz: 'google pixel 8' ⇒ keywordFreieErkennung = null",
  keywordFreieErkennung("lcd touchscreen, google pixel 8"), null);
// Plausibilität (Audit M2): nackte Zahl ohne Teil-Kontext/Suffix erfindet KEIN Modell.
check("Plausibilität: nackte '8' ohne Teil-Keyword/Suffix ⇒ null",
  keywordFreieErkennung("box 8 pieces lot"), null);
check("Plausibilität: Suffix allein reicht ('14 Pro') ⇒ iPhone 14 Pro",
  keywordFreieErkennung("14 pro replacement"),
  { hersteller: "Apple", modelle: ["iPhone 14 Pro"] });

// ── Alias-Lookup (gelernte Zuordnung) ───────────────────────────────────────
console.log("\n══ ALIAS-LOOKUP ══");
{
  const aliase = new Map<string, MobilAliasTreffer>([
    [bezeichnungNormalisieren("Sonderteil XYZ ohne Regel"),
      { hersteller: "Apple", modell: "iPhone 13", teiltyp: "Display" }],
  ]);
  const z = zuordnen("Sonderteil XYZ ohne Regel", aliase);
  check("Alias schlägt Regelwerk → sicher, quelle=alias",
    { h: z.hersteller, m: z.modell, t: z.teiltyp, sicher: z.sicher, quelle: z.quelle },
    { h: "Apple", m: "iPhone 13", t: "Display", sicher: true, quelle: "alias" });
}

// ── Farb-Erkennung ──────────────────────────────────────────────────────────
console.log("\n══ FARBE ══");
check("black → schwarz",        farbeErkennen("Back Glass (Pulled A) - Black, For iPhone 14"), "schwarz");
check("Green → grün",           farbeErkennen("Back Glass (Pulled A) - Green, For iPhone 15"), "grün");
check("Phantom White → weiß",   farbeErkennen("Samsung Galaxy S21 Sim Slot Phantom White OEM"), "weiß");
check("space gray → grau",      farbeErkennen("Rear Cover - Space Gray, For iPhone 11"), "grau");
check("Phantom Gray → grau",    farbeErkennen("SIM Tray - Phantom Gray, Samsung Galaxy S21"), "grau");
check("Alpine Green → grün",    farbeErkennen("Rear Cover (Pulled A) - Alpine Green, For iPhone 13 Pro"), "grün");
check("Gold → gold",            farbeErkennen("Rear Cover (Pulled A) - Gold, For iPhone 14 Pro"), "gold");
check("starlight → starlight",  farbeErkennen("Back Glass - Starlight, For iPhone 13"), "starlight");
check("midnight → mitternacht", farbeErkennen("Back Glass - Midnight, For iPhone 13"), "mitternacht");
check("weiß (DE) → weiß",       farbeErkennen("Display module – weiß"), "weiß");
check("keine Farbe → null",     farbeErkennen("Diagnose-Akku für iPhone 13"), null);
check("Tarnish (unbekannt) → null", farbeErkennen("Rear Cover - Tarnish, Xiaomi Redmi Note 11"), null);
check("Wortgrenze: 'red' nicht in 'Refurb'", farbeErkennen("OLED (soft) Touchscreen (Refurb), For iPhone 13"), null);

// ── iPad-Air-Generation (konstruiert, nicht in CSV) ─────────────────────────
console.log("\n══ iPAD AIR ══");
function ipadAir(b: string) { return modellErkennen(bezeichnungNormalisieren(b), "Apple"); }
check("iPad Air 10.5\" 3. Generation → Air 3",
  ipadAir('Display module für iPad Air – 10.5" – 3. Generation – weiß'), ["iPad Air 3"]);
check("iPad Air 2 → Air 2",        ipadAir("iPad Air 2"), ["iPad Air 2"]);
check("generisches iPad Air bleibt iPad Air",
  ipadAir("LCD Touchscreen, For iPad Air"), ["iPad Air"]);
check("iPad Air 4th generation → Air 4",
  ipadAir("Display für iPad Air 4th generation"), ["iPad Air 4"]);
check("iPad Air M1 → Air 5",       ipadAir("iPad Air M1 Display"), ["iPad Air 5"]);
check("iPad Air 10.9\" ohne Generation → generisch (nicht geraten)",
  ipadAir('iPad Air 10.9"'), ["iPad Air"]);
check("iPad-Air-Zeile: Farbe weiß",
  farbeErkennen('Display module für iPad Air – 10.5" – 3. Generation – weiß'), "weiß");

// ── Displaymodul + iPad Air 3 (echte Varianten aus export 16) ───────────────
console.log("\n══ DISPLAYMODUL / iPAD AIR 3 ══");
const TM = (b: string) => { const z = zuordnen(b); return { t: z.teiltyp, m: z.modell }; };
check("Ipad Air 3 Displayassembly → Displaymodul, iPad Air 3",
  TM("Ipad Air 3 Displayassembly OEM USED (change glass)"),
  { t: "Displaymodul", m: "iPad Air 3" });
check("Displaymodule assembly for iPad Air  3 (Doppel-Space) → Displaymodul, Air 3",
  TM("Displaymodule assembly for iPad Air  3 - black"),
  { t: "Displaymodul", m: "iPad Air 3" });
check("  └ Farbe schwarz", farbeErkennen("Displaymodule assembly for iPad Air  3 - black"), "schwarz");
check("Display module – 10.5” – 3. Generation → Displaymodul, Air 3",
  TM('Display module für iPad Air – 10.5” – 3. Generation – weiß'),
  { t: "Displaymodul", m: "iPad Air 3" });
check("  └ Farbe weiß", farbeErkennen('Display module für iPad Air – 10.5” – 3. Generation – weiß'), "weiß");
check("Displayeinheit (Modul) – 10,5\" (Komma) – 3.Generation (kein Space) → Displaymodul, Air 3",
  TM('Displayeinheit (Modul) für iPad Air 10,5" - 3.Generation (2019) - schwarz'),
  { t: "Displaymodul", m: "iPad Air 3" });
check("  └ Farbe schwarz", farbeErkennen('Displayeinheit (Modul) für iPad Air 10,5" - 3.Generation (2019) - schwarz'), "schwarz");
check("Screen Assembly … iPhone 16 … Black → Displaymodul, iPhone 16",
  TM("Screen Assembly With Proximity Light Sensor, iPhone 16, OEM, Black"),
  { t: "Displaymodul", m: "iPhone 16" });
check("  └ Farbe schwarz", farbeErkennen("Screen Assembly With Proximity Light Sensor, iPhone 16, OEM, Black"), "schwarz");
check("reines iPhone-Display bleibt Display (1)",
  TM("Display für iPhone 12 Pro Max OEM"), { t: "Display", m: "iPhone 12 Pro Max" });
check("reines iPhone-Display bleibt Display (2)",
  TM("OLED (soft) Touchscreen (Refurb), For iPhone 13"), { t: "Display", m: "iPhone 13" });

console.log(`\n══════════════════════════════════════════`);
console.log(`  📊 ${passed} passed  |  ${failed} failed`);
console.log(`══════════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
