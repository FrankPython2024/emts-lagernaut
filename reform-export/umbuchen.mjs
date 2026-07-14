// ReForm → Buch-SESSION: einen Colli öffnen und dann WIEDERHOLT LogIDs draufbuchen.
// Der Browser bleibt offen (Session), bis /out/session-close kommt oder Leerlauf-Timeout.
//
// Env: PORTAL_USER, PORTAL_PASS, HEADLESS. Dateien im /out-Volume:
//   session-req.processing.json  {colli, dryRun, ts}   ← Start-Auftrag (vom Wächter benannt)
//   queue/<ts>.json              {logId, ts}           ← je gescannte LogID (von der App)
//   session-status.json          Fortschritt/Ergebnis (von hier geschrieben, App pollt)
//   session-close                Signal-Datei → Session beenden
//
// Trockenlauf (dryRun): bucht NICHT (kein finales Enter), zählt aber jede LogID mit.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const URL      = "https://portal.afb-group.eu/";
const USER     = process.env.PORTAL_USER;
const PASS     = process.env.PORTAL_PASS;
const MANDANT  = "AfB";
const HEADLESS = process.env.HEADLESS !== "0";
const OUT      = process.env.OUT_DIR || "/out";
const REQ      = process.env.SESSION_REQ || path.join(OUT, "session-req.processing.json");
const STATUS   = path.join(OUT, "session-status.json");
const QUEUE    = path.join(OUT, "queue");
const CLOSE    = path.join(OUT, "session-close");
const IDLE_MS  = 5 * 60 * 1000; // 5 Min ohne Scan → Session schließt

if (!USER || !PASS) { console.error("❌ PORTAL_USER/PORTAL_PASS fehlen."); process.exit(1); }

const req    = JSON.parse(fs.readFileSync(REQ, "utf8"));
const colli  = String(req.colli ?? "").trim();
const dryRun = req.dryRun !== false;
const START  = Number(req.ts || Date.now());
if (!colli) { console.error("❌ colli fehlt."); process.exit(1); }

fs.mkdirSync(QUEUE, { recursive: true });
const gebucht = []; // {logId, ok, fehler?, dry?, ts}
function status(state, phase, extra = {}) {
  const s = { state, phase, colli, dryRun, startedAt: START, lastActivity: Date.now(), gebucht, ...extra };
  try { fs.writeFileSync(`${STATUS}.tmp`, JSON.stringify(s)); fs.renameSync(`${STATUS}.tmp`, STATUS); } catch {}
  console.log(`[${state}] ${phase}`);
}
const BEREIT = () => status("bereit", `📦 Colli ${colli} offen — LogIDs scannen…`);

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({
  acceptDownloads: true, locale: "de-DE", timezoneId: "Europe/Berlin",
  extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9" },
});
const page = await ctx.newPage();

try {
  status("start", "🔌 Verbinde & melde an…");
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#userTextField").fill(USER);
  await page.locator("#pwTextField").fill(PASS);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();

  status("start", `🏢 Prüfe Mandant „${MANDANT}"…`);
  await page.waitForTimeout(2500);
  try {
    await page.locator(".qx-last-chosen-client-button", { hasText: MANDANT }).click({ timeout: 4000 });
    await page.getByRole("button", { name: "Auswählen" }).first().click({ timeout: 4000 });
  } catch { /* Mandant gemerkt */ }

  status("start", "🧭 Öffne Collis…");
  await page.waitForTimeout(6000);
  const collisBtn = page.getByRole("button", { name: "Collis" }).first();
  if (!(await collisBtn.count())) throw new Error("'Collis' nicht gefunden.");
  await collisBtn.click({ timeout: 20000 });
  await page.waitForTimeout(2500);

  status("start", `🔎 Suche Colli ${colli}…`);
  const tab = page.getByRole("tabpanel", { name: "Collis" });
  await tab.getByRole("textbox").first().fill(colli);
  await tab.getByRole("textbox").first().press("Enter");
  await page.waitForTimeout(3000);

  const buchenBtn = page.getByRole("button", { name: "Teile zu diesem Colli buchen" });
  if (!(await buchenBtn.count())) throw new Error(`Colli ${colli} nicht gefunden.`);
  await buchenBtn.click({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const logField = page.getByRole("textbox").nth(3); // "Logid"-Feld (dry-run verifiziert)
  let lastAktiv = Date.now();
  BEREIT();

  // ── Session-Schleife: LogIDs aus der Queue abarbeiten ──────────────────────
  for (;;) {
    if (fs.existsSync(CLOSE)) { try { fs.unlinkSync(CLOSE); } catch {} break; }

    let dateien = [];
    try { dateien = fs.readdirSync(QUEUE).filter((f) => f.endsWith(".json")).sort(); } catch {}

    if (dateien.length === 0) {
      if (Date.now() - lastAktiv > IDLE_MS) { status("beendet", "⏲️ Leerlauf — Session beendet.", { endedAt: Date.now() }); break; }
      BEREIT(); // Heartbeat (frische lastActivity → App erkennt: Session lebt)
      await page.waitForTimeout(1500);
      continue;
    }

    for (const f of dateien) {
      const fp = path.join(QUEUE, f);
      let logId = "";
      try { logId = String(JSON.parse(fs.readFileSync(fp, "utf8")).logId ?? "").trim(); } catch {}
      try { fs.unlinkSync(fp); } catch {}
      if (!logId) continue;

      lastAktiv = Date.now();
      status("buchen", `⌨️ Buche LogID ${logId}…`);
      try {
        await logField.click({ timeout: 10000 });
        await logField.fill(logId);
        const rueck = (await logField.inputValue().catch(() => "")).trim();
        if (rueck !== logId) throw new Error(`Feld enthält „${rueck}" statt „${logId}"`);
        if (dryRun) {
          gebucht.push({ logId, ok: true, dry: true, ts: Date.now() });
        } else {
          await logField.press("Enter");
          await page.waitForTimeout(1500);
          gebucht.push({ logId, ok: true, ts: Date.now() });
        }
      } catch (e) {
        gebucht.push({ logId, ok: false, fehler: (e?.message || String(e)).split("\n")[0], ts: Date.now() });
      }
      BEREIT();
    }
  }

  if (gebucht.length >= 0 && !fs.existsSync(STATUS)) { /* noop */ }
  status("beendet", `✅ Session beendet — ${gebucht.filter((g) => g.ok).length} von ${gebucht.length} gebucht.`, { endedAt: Date.now() });
} catch (e) {
  status("fehler", "Fehler", { fehler: (e?.message || String(e)).split("\n")[0], endedAt: Date.now() });
} finally {
  await browser.close();
}
