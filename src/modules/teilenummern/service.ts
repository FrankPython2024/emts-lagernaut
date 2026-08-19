import { prisma } from "@/core/db/prisma";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";

// ── Teilenummern ─────────────────────────────────────────────────────────────
//
// Die vom Hersteller aufgedruckte Nummer wird zur Identität des Artikels.
// Hintergrund: Dasselbe USB-Board, einmal aus einem Spendergerät geerntet und
// einmal lose eingelagert, muss auf DENSELBEN Artikel laufen. Über den Namen
// klappt das nicht — genau daran liegt es, dass ein einziges Touchpad 24-mal
// in der Datenbank steht.
//
// ⚠️ Die Normalisierung steht AUSSCHLIESSLICH hier. Wird die Nummer an zwei
// Stellen unterschiedlich zurechtgeschnitten, entstehen zwei Einträge für
// dasselbe Teil — und der ganze Zweck wäre dahin.

/**
 * Nummer vereinheitlichen: Großschreibung, keine Leerzeichen, keine
 * Trennzeichen. „DA0X8JTB8D0", „da0x8jtb8d0" und „DA0-X8J-TB8D0" sind
 * dieselbe Nummer.
 *
 * Bewusst KEINE weitere Klugheit: Führende Nullen bleiben, denn bei Dell
 * gehören sie dazu („0GG3K9").
 */
export function normalisiere(roh: string): string {
  return roh.trim().toUpperCase().replace(/[\s\-_./]/g, "");
}

/** Grobe Plausibilität — fängt versehentlich gescannte Fremdcodes ab. */
export function istPlausibel(nummer: string): boolean {
  const n = normalisiere(nummer);
  // Mindestens 5 Zeichen, höchstens 40, nur Ziffern und Großbuchstaben,
  // und mindestens EINE Ziffer (reine Buchstabenfolgen sind meist Text
  // vom Etikett, kein Teilecode).
  return /^[A-Z0-9]{5,40}$/.test(n) && /[0-9]/.test(n);
}

/**
 * Zusammengesetzte Barcodes in plausible Teilstücke zerlegen.
 *
 * Ein Handscanner liefert oft mehr als die reine Teilenummer. Auf einer
 * Lenovo-Tastatur steht als Barcode „8SSN20V43652C3DG1AK01XR", die eigentliche
 * Teilenummer darin ist „SN20V43652". Ohne diese Zerlegung wären das zwei
 * verschiedene Teile, je nachdem was jemand gescannt hat.
 *
 * ⚠️ Bewusst OHNE Herstellerwissen. Statt Formate zu kennen (was bedeutet
 * „8S"?), werden plausible Teilstücke gebildet. Das trägt auch bei Herstellern,
 * deren Aufbau wir nicht kennen, und altert nicht.
 */
export function kandidaten(roh: string): string[] {
  const n = normalisiere(roh);
  const liste = new Set<string>([n]);

  // Kurze führende Präfixe abschneiden.
  for (const laenge of [2, 3]) {
    if (n.length > laenge + 6) liste.add(n.slice(laenge));
  }

  // Blöcke in typischer Teilenummernlänge herausziehen.
  for (const t of n.match(/[A-Z]{0,3}\d[A-Z0-9]{5,14}/g) ?? []) {
    if (t.length >= 7 && t.length <= 16) liste.add(t);
  }

  return Array.from(liste).slice(0, 4);
}

/**
 * Den passenden Eintrag zu einem rohen Scan finden — in BEIDE Richtungen.
 *
 * Fall 1: Gespeichert ist die kurze Nummer, gescannt wird der lange Barcode.
 *         Das decken die Teilstücke oben ab.
 * Fall 2: Gespeichert ist der lange Barcode (weil jemand ihn zuerst gescannt
 *         hat), getippt wird die kurze Nummer vom Etikett. Dann hilft die
 *         Zerlegung nicht — hier muss geprüft werden, ob eine gespeicherte
 *         Nummer IN der Eingabe steckt oder die Eingabe in einer gespeicherten.
 *
 * Ohne Fall 2 entstünden für dasselbe Teil zwei Einträge, je nachdem wer was
 * gescannt hat. Genau das soll die Teilenummer ja verhindern.
 */
export async function findeEintrag(
  client: Prisma.TransactionClient,
  roh: string,
): Promise<{ id: number } | null> {
  const nummer = normalisiere(roh);
  if (!nummer) return null;

  // Schnellweg: exakte Nummer oder eines ihrer Teilstücke.
  const direkt = await client.teilenummer.findFirst({
    where:   { nummer: { in: kandidaten(nummer) } },
    // Kürzeste zuerst — die reine Teilenummer ist das kürzere Teilstück.
    orderBy: { nummer: "asc" },
    select:  { id: true },
  });
  if (direkt) return direkt;

  // Langsamweg, nur wenn nötig: steckt eine gespeicherte Nummer in der Eingabe,
  // oder die Eingabe in einer gespeicherten? Volltabellensuche, aber die
  // Tabelle ist klein und dieser Fall tritt selten ein.
  const treffer = await client.$queryRaw<{ id: number }[]>`
    SELECT id FROM Teilenummer
    WHERE CHAR_LENGTH(nummer) >= 6
      AND (${nummer} LIKE CONCAT('%', nummer, '%') OR nummer LIKE CONCAT('%', ${nummer}, '%'))
    ORDER BY CHAR_LENGTH(nummer) ASC
    LIMIT 1`;
  return treffer[0] ?? null;
}

export type TeilenummerInfo = {
  id:              number;
  nummer:          string;
  hersteller:      string | null;
  teiltyp:         string | null;
  istSeriennummer: boolean;
  geprueft:        boolean;
  sichtungen:      number;
  notiz:           string | null;
  modelle:         { modellId: number; hersteller: string; modell: string; quelle: string; bestaetigt: boolean }[];
  /** Artikel, die an dieser Nummer hängen — je Standort höchstens einer. */
  artikel:         { id: number; bezeichnung: string; kategorie: string; bestand: number; standortId: number }[];
};

/**
 * Nummer nachschlagen, ohne etwas anzulegen. Für das Scanfeld: Der Mitarbeiter
 * soll sofort sehen, ob die Nummer bekannt ist, bevor irgendetwas gebucht wird.
 */
export async function schlageNach(roh: string): Promise<TeilenummerInfo | null> {
  const nummer = normalisiere(roh);
  if (!nummer) return null;

  // Beidseitig suchen: Wer den langen Barcode scannt, soll denselben Treffer
  // sehen wie jemand, der die kurze Nummer vom Etikett abtippt — und umgekehrt.
  const gefunden = await findeEintrag(prisma, nummer);
  if (!gefunden) return null;

  const t = await prisma.teilenummer.findUnique({
    where:   { id: gefunden.id },
    include: {
      modelle: { include: { modell: { select: { id: true, hersteller: true, modell: true } } } },
      artikel: { select: { id: true, bezeichnung: true, kategorie: true, bestand: true, standortId: true } },
    },
  });
  if (!t) return null;

  return {
    id: t.id, nummer: t.nummer, hersteller: t.hersteller, teiltyp: t.teiltyp,
    istSeriennummer: t.istSeriennummer, geprueft: t.geprueft,
    sichtungen: t.sichtungen, notiz: t.notiz,
    modelle: t.modelle.map((m) => ({
      modellId: m.modell.id, hersteller: m.modell.hersteller, modell: m.modell.modell,
      quelle: m.quelle, bestaetigt: m.bestaetigt,
    })),
    artikel: t.artikel,
  };
}

/**
 * Nummer holen oder anlegen und die Sichtung zählen.
 *
 * Wird beim Einlagern aufgerufen. Läuft innerhalb der übergebenen Transaktion,
 * damit eine abgebrochene Einlagerung keine halb angelegte Nummer hinterlässt.
 */
export async function findeOderLegeAn(
  tx: Prisma.TransactionClient,
  roh: string,
  ergaenzung?: { hersteller?: string | null; teiltyp?: string | null },
): Promise<{ id: number; nummer: string; istSeriennummer: boolean; neu: boolean }> {
  const nummer = normalisiere(roh);
  if (!istPlausibel(nummer)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `„${roh}" sieht nicht wie eine Teilenummer aus (5 bis 40 Zeichen, Buchstaben und Ziffern).`,
    });
  }

  // Beidseitig suchen: Sonst entstünden für dasselbe Teil zwei Einträge, je
  // nachdem ob jemand den Barcode gescannt oder die Nummer vom Etikett
  // abgetippt hat.
  const gefunden = await findeEintrag(tx, nummer);
  const vorhanden = gefunden
    ? await tx.teilenummer.findUnique({
        where:  { id: gefunden.id },
        select: { id: true, nummer: true, istSeriennummer: true, hersteller: true, teiltyp: true },
      })
    : null;

  if (vorhanden) {
    await tx.teilenummer.update({
      where: { id: vorhanden.id },
      data: {
        sichtungen: { increment: 1 },
        // Nur ergänzen, nie überschreiben: Was ein Mensch einmal eingetragen
        // hat, soll ein späterer Scan nicht stillschweigend ersetzen.
        ...(vorhanden.hersteller ? {} : { hersteller: ergaenzung?.hersteller ?? undefined }),
        ...(vorhanden.teiltyp    ? {} : { teiltyp:    ergaenzung?.teiltyp    ?? undefined }),
      },
    });
    return { ...vorhanden, neu: false };
  }

  const angelegt = await tx.teilenummer.create({
    data: {
      nummer,
      hersteller: ergaenzung?.hersteller ?? null,
      teiltyp:    ergaenzung?.teiltyp    ?? null,
      sichtungen: 1,
    },
    select: { id: true, nummer: true, istSeriennummer: true },
  });
  return { ...angelegt, neu: true };
}

/**
 * Das Spendermodell als gesicherte Aussage an der Nummer festhalten.
 *
 * Das ist der Anker: Aus welchem Gerät das Teil kam, ist bekannt und sicher.
 * An dieser Aussage lässt sich später jede maschinell gefundene Modellliste
 * messen — enthält sie das Spendermodell nicht, stimmt etwas nicht.
 */
export async function merkeSpendermodell(
  tx: Prisma.TransactionClient,
  teilenummerId: number,
  modellId: number,
): Promise<void> {
  await tx.teilenummerModell.upsert({
    where:  { teilenummerId_modellId: { teilenummerId, modellId } },
    create: { teilenummerId, modellId, quelle: "SPENDER", bestaetigt: true },
    // Eine bereits bestätigte Zeile bleibt bestätigt; war sie vorher nur ein
    // maschineller Vorschlag, hebt der echte Spender sie auf „sicher".
    update: { quelle: "SPENDER", bestaetigt: true },
  });
}

/**
 * Artikel mit einer Nummer verheiraten.
 *
 * ⚠️ Nur setzen, wenn der Artikel noch keine hat. Eine bestehende Zuordnung zu
 * überschreiben würde bedeuten, dass ein Fehlscan die Identität eines Artikels
 * mit Bestand und Historie ändert.
 */
export async function verknuepfeArtikel(
  tx: Prisma.TransactionClient,
  artikelId: number,
  teilenummerId: number,
): Promise<{ gesetzt: boolean; grund?: string }> {
  const artikel = await tx.artikel.findUnique({
    where: { id: artikelId }, select: { teilenummerId: true, standortId: true },
  });
  if (!artikel) return { gesetzt: false, grund: "Artikel nicht gefunden." };
  if (artikel.teilenummerId === teilenummerId) return { gesetzt: true };
  if (artikel.teilenummerId != null) {
    return { gesetzt: false, grund: "Artikel hat bereits eine andere Teilenummer." };
  }

  // Hängt am selben Standort schon ein anderer Artikel an dieser Nummer, wäre
  // der Unique-Schlüssel verletzt. Das ist kein Absturz wert — die Einlagerung
  // läuft ohne Verknüpfung weiter, der Fall landet in der Pflegeliste.
  const belegt = await tx.artikel.findFirst({
    where:  { teilenummerId, standortId: artikel.standortId, NOT: { id: artikelId } },
    select: { id: true, bezeichnung: true },
  });
  if (belegt) {
    return { gesetzt: false, grund: `Nummer hängt hier schon an „${belegt.bezeichnung}" (#${belegt.id}).` };
  }

  await tx.artikel.update({ where: { id: artikelId }, data: { teilenummerId } });
  return { gesetzt: true };
}

/** Artikel zu einer Nummer an einem Standort — der Kern der Identitätsregel. */
export async function artikelZuNummer(
  tx: Prisma.TransactionClient,
  teilenummerId: number,
  standortId: number,
) {
  return tx.artikel.findFirst({
    where:  { teilenummerId, standortId },
    select: { id: true, bezeichnung: true, kategorie: true, lagerplatz: true, bestand: true },
  });
}

// ── Pflegeliste ──────────────────────────────────────────────────────────────

export type ListeFilter = {
  nurOffen?:  boolean;   // noch nicht geprüft
  suche?:     string;
  limit?:     number;
};

export async function liste(f: ListeFilter = {}) {
  const suche = f.suche?.trim();
  const where: Prisma.TeilenummerWhereInput = {
    ...(f.nurOffen ? { geprueft: false, istSeriennummer: false } : {}),
    ...(suche ? {
      OR: [
        { nummer:     { contains: normalisiere(suche) } },
        { hersteller: { contains: suche } },
        { teiltyp:    { contains: suche } },
      ],
    } : {}),
  };

  const [zeilen, offen, gesamt] = await Promise.all([
    prisma.teilenummer.findMany({
      where,
      orderBy: [{ geprueft: "asc" }, { sichtungen: "desc" }, { erstelltAm: "desc" }],
      take:    f.limit ?? 200,
      include: {
        modelle: { include: { modell: { select: { id: true, hersteller: true, modell: true } } } },
        artikel: { select: { id: true, bezeichnung: true, bestand: true, standortId: true } },
      },
    }),
    prisma.teilenummer.count({ where: { geprueft: false, istSeriennummer: false } }),
    prisma.teilenummer.count(),
  ]);

  return {
    zeilen: zeilen.map((t) => ({
      id: t.id, nummer: t.nummer, hersteller: t.hersteller, teiltyp: t.teiltyp,
      istSeriennummer: t.istSeriennummer, geprueft: t.geprueft,
      sichtungen: t.sichtungen, notiz: t.notiz, erstelltAm: t.erstelltAm,
      // Genau EIN Vorkommen bei mehreren Einlagerungen spricht für eine
      // Seriennummer. Als Hinweis, nicht als Automatik — entscheiden soll ein Mensch.
      seriennummerVerdacht: t.sichtungen === 1 && t.modelle.length <= 1,
      modelle: t.modelle.map((m) => ({
        modellId: m.modell.id, name: `${m.modell.hersteller} ${m.modell.modell}`,
        quelle: m.quelle, bestaetigt: m.bestaetigt,
      })),
      artikel: t.artikel,
    })),
    offen, gesamt,
  };
}

export async function aktualisiere(id: number, data: {
  nummer?:          string;
  hersteller?:      string | null;
  teiltyp?:         string | null;
  notiz?:           string | null;
  istSeriennummer?: boolean;
  geprueft?:        boolean;
}) {
  // ── Nummer korrigieren ────────────────────────────────────────────────────
  // Nötig, weil ein Scanner oft den Sammelbarcode liefert statt der reinen
  // Teilenummer: Auf einer Lenovo-Tastatur steht „8SSN20V43652C3DG1AK01XR",
  // die eigentliche Nummer darin ist „SN20V43652". Der lange Code steht im
  // Netz nirgends, also findet auch keine Suche etwas dazu.
  //
  // Die Zerlegung im Code trifft nicht jedes Herstellerformat. Statt immer
  // neue Sonderregeln zu bauen, darf ein Mensch die Nummer richtigstellen —
  // einmal je Nummer, danach gilt sie für alle Stücke.
  if (data.nummer !== undefined) {
    const neu = normalisiere(data.nummer);
    if (!istPlausibel(neu)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `„${data.nummer}" sieht nicht wie eine Teilenummer aus.`,
      });
    }
    const belegt = await prisma.teilenummer.findFirst({
      where:  { nummer: neu, NOT: { id } },
      select: { id: true },
    });
    if (belegt) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `„${neu}" gibt es schon als eigenen Eintrag (#${belegt.id}). Bitte dort weiterpflegen.`,
      });
    }
  }

  return prisma.teilenummer.update({
    where: { id },
    data: {
      ...(data.nummer !== undefined && { nummer: normalisiere(data.nummer) }),
      ...(data.hersteller      !== undefined && { hersteller: data.hersteller?.trim() || null }),
      ...(data.teiltyp         !== undefined && { teiltyp:    data.teiltyp?.trim()    || null }),
      ...(data.notiz           !== undefined && { notiz:      data.notiz?.trim()      || null }),
      ...(data.istSeriennummer !== undefined && { istSeriennummer: data.istSeriennummer }),
      ...(data.geprueft        !== undefined && { geprueft:        data.geprueft }),
    },
  });
}

/**
 * Modelle einer Nummer setzen (manuell nachgeschlagen).
 *
 * Ersetzt NICHT die Spender-Aussagen: Was aus einem echten Altgerät stammt,
 * bleibt stehen, auch wenn es in der eingefügten Liste fehlt. Die Realität im
 * Regal schlägt die Angabe aus einer Verkaufsanzeige.
 */
export async function setzeModelle(id: number, modellIds: number[], quelle = "MANUELL") {
  return prisma.$transaction(async (tx) => {
    await tx.teilenummerModell.deleteMany({
      where: { teilenummerId: id, quelle: { not: "SPENDER" } },
    });
    if (modellIds.length > 0) {
      await tx.teilenummerModell.createMany({
        data: modellIds.map((modellId) => ({
          teilenummerId: id, modellId, quelle, bestaetigt: quelle === "MANUELL",
        })),
        skipDuplicates: true,
      });
    }
    const anzahl = await tx.teilenummerModell.count({ where: { teilenummerId: id } });
    return { modelle: anzahl };
  });
}

/**
 * Modellnamen als Freitext zuordnen — der Weg für „Liste aus dem Netz
 * einfügen". Trifft nur, was es in GeraeteModell wirklich gibt; alles andere
 * wird zurückgemeldet, statt still zu verschwinden.
 */
export async function ordneNamenZu(id: number, namen: string[]): Promise<{
  zugeordnet: number; getroffen: string[]; nichtGefunden: string[];
}> {
  const modelle = await prisma.geraeteModell.findMany({
    where:  { aktiv: true },
    select: { id: true, hersteller: true, modell: true },
  });

  const index = new Map<string, number>();
  for (const m of modelle) {
    index.set(normalisiere(`${m.hersteller} ${m.modell}`), m.id);
    index.set(normalisiere(m.modell), m.id);
  }

  const treffer: number[] = [], getroffen: string[] = [], fehlt: string[] = [];
  for (const roh of namen) {
    const name = roh.trim();
    if (!name) continue;
    const id2 = index.get(normalisiere(name));
    if (id2) { treffer.push(id2); getroffen.push(name); } else { fehlt.push(name); }
  }

  if (treffer.length > 0) await setzeModelle(id, Array.from(new Set(treffer)), "MANUELL");
  return { zugeordnet: new Set(treffer).size, getroffen, nichtGefunden: fehlt };
}
