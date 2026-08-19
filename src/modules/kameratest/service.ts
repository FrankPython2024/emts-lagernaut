import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";

// ── Ablage für Testfotos der Teile-Erkennung ─────────────────────────────────
//
// Zweck: Fotos vom Handgerät landen auf dem Server statt lokal auf dem Scanner,
// damit sie ausgewertet werden können, ohne dass jemand Dateien hin- und
// herkopiert.
//
// ⚠️ Ablageort ist der bereits eingehängte ReForm-Ordner. Der ist ein
// Bind-Mount vom Host (`/var/www/lagernaut/reform`) und überlebt deshalb einen
// Rebuild — anders als alles andere im Container, das nach jedem `--build`
// verschwindet. Ein eigenes Volume wäre dafür Overkill.
//
// Bewusst KEINE Datenbank: Das sind Wegwerf-Aufnahmen für eine Messung, keine
// Stammdaten. Sie sollen sich leicht löschen und leicht vom Server holen lassen.

const MAX_BYTES   = 12 * 1024 * 1024; // ein Handyfoto liegt bei 2–6 MB
const MAX_DATEIEN = 40;               // darüber fliegen die ältesten raus

const ERLAUBT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
};

export type FotoMessung = {
  breite?:       number;
  hoehe?:        number;
  schaerfe?:     number;
  helligkeit?:   number;
  ueberstrahlt?: number;
  quelle?:       string;
};

export type FotoEintrag = {
  name:      string;
  groesse:   number;
  zeit:      string;
  notiz:     string | null;
  benutzer:  string | null;
  messung:   FotoMessung | null;
};

function verzeichnis(): string {
  return process.env.TEILEFOTO_DIR
    ?? path.join(process.env.REFORM_DIR ?? "/data/reform", "teilefotos");
}

/**
 * Dateinamen prüfen. Der Name kommt bei Abruf und Löschen vom Client, deshalb
 * hier hart gegen Pfadwechsel absichern — ein „../" im Namen darf niemals
 * irgendwo anders landen als im Testordner.
 */
export function pruefeName(name: string): string {
  if (!/^[0-9a-z][0-9a-z_-]{0,80}\.(jpg|png|webp)$/.test(name)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ungültiger Dateiname." });
  }
  const voll = path.resolve(verzeichnis(), name);
  if (path.dirname(voll) !== path.resolve(verzeichnis())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ungültiger Pfad." });
  }
  return voll;
}

async function ordnerBereit(): Promise<string> {
  const dir = verzeichnis();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function speichereFoto(input: {
  base64:    string;
  mimeType:  string;
  notiz?:    string | null;
  benutzer?: string | null;
  messung?:  FotoMessung | null;
}): Promise<{ name: string; groesse: number }> {
  const endung = ERLAUBT[input.mimeType];
  if (!endung) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nur JPEG, PNG oder WebP." });
  }

  // Data-URL-Präfix abstreifen, falls der Browser eines mitschickt.
  const roh   = input.base64.replace(/^data:[^;]+;base64,/, "");
  const bytes = Buffer.from(roh, "base64");
  if (bytes.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Leeres Bild." });
  }
  if (bytes.length > MAX_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Bild zu groß (${(bytes.length / 1048576).toFixed(1)} MB, erlaubt sind 12 MB).`,
    });
  }

  const dir = await ordnerBereit();

  // Name wird IMMER serverseitig gebaut, nie vom Client übernommen.
  // Zeitstempel vorn, damit die Sortierung im Dateisystem der Reihenfolge
  // der Aufnahmen entspricht.
  const stempel = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).toLowerCase();
  const name    = `${stempel}_${crypto.randomBytes(3).toString("hex")}.${endung}`;

  await fs.writeFile(path.join(dir, name), bytes);
  await fs.writeFile(
    path.join(dir, `${name}.json`),
    JSON.stringify({
      notiz:    input.notiz?.trim() || null,
      benutzer: input.benutzer ?? null,
      messung:  input.messung ?? null,
      zeit:     new Date().toISOString(),
    }, null, 2),
    "utf8",
  );

  await alteAufraeumen(dir);
  return { name, groesse: bytes.length };
}

/** Über MAX_DATEIEN hinaus die ältesten entfernen, damit nichts vollläuft. */
async function alteAufraeumen(dir: string): Promise<void> {
  const eintraege = (await fs.readdir(dir)).filter((n) => !n.endsWith(".json"));
  if (eintraege.length <= MAX_DATEIEN) return;

  const mitZeit = await Promise.all(eintraege.map(async (n) => ({
    n, zeit: (await fs.stat(path.join(dir, n))).mtimeMs,
  })));
  mitZeit.sort((a, b) => a.zeit - b.zeit);

  for (const alt of mitZeit.slice(0, mitZeit.length - MAX_DATEIEN)) {
    await fs.rm(path.join(dir, alt.n),            { force: true });
    await fs.rm(path.join(dir, `${alt.n}.json`),  { force: true });
  }
}

export async function listeFotos(): Promise<FotoEintrag[]> {
  const dir = verzeichnis();
  let namen: string[];
  try {
    namen = (await fs.readdir(dir)).filter((n) => /\.(jpg|png|webp)$/.test(n));
  } catch {
    return []; // Ordner existiert noch nicht — das ist kein Fehler
  }

  const liste = await Promise.all(namen.map(async (name): Promise<FotoEintrag> => {
    const stat = await fs.stat(path.join(dir, name));
    let meta: Partial<FotoEintrag> & { zeit?: string } = {};
    try {
      meta = JSON.parse(await fs.readFile(path.join(dir, `${name}.json`), "utf8"));
    } catch { /* Beschreibung fehlt — Datei bleibt trotzdem nutzbar */ }
    return {
      name,
      groesse:  stat.size,
      zeit:     meta.zeit ?? stat.mtime.toISOString(),
      notiz:    meta.notiz    ?? null,
      benutzer: meta.benutzer ?? null,
      messung:  meta.messung  ?? null,
    };
  }));

  return liste.sort((a, b) => b.zeit.localeCompare(a.zeit)); // neueste zuerst
}

export async function leseFoto(name: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const voll = pruefeName(name);
  const bytes = await fs.readFile(voll);
  const mimeType = name.endsWith(".png")  ? "image/png"
                 : name.endsWith(".webp") ? "image/webp"
                 :                          "image/jpeg";
  return { bytes, mimeType };
}

export async function loescheFoto(name: string): Promise<void> {
  const voll = pruefeName(name);
  await fs.rm(voll,               { force: true });
  await fs.rm(`${voll}.json`,     { force: true });
}

export async function loescheAlle(): Promise<{ geloescht: number }> {
  const dir = verzeichnis();
  let namen: string[];
  try { namen = await fs.readdir(dir); } catch { return { geloescht: 0 }; }

  let n = 0;
  for (const datei of namen) {
    if (/\.(jpg|png|webp)(\.json)?$/.test(datei)) {
      await fs.rm(path.join(dir, datei), { force: true });
      if (!datei.endsWith(".json")) n++;
    }
  }
  return { geloescht: n };
}

/** Für die Oberfläche: wo liegen die Dateien auf dem Server? */
export function ablageOrt(): string {
  return verzeichnis();
}
