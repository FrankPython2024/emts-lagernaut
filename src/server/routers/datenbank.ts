/**
 * Datenbank-Explorer — Schritt 1: Passwort-Gate.
 *
 * Read-only DB-Explorer unter /admin/datenbank. Zusätzlich zur ADMIN-Rolle
 * (adminProcedure — ausdrücklich NICHT ADMIN_READONLY) durch ein eigenes Passwort
 * gesichert. Nach erfolgreichem `unlock` wird ein signiertes, httpOnly-Cookie
 * gesetzt (HMAC mit NEXTAUTH_SECRET, 2h gültig). Alle Daten-Queries der Schritte
 * 2–4 rufen `requireDbExplorer()` auf, das Signatur + Ablauf prüft.
 *
 * Strikt read-only: keine Schreib-Routen, kein freies SQL.
 */
import { z } from "zod";
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, adminProcedure } from "@/server/trpc";

const COOKIE_NAME    = "db_explorer";
const GUELTIGKEIT_MS = 2 * 60 * 60 * 1000; // 2 Stunden

// Erlaubte SQL-Identifier (Tabellen-/Spaltennamen). Defense-in-Depth zusätzlich
// zur INFORMATION_SCHEMA-Whitelist — nur diese Zeichen dürfen interpoliert werden.
const IDENT = /^[A-Za-z0-9_]+$/;

// ── Krypto-Helfer ─────────────────────────────────────────────────────────────

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Server-Secret (NEXTAUTH_SECRET) ist nicht gesetzt." });
  }
  return s;
}

/** HMAC-Signatur über den Ablaufzeitpunkt. */
function signiere(exp: number): string {
  return createHmac("sha256", secret()).update(String(exp)).digest("hex");
}

/** Token-Format: `<exp-ms>.<hmac>`. */
function baueToken(exp: number): string {
  return `${exp}.${signiere(exp)}`;
}

/**
 * Konstant-Zeit-Vergleich zweier Strings. Über SHA-256-Digests, damit
 * `timingSafeEqual` immer gleich lange Buffer erhält (kein Längen-Leak).
 */
function sicherGleich(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Prüft Signatur + Ablauf eines Cookie-Tokens. */
function tokenGueltig(token: string | undefined): boolean {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return false;

  const exp = Number(token.slice(0, idx));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const sig      = token.slice(idx + 1);
  const erwartet = signiere(exp);
  if (sig.length !== erwartet.length) return false; // timingSafeEqual braucht gleiche Länge
  return timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(erwartet, "utf8"));
}

// ── Öffentlicher Auth-Helfer für Schritte 2–4 ─────────────────────────────────

/**
 * Wache für alle Datenbank-Explorer-Daten-Queries (Schritt 2–4).
 * Wirft UNAUTHORIZED, wenn das `db_explorer`-Cookie fehlt, ungültig oder
 * abgelaufen ist. Muss in einer adminProcedure verwendet werden (Rolle ADMIN ist
 * bereits dort geprüft).
 */
export async function requireDbExplorer(): Promise<void> {
  const store = await cookies();
  if (!tokenGueltig(store.get(COOKIE_NAME)?.value)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Datenbank-Explorer ist gesperrt. Bitte erneut freischalten." });
  }
}

// ── Relationen aus Prisma DMMF ableiten (Schritt 3) ──────────────────────────
//
// Quelle ist ausschließlich das Prisma-Datenmodell (Prisma.dmmf), NICHT manuell
// gepflegt. Keine DB-Abfrage nötig. Die eine Ausnahme ist die klar markierte
// logische Soft-Verknüpfung Anfrage.geraeteName → GeraeteModell.modell (kein FK).
//
// Das JSON ist bewusst flach und selbsterklärend, damit es später unverändert für
// einen PDF-Datenmodell-Export wiederverwendet werden kann.

export type Cardinality = "1:1" | "1:n" | "n:1" | "n:m";

export type RelationInfo = {
  from:         string;   // Modellname (bei FK: referenzierte/"1"-Seite)
  to:           string;   // Modellname (bei FK: FK-haltende/"n"-Seite)
  fromFields:   string[]; // Felder auf `from` (referenziert, i.d.R. id)
  toFields:     string[]; // Felder auf `to` (Fremdschlüssel)
  relationName: string;
  cardinality:  Cardinality;
  soft?:        boolean;  // true = logische Verknüpfung ohne echten FK
  note?:        string;   // Erläuterung (nur bei soft)
};

export type ModelInfo = { name: string; dbTable: string };

/** Eine Seite einer DMMF-Relation (ein object-Feld). */
type RelationSide = {
  model:      string;
  type:       string;
  isList:     boolean;
  fromFields: string[];
  toFields:   string[];
};

/** Leitet alle Relationen + Modell→Tabelle-Zuordnung aus dem Prisma-DMMF ab. */
function leiteRelationenAb(): { relations: RelationInfo[]; models: ModelInfo[] } {
  const models = Prisma.dmmf.datamodel.models;

  // Modell → DB-Tabellenname (@@map landet in dbName; sonst = Modellname).
  const modelInfos: ModelInfo[] = models
    .map((m) => ({ name: m.name, dbTable: m.dbName ?? m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Beide Seiten je relationName sammeln, danach zu EINER Relation zusammenführen.
  const sidesByName = new Map<string, RelationSide[]>();
  for (const m of models) {
    for (const f of m.fields) {
      if (f.kind !== "object" || !f.relationName) continue;
      const arr = sidesByName.get(f.relationName) ?? [];
      arr.push({
        model:      m.name,
        type:       f.type,
        isList:     f.isList,
        fromFields: f.relationFromFields ? [...f.relationFromFields] : [],
        toFields:   f.relationToFields   ? [...f.relationToFields]   : [],
      });
      sidesByName.set(f.relationName, arr);
    }
  }

  const relations: RelationInfo[] = [];
  for (const [relationName, sides] of sidesByName) {
    const fkSide = sides.find((s) => s.fromFields.length > 0);

    if (fkSide) {
      // Explizite Relation: fkSide hält den FK und lebt auf der "n"/Kind-Seite,
      // zeigt auf die referenzierte "1"/Eltern-Seite (fkSide.type).
      const otherSide     = sides.find((s) => s !== fkSide);
      const parentHasMany = otherSide ? otherSide.isList : true; // Rück-Relation = Liste? → 1:n
      relations.push({
        from:         fkSide.type,        // Eltern (referenziert)
        to:           fkSide.model,       // Kind (FK-haltend)
        fromFields:   fkSide.toFields,    // referenzierte Felder (id)
        toFields:     fkSide.fromFields,  // Fremdschlüssel
        relationName,
        cardinality:  parentHasMany ? "1:n" : "1:1",
      });
    } else {
      // Implizite m:n-Relation (beide Seiten Liste, kein FK-Feld).
      const [a, b]     = sides;
      const [from, to] = [a.model, (b ?? a).model].sort();
      relations.push({ from, to, fromFields: [], toFields: [], relationName, cardinality: "n:m" });
    }
  }

  // Eine bekannte LOGISCHE Verknüpfung (steht NICHT im DMMF, da kein FK):
  // Anfrage.geraeteName (String) ↔ GeraeteModell.modell (String-Match).
  relations.push({
    from:         "GeraeteModell",
    to:           "Anfrage",
    fromFields:   ["modell"],
    toFields:     ["geraeteName"],
    relationName: "logical__Anfrage_geraeteName__GeraeteModell_modell",
    cardinality:  "1:n",
    soft:         true,
    note:         "Logische Verknüpfung (kein FK, String-Match): Anfrage.geraeteName ≈ GeraeteModell.modell.",
  });

  relations.sort(
    (x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to) || x.relationName.localeCompare(y.relationName),
  );

  return { relations, models: modelInfos };
}

// ── Tabellen-Inhalt: Zell-Werte serialisierungssicher normalisieren (Schritt 4a) ─
//
// $queryRaw liefert je nach Spaltentyp unterschiedliche JS-Werte. Für den
// Transport (superjson/JSON) und die Anzeige normalisieren wir alles auf
// string | null — ohne den Wert zu verfälschen.
function normalisiereZelle(v: unknown): string | null {
  if (v === null || v === undefined)               return null;
  if (typeof v === "bigint")                        return v.toString();
  if (typeof v === "string")                        return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date)                            return v.toISOString();
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) return "[binär]";
  if (typeof v === "object") {
    // Prisma.Decimal & ähnliche Wert-Objekte besitzen ein sinnvolles toString().
    const ctor = (v as { constructor?: { name?: string } }).constructor?.name;
    if (ctor === "Decimal") return (v as { toString(): string }).toString();
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

// ── Router ────────────────────────────────────────────────────────────────────

export const datenbankRouter = createTRPCRouter({

  // Ist der Explorer aktuell freigeschaltet (Cookie vorhanden & gültig)?
  status: adminProcedure.query(async () => {
    const store = await cookies();
    return { unlocked: tokenGueltig(store.get(COOKIE_NAME)?.value) };
  }),

  // Mit Passwort freischalten → signiertes httpOnly-Cookie (2h).
  unlock: adminProcedure
    .input(z.object({ passwort: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => {
      const erwartet = process.env.DB_EXPLORER_PASSWORD;
      if (!erwartet) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB_EXPLORER_PASSWORD ist auf dem Server nicht gesetzt." });
      }
      if (!sicherGleich(input.passwort, erwartet)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Falsches Passwort." });
      }

      const exp   = Date.now() + GUELTIGKEIT_MS;
      const store = await cookies();
      store.set(COOKIE_NAME, baueToken(exp), {
        httpOnly: true,
        secure:   process.env.NODE_ENV === "production",
        sameSite: "lax",
        path:     "/",
        maxAge:   GUELTIGKEIT_MS / 1000,
      });
      return { unlocked: true, gueltigBis: exp };
    }),

  // Manuell sperren (Cookie löschen).
  lock: adminProcedure.mutation(async () => {
    const store = await cookies();
    store.delete(COOKIE_NAME);
    return { unlocked: false };
  }),

  // ── Schritt 2: Übersicht — DB-Name + alle Tabellen mit exakter Zeilenzahl ──
  //
  // Strikt read-only. Tabellennamen stammen AUSSCHLIESSLICH aus
  // INFORMATION_SCHEMA (Whitelist), werden zusätzlich gegen /^[A-Za-z0-9_]+$/
  // geprüft (Defense-in-Depth) und in Backticks gequotet. Kein User-Input
  // fließt jemals ins SQL. MySQL ist auf Linux case-sensitive — Namen werden
  // exakt so verwendet, wie INFORMATION_SCHEMA sie liefert.
  overview: adminProcedure.query(async ({ ctx }) => {
    await requireDbExplorer();

    // 1) Aktueller DB-Name.
    const dbRows = await ctx.prisma.$queryRaw<{ db: string | null }[]>`SELECT DATABASE() AS db`;
    const dbName = dbRows[0]?.db ?? "(unbekannt)";

    // 2) Alle Basistabellen der aktuellen DB (keine Views).
    const tableRows = await ctx.prisma.$queryRaw<{ name: string }[]>`
      SELECT TABLE_NAME AS name
      FROM   INFORMATION_SCHEMA.TABLES
      WHERE  TABLE_SCHEMA = DATABASE()
        AND  TABLE_TYPE   = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `;

    // Defense-in-Depth: nur unbedenkliche Bezeichner durchlassen.
    const namen = tableRows
      .map((r) => r.name)
      .filter((n): n is string => typeof n === "string" && /^[A-Za-z0-9_]+$/.test(n));

    // 3) Exakte Zeilenzahl je Tabelle via COUNT(*). Name ist gewhitelistet +
    //    regex-geprüft, in Backticks gequotet. COUNT(*) liefert BigInt → Number.
    const tables = await Promise.all(
      namen.map(async (name) => {
        const rows = await ctx.prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
          `SELECT COUNT(*) AS cnt FROM \`${name}\``,
        );
        return { name, rows: Number(rows[0]?.cnt ?? 0) };
      }),
    );

    return {
      dbName,
      tables,
      totalTables: tables.length,
      totalRows:   tables.reduce((sum, t) => sum + t.rows, 0),
    };
  }),

  // ── Schritt 3: Verknüpfungen/Relationen (rein aus Prisma DMMF abgeleitet) ──
  // Strikt read-only, keine DB-Abfrage — reine Datenmodell-Ableitung.
  relations: adminProcedure.query(async () => {
    await requireDbExplorer();
    return leiteRelationenAb();
  }),

  // ── Schritt 4a: Tabellen-Inhalt read-only, paginiert, mit Suche/Sortierung ──
  //
  // Sicherheit:
  //  • Tabelle + Spalten stammen ausschließlich aus INFORMATION_SCHEMA (Whitelist)
  //    und werden zusätzlich gegen IDENT geprüft, bevor sie (gequotet) interpoliert
  //    werden. KEIN sonstiger User-Input fließt als Identifier ins SQL.
  //  • Der Suchwert wird NIE interpoliert, sondern als gebundener ?-Parameter
  //    übergeben (ein Platzhalter je durchsuchter Spalte).
  //  • page/pageSize sind validierte Ganzzahlen (pageSize aus fester Auswahl).
  //  • Ausschließlich SELECT — strikt read-only.
  tableRows: adminProcedure
    .input(
      z.object({
        table:      z.string().min(1).max(64),
        page:       z.number().int().min(1).default(1),
        pageSize:   z.union([z.literal(25), z.literal(50), z.literal(100)]).default(50),
        search:     z.string().max(200).optional(),
        sortColumn: z.string().max(64).optional(),
        sortDir:    z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireDbExplorer();

      // 1) Tabelle gegen Whitelist (BASE TABLE der aktuellen DB) + IDENT prüfen.
      const tableRows = await ctx.prisma.$queryRaw<{ name: string }[]>`
        SELECT TABLE_NAME AS name
        FROM   INFORMATION_SCHEMA.TABLES
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_TYPE   = 'BASE TABLE'
      `;
      const erlaubteTabellen = new Set(tableRows.map((r) => r.name));
      if (!IDENT.test(input.table) || !erlaubteTabellen.has(input.table)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unbekannte Tabelle." });
      }

      // 2) Spalten aus INFORMATION_SCHEMA holen (Tabellenname als gebundener Param).
      const colRows = await ctx.prisma.$queryRaw<
        { name: string; dataType: string; nullable: string; colKey: string }[]
      >`
        SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, IS_NULLABLE AS nullable, COLUMN_KEY AS colKey
        FROM   INFORMATION_SCHEMA.COLUMNS
        WHERE  TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${input.table}
        ORDER BY ORDINAL_POSITION
      `;

      const columns = colRows
        .filter((c) => IDENT.test(c.name)) // Defense-in-Depth
        .map((c) => ({
          name:         c.name,
          type:         c.dataType,
          nullable:     c.nullable === "YES",
          isPrimaryKey: c.colKey === "PRI",
        }));

      const primaryKey = columns.find((c) => c.isPrimaryKey)?.name ?? null;

      if (columns.length === 0) {
        return { columns, rows: [], total: 0, page: 1, pageSize: input.pageSize, primaryKey };
      }

      // 3) Such-Filter: über ALLE Spalten, je Spalte CAST(`col` AS CHAR) LIKE ?.
      //    Suchwert ausschließlich als gebundener Parameter (ein ? je Spalte).
      const params: string[] = [];
      let   where = "";
      const suche = input.search?.trim();
      if (suche) {
        const like    = `%${suche}%`;
        const klauseln = columns.map((c) => `CAST(\`${c.name}\` AS CHAR) LIKE ?`);
        where = ` WHERE ${klauseln.join(" OR ")}`;
        for (const _ of columns) params.push(like);
      }

      // 4) Sortierung: validierte Spalte + Richtung. Default = PK (stabile Pagination),
      //    sonst erste Spalte.
      const colNames  = new Set(columns.map((c) => c.name));
      let   orderCol  = primaryKey ?? columns[0].name;
      if (input.sortColumn && IDENT.test(input.sortColumn) && colNames.has(input.sortColumn)) {
        orderCol = input.sortColumn;
      }
      const orderDir   = input.sortDir === "desc" ? "DESC" : "ASC";
      const orderBy    = ` ORDER BY \`${orderCol}\` ${orderDir}`;

      // 5) Gesamtzahl mit gleichem Filter.
      const countRows = await ctx.prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
        `SELECT COUNT(*) AS cnt FROM \`${input.table}\`${where}`,
        ...params,
      );
      const total = Number(countRows[0]?.cnt ?? 0);

      // 6) Pagination (validierte Ganzzahlen, sicher interpolierbar).
      const offset = (input.page - 1) * input.pageSize;
      const rawRows = await ctx.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM \`${input.table}\`${where}${orderBy} LIMIT ${input.pageSize} OFFSET ${offset}`,
        ...params,
      );

      // 7) Zellen serialisierungssicher normalisieren (Reihenfolge = Spaltenliste).
      const rows = rawRows.map((r) => {
        const obj: Record<string, string | null> = {};
        for (const c of columns) obj[c.name] = normalisiereZelle(r[c.name]);
        return obj;
      });

      return { columns, rows, total, page: input.page, pageSize: input.pageSize, primaryKey };
    }),

  // ── Feature "Artikel-Kompatibilität": Geräte zu einem Artikel ──────────────
  //
  // Ein Artikel (Artikel.id) kann mit mehreren Geräten verknüpft sein. Die
  // Verbindung steht in Kompatibilitaet (geraet [Freitext], teiltyp, artikelId).
  // Strikt read-only. artikelId ausschließlich als gebundener Parameter; der
  // Tabellenname Kompatibilitaet ist konstant. Geräte-Strings bleiben UNVERÄNDERT
  // (kein Merge/Fuzzy) — Datenintegrität.
  artikelKompatibilitaet: adminProcedure
    .input(z.object({ artikelId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireDbExplorer();

      const rows = await ctx.prisma.$queryRaw<{ id: number; geraet: string; teiltyp: string }[]>`
        SELECT id, geraet, teiltyp
        FROM   Kompatibilitaet
        WHERE  artikelId = ${input.artikelId}
        ORDER BY geraet
      `;

      const geraete = rows.map((r) => r.geraet); // exakt wie gespeichert
      const teiltypen = [...new Set(rows.map((r) => r.teiltyp))];
      const teiltyp =
        teiltypen.length === 0 ? null
        : teiltypen.length === 1 ? teiltypen[0]
        : teiltypen.join(", "); // mehrere Teiltypen: alle nennen

      // Rohe Treffer für die anschauliche Fluss-Darstellung (artikelId = Input).
      const treffer = rows.map((r) => ({ id: Number(r.id), geraet: r.geraet, teiltyp: r.teiltyp }));

      return { artikelId: input.artikelId, teiltyp, geraete, anzahl: geraete.length, treffer };
    }),

});
