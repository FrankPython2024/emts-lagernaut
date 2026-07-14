// ReForm → LogID auf einen Colli umbuchen (headless, über die Brücke).
// Liest die Anfrage aus UMBUCHEN_REQ (JSON: {colli, logId, dryRun, ts}) und schreibt
// den Fortschritt nach UMBUCHEN_STATUS. Env: PORTAL_USER, PORTAL_PASS, HEADLESS.
//
// Trockenlauf (dryRun=true, DEFAULT): navigiert → sucht Colli → öffnet
//   "Teile zu diesem Colli buchen" → füllt LogID, drückt aber NICHT Enter → bucht NICHTS.
// Echt (dryRun=false): drückt Enter → bucht wirklich.

import { chromium } from "playwright";
import fs from "node:fs";

const URL      = "https://portal.afb-group.eu/";
const USER     = process.env.PORTAL_USER;
const PASS     = process.env.PORTAL_PASS;
const MANDANT  = "AfB";
const HEADLESS = process.env.HEADLESS !== "0";
const STATUS   = process.env.UMBUCHEN_STATUS || null;
const REQ      = process.env.UMBUCHEN_REQ;

if (!USER || !PASS) { console.error("❌ PORTAL_USER/PORTAL_PASS fehlen."); process.exit(1); }
if (!REQ)           { console.error("❌ UMBUCHEN_REQ fehlt."); process.exit(1); }

const anfrage = JSON.parse(fs.readFileSync(REQ, "utf8"));
const colli   = String(anfrage.colli ?? "").trim();
const logId   = String(anfrage.logId ?? "").trim();
const dryRun  = anfrage.dryRun !== false; // Default: Trockenlauf
const START   = Number(anfrage.ts || Date.now());
if (!colli || !logId) { console.error("❌ colli/logId fehlen."); process.exit(1); }

function melde(state, phase, extra = {}) {
  console.log(`[${state}] ${phase}`);
  if (!STATUS) return;
  try {
    fs.writeFileSync(`${STATUS}.tmp`, JSON.stringify({
      state, phase, colli, logId, dryRun, startedAt: START,
      endedAt: (state === "fertig" || state === "fehler") ? Date.now() : null,
      fehler: null, ...extra,
    }));
    fs.renameSync(`${STATUS}.tmp`, STATUS);
  } catch { /* Status ist Kosmetik */ }
}

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({
  acceptDownloads: true, locale: "de-DE", timezoneId: "Europe/Berlin",
  extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9" },
});
const page = await ctx.newPage();
let ok = false;

try {
  melde("laeuft", "🔌 Verbinde & melde an…");
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#userTextField").fill(USER);
  await page.locator("#pwTextField").fill(PASS);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();

  melde("laeuft", `🏢 Prüfe Mandant „${MANDANT}"…`);
  await page.waitForTimeout(2500);
  try {
    await page.locator(".qx-last-chosen-client-button", { hasText: MANDANT }).click({ timeout: 4000 });
    await page.getByRole("button", { name: "Auswählen" }).first().click({ timeout: 4000 });
  } catch { /* Mandant gemerkt → übersprungen */ }

  melde("laeuft", "🧭 Öffne Collis…");
  await page.waitForTimeout(6000);
  const collisBtn = page.getByRole("button", { name: "Collis" }).first();
  if (!(await collisBtn.count())) throw new Error("'Collis' nicht gefunden.");
  await collisBtn.click({ timeout: 20000 });
  await page.waitForTimeout(2500);

  melde("laeuft", `🔎 Suche Colli ${colli}…`);
  const tab   = page.getByRole("tabpanel", { name: "Collis" });
  const suche = tab.getByRole("textbox").first();
  await suche.fill(colli);
  await suche.press("Enter");
  await page.waitForTimeout(3000);

  melde("laeuft", "📦 Öffne die Buchungs-Maske…");
  const buchenBtn = page.getByRole("button", { name: "Teile zu diesem Colli buchen" });
  if (!(await buchenBtn.count())) throw new Error(`Colli ${colli} nicht gefunden (Buchen-Button fehlt).`);
  await buchenBtn.click({ timeout: 15000 });
  await page.waitForTimeout(1500);

  // Diagnose: sichtbare Textfelder (um den nth(3)-Selektor später zu härten).
  const felder = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input[type=text],input:not([type]),textarea"))
      .filter((e) => e.offsetWidth || e.offsetHeight)
      .map((e, i) => ({ i, id: e.id || null, ph: e.placeholder || null })));
  console.log("TEXTFELDER:", JSON.stringify(felder));

  melde("laeuft", `⌨️ Trage LogID ${logId} ein…`);
  const logField = page.getByRole("textbox").nth(3); // TODO: stabiler Anker nach 1. Testlauf
  await logField.click({ timeout: 10000 });
  await logField.fill(logId);

  if (dryRun) {
    await page.screenshot({ path: "/out/umbuchen-dry.png", fullPage: true }).catch(() => {});
    melde("fertig", `🧪 Trockenlauf OK — WÜRDE LogID ${logId} auf Colli ${colli} buchen (nicht ausgeführt).`);
  } else {
    await logField.press("Enter");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: "/out/umbuchen-real.png", fullPage: true }).catch(() => {});
    melde("fertig", `✅ LogID ${logId} auf Colli ${colli} gebucht.`);
  }
  ok = true;
} catch (e) {
  const msg = (e?.message || String(e)).split("\n")[0];
  console.error("❌", msg);
  await page.screenshot({ path: "/out/umbuchen-fehler.png", fullPage: true }).catch(() => {});
  melde("fehler", "Fehler", { fehler: msg });
} finally {
  await browser.close();
}
process.exit(ok ? 0 : 1);
