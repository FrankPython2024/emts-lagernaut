// ReForm → Mobil-Export (headless, für den VPS-Container).
// Login (aus Env) → Mandant AfB (falls Dialog) → "alle Lagerdetails" →
// Filter Stellplatz enthält "ETL-Mobil" → Enter (lädt) → Export (Erdkugel) → CSV.
// Speichert nach $OUT_DIR/mobil-export.csv.
//
// Env: PORTAL_USER, PORTAL_PASS (Pflicht). OUT_DIR (Default /out). HEADLESS=0 für sichtbar.

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const URL     = "https://portal.afb-group.eu/";
const USER    = process.env.PORTAL_USER;
const PASS    = process.env.PORTAL_PASS;
const MANDANT = "AfB";
const STELLPLATZ_FILTER = "ETL-Mobil";
const OUT_DIR   = process.env.OUT_DIR || "/out";
const HEADLESS  = process.env.HEADLESS !== "0"; // Default headless

if (!USER || !PASS) { console.error("❌ Bitte PORTAL_USER und PORTAL_PASS setzen."); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: HEADLESS });
// WICHTIG: Deutsche Locale — sonst rendert das Portal im Container auf Englisch
// (Login-Button "Login" statt "Anmelden") und alle deutschen Selektoren scheitern.
const ctx     = await browser.newContext({
  acceptDownloads:  true,
  locale:           "de-DE",
  timezoneId:       "Europe/Berlin",
  extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9" },
});
const page    = await ctx.newPage();
const step = (n, t) => console.log(`→ [${n}] ${t}`);
let ok = false;

try {
  step(1, "Login…");
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#userTextField").fill(USER);
  await page.locator("#pwTextField").fill(PASS);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();

  step(2, `Mandant wählen (nur falls Dialog wirklich da): ${MANDANT}`);
  await page.waitForTimeout(2500);
  try {
    await page.locator(".qx-last-chosen-client-button", { hasText: MANDANT }).click({ timeout: 4000 });
    await page.getByRole("button", { name: "Auswählen" }).first().click({ timeout: 4000 });
    console.log("   → Mandant gewählt.");
  } catch {
    console.log("   → Kein (klickbarer) Mandant-Dialog — übersprungen.");
  }

  step(3, "Öffne 'alle Lagerdetails' (Favorit)…");
  await page.waitForTimeout(6000);
  const lagerBtn = page.getByRole("button", { name: "alle Lagerdetails" }).first();
  if (!(await lagerBtn.count())) throw new Error("'alle Lagerdetails'-Button nicht gefunden.");
  await lagerBtn.click({ timeout: 20000 });
  await page.waitForTimeout(2500);

  step(4, `Filter: Stellplatz enthält "${STELLPLATZ_FILTER}"`);
  const logIdBtn = page.getByRole("button", { name: "LogId" });
  if (await logIdBtn.count()) {
    await logIdBtn.click();
    await page.getByRole("option", { name: "Stellplatz" }).click();
  }
  const gleichBtn = page.getByRole("button", { name: "gleich" });
  if (await gleichBtn.count()) {
    await gleichBtn.click();
    await page.getByRole("option", { name: "enthält" }).click();
  }
  const tab = page.getByRole("tabpanel", { name: "alle Lagerdetails" });
  await tab.getByRole("textbox").fill(STELLPLATZ_FILTER);
  await tab.getByRole("textbox").press("Enter"); // lädt die gefilterten Daten
  console.log("   → Enter gedrückt, warte auf Daten…");
  await page.waitForTimeout(6000);

  step(5, "Export: Erdkugel-Icon → CSV…");
  // Erdkugel (Export, kein Text/Titel) = Icon-Button DIREKT LINKS vom "Stellplatz"-Feld.
  const stellBox = await page.getByRole("button", { name: "Stellplatz" }).first().boundingBox();
  if (!stellBox) throw new Error("'Stellplatz'-Feld nicht gefunden (Anker für Export-Icon).");
  const globe = await page.evaluate((sb) => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
    let best = null;
    document.querySelectorAll(".qx-button").forEach((e) => {
      if (!vis(e)) return;
      const r = e.getBoundingClientRect();
      if (Math.abs(r.y - sb.y) < 15 && r.right <= sb.x + 2) {
        if (!best || r.right > best.right) best = { cx: r.x + r.width / 2, cy: r.y + r.height / 2, right: r.right };
      }
    });
    return best;
  }, stellBox);
  if (!globe) throw new Error("Export-Icon (Erdkugel) nicht gefunden.");
  await page.mouse.click(globe.cx, globe.cy);
  await page.waitForTimeout(1000);

  const dl = page.waitForEvent("download", { timeout: 30000 });
  await page.getByText("CSV (.csv)").click({ timeout: 15000 });
  const download = await dl;
  const ziel = path.join(OUT_DIR, "mobil-export.csv");
  await download.saveAs(ziel);
  const bytes = fs.statSync(ziel).size;
  console.log(`✅ CSV gespeichert: ${ziel} (${bytes} Bytes)`);
  if (bytes < 1000) throw new Error(`CSV verdächtig klein (${bytes} Bytes) — Export womöglich leer.`);
  ok = true;
} catch (e) {
  console.error("❌ Export fehlgeschlagen:", e.message.split("\n")[0]);
  await page.screenshot({ path: path.join(OUT_DIR, "reform-fehler.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
process.exit(ok ? 0 : 1);
