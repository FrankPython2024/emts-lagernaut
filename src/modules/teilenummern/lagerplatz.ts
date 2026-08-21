import { prisma } from "@/core/db/prisma";

// ── Wo gehört dieses Teil hin? ───────────────────────────────────────────────
//
// Sobald feststeht, in welche Gerätemodelle ein Teil passt, lässt sich auch
// sagen, wo Teile für diese Geräte schon liegen. Die Frage „wo tue ich das
// hin" muss dann niemand mehr aus dem Kopf beantworten.
//
// Vier Quellen, absteigend nach Aussagekraft:
//
//   0. Dem Gerätemodell ist ein ETL-Fach ZUGETEILT. Das ist keine Ableitung
//      aus Bestand, sondern eine Festlegung: „ein Fach = ein Modell". Wenn es
//      sie gibt, ist sie die Antwort.
//      ⚠️ Diese Quelle fehlte bis 21.08.2026 vollständig. Gefragt wurde nur,
//      wo TEILE liegen (über Artikel.lagerplatz) — nie, welches Fach dem Gerät
//      gehört. Das ist ein anderes System: `LagerplatzBelegung` gegen den
//      String `Artikel.lagerplatz`, siehe CLAUDE.md „ZWEI getrennte Systeme".
//
//   1. Ein Artikel MIT DERSELBEN Teilenummer liegt schon irgendwo. Dann gehört
//      das Stück genau dorthin, ohne Wenn und Aber.
//   2. Artikel desselben Teiltyps für eines der gefundenen Modelle. Dort liegen
//      die verwandten Teile.
//   3. Andere Teile derselben Modelle, egal welcher Teiltyp. Schwächer, aber
//      immer noch besser als raten.
//
// ⚠️ Es wird nichts erzwungen. Der Vorschlag steht als Knopf da, das Feld
// bleibt frei änderbar. Wer weiß, dass eine Kiste woanders steht, hat recht.

export type PlatzVorschlag = {
  lagerplatz: string;
  /** Wie viele Artikel dort liegen, die zu diesem Teil passen. */
  artikel:    number;
  /** Gesamtbestand an diesem Platz — sagt, ob dort wirklich etwas ist. */
  bestand:    number;
  grund:      string;
  /**
   * 0 = dem Modell zugeteiltes ETL-Fach, 1 = sicher (gleiche Nummer),
   * 2 = gleicher Teiltyp, 3 = gleiches Modell.
   */
  stufe:      0 | 1 | 2 | 3;
  /** Bei Stufe 0: das Modell, dem das Fach gehört — für die Rückfrage. */
  fachModell?: string;
};

export async function platzVorschlaege(input: {
  teilenummerId?: number | null;
  teiltyp:        string;
  /** Namen der Gerätemodelle, z. B. „HP ProBook 440 G6". */
  geraete:        string[];
  /** Ids derselben Modelle — nur damit lässt sich die Fachbelegung finden. */
  modellIds?:     number[];
  standortId:     number;
}): Promise<PlatzVorschlag[]> {
  const gefunden = new Map<string, PlatzVorschlag>();

  const merke = (
    platz: string | null, bestand: number, grund: string, stufe: 0 | 1 | 2 | 3,
    fachModell?: string,
  ) => {
    const p = platz?.trim();
    if (!p) return;
    const da = gefunden.get(p);
    // Die stärkste Begründung gewinnt; bei gleicher Stufe wird aufaddiert.
    if (!da) { gefunden.set(p, { lagerplatz: p, artikel: 1, bestand, grund, stufe, fachModell }); return; }
    if (stufe < da.stufe) { gefunden.set(p, { lagerplatz: p, artikel: 1, bestand, grund, stufe, fachModell }); return; }
    if (stufe === da.stufe) { da.artikel += 1; da.bestand += bestand; }
  };

  // ── 0. Dem Modell zugeteiltes ETL-Fach ─────────────────────────
  // Die stärkste Aussage überhaupt: Hier hat ein Mensch festgelegt, wo dieses
  // Modell wohnt. Kein Ableiten aus Bestand nötig.
  if (input.modellIds && input.modellIds.length > 0) {
    const belegt = await prisma.lagerplatzBelegung.findMany({
      where:   { modellId: { in: input.modellIds }, lagerplatz: { standortId: input.standortId } },
      include: {
        lagerplatz: { select: { code: true } },
        modell:     { select: { hersteller: true, modell: true } },
      },
    });
    for (const b of belegt) {
      const name = `${b.modell.hersteller} ${b.modell.modell}`.trim();
      merke(b.lagerplatz.code, 0, `Fach von ${name}`, 0, name);
    }
  }

  // ── 1. Gleiche Teilenummer ───────────────────────────────────────────────
  if (input.teilenummerId) {
    const gleiche = await prisma.artikel.findMany({
      where:  { teilenummerId: input.teilenummerId, standortId: input.standortId },
      select: { lagerplatz: true, bestand: true },
    });
    for (const a of gleiche) merke(a.lagerplatz, a.bestand, "Dieses Teil liegt dort schon", 1);
  }

  if (input.geraete.length > 0) {
    // ── 2. Gleicher Teiltyp für eines der Modelle ──────────────────────────
    const passend = await prisma.artikel.findMany({
      where: {
        standortId: input.standortId,
        kompatibel: { some: { geraet: { in: input.geraete }, teiltyp: input.teiltyp } },
      },
      select: { lagerplatz: true, bestand: true },
      take:   50,
    });
    for (const a of passend) {
      merke(a.lagerplatz, a.bestand, `Andere ${input.teiltyp} für dieses Gerät liegen dort`, 2);
    }

    // ── 3. Irgendein Teil dieser Modelle ───────────────────────────────────
    const verwandt = await prisma.artikel.findMany({
      where: {
        standortId: input.standortId,
        kompatibel: { some: { geraet: { in: input.geraete } } },
      },
      select: { lagerplatz: true, bestand: true },
      take:   50,
    });
    for (const a of verwandt) {
      merke(a.lagerplatz, a.bestand, "Andere Teile dieses Geräts liegen dort", 3);
    }
  }

  return Array.from(gefunden.values())
    // Erst nach Aussagekraft, dann nach Anzahl der Artikel.
    .sort((a, b) => a.stufe - b.stufe || b.artikel - a.artikel)
    .slice(0, 5);
}
