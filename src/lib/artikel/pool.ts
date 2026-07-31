import { prisma } from "@/core/db/prisma";
import { TRPCError } from "@trpc/server";

// ── Ersatzteil-Pool ──────────────────────────────────────────────────────────
//
// Zwei Artikel können dasselbe physische Teil sein (Anlass: beim U711 sind
// vordere und hintere Gummifüße baugleich). Sie teilen sich dann rechnerisch
// EINEN Bestand — buchst du 230 Füße auf „vorne", sind sie auch für „hinten"
// verfügbar und werden von dort abgebucht.
//
// WICHTIG — bewusste Entwurfsentscheidung: Der Pool wird IMMER **vor** der
// eigentlichen Buchung aufgelöst („welcher Artikel hat die Stückzahl?"), nie
// innerhalb von `bucheLager`. Damit bleiben dessen Zusicherungen unangetastet:
// bedingtes Dekrement in der Transaktion, kein negativer Bestand, DIREKT ohne
// Bestandseffekt. Wer das ändert, hebelt genau diese Sicherungen aus.
//
// Es wird NICHT reserviert. Zwei Anfragen über je 2 Stück bei 3 im Pool gehen
// beide als „lieferbar" durch; die zweite scheitert beim Ausgeben mit klarer
// Meldung. Das ist exakt das Verhalten, das Lagernaut auch ohne Pool zeigt —
// hier wird nur der Blick auf den Bestand erweitert, keine neue Regel erfunden.

export type PoolArtikel = {
  id:            number;
  bezeichnung:   string;
  bestand:       number;
  poolPartnerId: number | null;
};

/**
 * Verknüpft zwei Artikel zu einem Pool — symmetrisch, beide Seiten zeigen
 * aufeinander. Bestehende Verknüpfungen der beiden werden dabei gelöst, damit
 * keine Ketten entstehen (ein Artikel hat höchstens EINEN Partner).
 */
export async function verknuepfePool(artikelAId: number, artikelBId: number) {
  if (artikelAId === artikelBId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Ein Artikel kann nicht mit sich selbst verknüpft werden." });
  }

  const [a, b] = await Promise.all([
    prisma.artikel.findUnique({ where: { id: artikelAId }, select: { id: true, bezeichnung: true, standortId: true, poolPartnerId: true } }),
    prisma.artikel.findUnique({ where: { id: artikelBId }, select: { id: true, bezeichnung: true, standortId: true, poolPartnerId: true } }),
  ]);
  if (!a || !b) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Artikel nicht gefunden." });
  }
  if (a.standortId !== b.standortId) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: "Nur Artikel am selben Standort können einen Pool bilden — sonst würde Bestand über Standorte hinweg gezählt.",
    });
  }

  // Alt-Partner beider Seiten lösen, dann neu paaren. Alles in EINER Transaktion,
  // sonst bleibt bei einem Abbruch eine halbseitige Verknüpfung zurück.
  await prisma.$transaction([
    ...(a.poolPartnerId && a.poolPartnerId !== b.id
      ? [prisma.artikel.updateMany({ where: { id: a.poolPartnerId }, data: { poolPartnerId: null } })] : []),
    ...(b.poolPartnerId && b.poolPartnerId !== a.id
      ? [prisma.artikel.updateMany({ where: { id: b.poolPartnerId }, data: { poolPartnerId: null } })] : []),
    prisma.artikel.update({ where: { id: a.id }, data: { poolPartnerId: b.id } }),
    prisma.artikel.update({ where: { id: b.id }, data: { poolPartnerId: a.id } }),
  ]);

  return { a: a.bezeichnung, b: b.bezeichnung };
}

/** Hebt die Verknüpfung auf — immer auf BEIDEN Seiten. */
export async function loesePool(artikelId: number) {
  const artikel = await prisma.artikel.findUnique({
    where: { id: artikelId }, select: { id: true, poolPartnerId: true },
  });
  if (!artikel) throw new TRPCError({ code: "NOT_FOUND", message: "Artikel nicht gefunden." });
  if (!artikel.poolPartnerId) return { geloest: false };

  await prisma.$transaction([
    prisma.artikel.updateMany({ where: { id: artikel.poolPartnerId }, data: { poolPartnerId: null } }),
    prisma.artikel.update({ where: { id: artikel.id }, data: { poolPartnerId: null } }),
  ]);
  return { geloest: true };
}

/**
 * Verfügbare Stückzahl inklusive Partner. Ohne Partner schlicht der eigene Bestand.
 */
export async function poolBestand(artikelId: number): Promise<number> {
  const artikel = await prisma.artikel.findUnique({
    where: { id: artikelId }, select: { bestand: true, poolPartnerId: true },
  });
  if (!artikel) return 0;
  if (!artikel.poolPartnerId) return artikel.bestand;

  const partner = await prisma.artikel.findUnique({
    where: { id: artikel.poolPartnerId }, select: { bestand: true },
  });
  return artikel.bestand + (partner?.bestand ?? 0);
}

/**
 * Bestimmt, VON WELCHEM Artikel die Stückzahl abgebucht wird.
 *
 * Reihenfolge: erst der Artikel selbst (der eigene Bestand soll zuerst leerlaufen),
 * dann der Pool-Partner. Reicht keiner allein, wird abgelehnt — ein Aufteilen über
 * beide Artikel hinweg wäre eine Teil-Ausgabe und würde die Anfrage-Menge
 * aufsplitten; das macht Lagernaut bewusst nirgends.
 *
 * Gibt null zurück, wenn nichts reicht — die Aufrufstelle entscheidet dann über
 * die Fehlermeldung (Wortlaut hängt vom Kontext ab).
 */
export async function waehleQuelle(artikelId: number, menge: number): Promise<number | null> {
  const artikel = await prisma.artikel.findUnique({
    where: { id: artikelId }, select: { id: true, bestand: true, poolPartnerId: true },
  });
  if (!artikel) return null;
  if (artikel.bestand >= menge) return artikel.id;
  if (!artikel.poolPartnerId) return null;

  const partner = await prisma.artikel.findUnique({
    where: { id: artikel.poolPartnerId }, select: { id: true, bestand: true },
  });
  return partner && partner.bestand >= menge ? partner.id : null;
}

/**
 * Pool-Bestände für viele Artikel auf einmal — für Listen und Grids, damit dort
 * nicht pro Zeile nachgefragt wird (N+1).
 * Liefert eine Map artikelId → verfügbare Stückzahl inkl. Partner.
 */
export async function poolBestaendeFuer(artikelIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (artikelIds.length === 0) return map;

  const artikel = await prisma.artikel.findMany({
    where:  { id: { in: artikelIds } },
    select: { id: true, bestand: true, poolPartnerId: true },
  });

  // Partner nachladen, soweit nicht ohnehin schon in der Auswahl
  const bekannt = new Map(artikel.map((a) => [a.id, a.bestand]));
  const fehlende = artikel
    .map((a) => a.poolPartnerId)
    .filter((id): id is number => !!id && !bekannt.has(id));

  if (fehlende.length > 0) {
    const partner = await prisma.artikel.findMany({
      where:  { id: { in: Array.from(new Set(fehlende)) } },
      select: { id: true, bestand: true },
    });
    for (const p of partner) bekannt.set(p.id, p.bestand);
  }

  for (const a of artikel) {
    map.set(a.id, a.bestand + (a.poolPartnerId ? bekannt.get(a.poolPartnerId) ?? 0 : 0));
  }
  return map;
}
