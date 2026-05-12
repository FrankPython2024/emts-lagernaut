import { BuchungsTyp } from "@prisma/client";
import { prisma }         from "@/core/db/prisma";
import { bucheLager }     from "@/modules/buchungen/service";
import { naechsteBelegNr } from "@/core/infra/belegnr";
import { STANDARD_TEILE } from "./constants";

// ── Gerät suchen ──────────────────────────────────────────────────────────────

function logIdNormalize(raw: string): string {
  return raw.replace(/[.\s\-]/g, "").trim();
}

export type GeraetSuchenResult =
  | { gefunden: true;  typ: "logid" | "modell"; logId: string | null; name: string }
  | { gefunden: false };

export async function geraetSuchen(query: string): Promise<GeraetSuchenResult> {
  const trimmed = query.trim();
  const clean   = logIdNormalize(trimmed);

  // 1. Rein numerische LogID: exakter Treffer
  if (/^\d{7,12}$/.test(clean)) {
    const lookup = await prisma.geraeteLookup.findFirst({
      where: { OR: [{ logId: trimmed }, { logIdClean: clean }] },
    });
    if (lookup) return { gefunden: true, typ: "logid", logId: lookup.logId, name: lookup.bereinigt };
  }

  // 2. Textsuche in GeraeteLookup.bereinigt
  const byText = await prisma.geraeteLookup.findFirst({
    where:   { bereinigt: { contains: trimmed } },
    orderBy: { updatedAt: "desc" },
  });
  if (byText) return { gefunden: true, typ: "logid", logId: byText.logId, name: byText.bereinigt };

  // 3. Suche in GeraeteModell
  const modell = await prisma.geraeteModell.findFirst({
    where: {
      OR: [{ modell: { contains: trimmed } }, { hersteller: { contains: trimmed } }],
      aktiv: true,
    },
    orderBy: { modell: "asc" },
  });
  if (modell) {
    return { gefunden: true, typ: "modell", logId: null, name: `${modell.hersteller} ${modell.modell}` };
  }

  return { gefunden: false };
}

// ── Preview ───────────────────────────────────────────────────────────────────

export type PreviewItem = { teiltyp: string; menge: number; grading: string };

export type PreviewResult = {
  teiltyp:          string;
  menge:            number;
  grading:          string;
  istNeu:           boolean;
  artikelId:        number | null;
  artikelName:      string;
  lagerplatz:       string | null;
  aktuellerBestand: number;
  neuerBestand:     number;
};

export async function preview(items: PreviewItem[], geraetName: string): Promise<PreviewResult[]> {
  return Promise.all(
    items.map(async (item): Promise<PreviewResult> => {
      // Exakter Kompatibilitaets-Treffer für dieses Gerät + Teiltyp
      const komp = await prisma.kompatibilitaet.findFirst({
        where:   { geraet: geraetName, teiltyp: item.teiltyp },
        include: { artikel: true },
      });
      if (komp) {
        return {
          teiltyp:          item.teiltyp,
          menge:            item.menge,
          grading:          item.grading,
          istNeu:           false,
          artikelId:        komp.artikelId,
          artikelName:      komp.artikel.bezeichnung,
          lagerplatz:       komp.artikel.lagerplatz,
          aktuellerBestand: komp.artikel.bestand,
          neuerBestand:     komp.artikel.bestand + item.menge,
        };
      }

      // Vorhandener Artikel gleicher Kategorie (aus früheren Einlagerungen)
      const artikel = await prisma.artikel.findFirst({
        where:   { kategorie: item.teiltyp },
        orderBy: { bestand: "desc" },
      });
      if (artikel) {
        return {
          teiltyp:          item.teiltyp,
          menge:            item.menge,
          grading:          item.grading,
          istNeu:           false,
          artikelId:        artikel.id,
          artikelName:      artikel.bezeichnung,
          lagerplatz:       artikel.lagerplatz,
          aktuellerBestand: artikel.bestand,
          neuerBestand:     artikel.bestand + item.menge,
        };
      }

      // Komplett neu
      return {
        teiltyp:          item.teiltyp,
        menge:            item.menge,
        grading:          item.grading,
        istNeu:           true,
        artikelId:        null,
        artikelName:      item.teiltyp,
        lagerplatz:       null,
        aktuellerBestand: 0,
        neuerBestand:     item.menge,
      };
    }),
  );
}

// ── Execute ───────────────────────────────────────────────────────────────────

export type ExecuteItem = {
  teiltyp:     string;
  menge:       number;
  grading:     string;
  notiz?:      string;
  lagerplatz?: string;
};

export type ExecuteInput = {
  geraetName:  string;
  logId?:      string;
  mitarbeiter: string;
  items:       ExecuteItem[];
};

export type ExecuteResult = {
  teiltyp:      string;
  artikelId:    number;
  artikelName:  string;
  kategorie:    string;
  lagerplatz:   string | null;
  menge:        number;
  buchungId:    number;
  belegNr:      string;
  neuerBestand: number;
  grading:      string;
  notizText:    string | undefined;
  istNeu:       boolean;
};

export async function execute(input: ExecuteInput): Promise<ExecuteResult[]> {
  const results: ExecuteResult[] = [];

  for (const item of input.items) {
    let istNeu = false;

    // 1. Artikel über Kompatibilitaet für exakt dieses Gerät finden
    let artikel = await prisma.artikel.findFirst({
      where: { kompatibel: { some: { geraet: input.geraetName, teiltyp: item.teiltyp } } },
    });

    // 2. Vorhandenen Artikel gleicher Kategorie wiederverwenden
    if (!artikel) {
      artikel = await prisma.artikel.findFirst({
        where:   { kategorie: item.teiltyp },
        orderBy: { bestand: "desc" },
      });
    }

    // 3. Neuen Artikel anlegen (Bezeichnung = Teiltyp, Kategorie = Teiltyp)
    //    Kategorie = Teiltyp ist entscheidend für autoVerknuepfung() im Kompatibilitaet-Service!
    if (!artikel) {
      istNeu  = true;
      // upsert statt create um Race-Conditions zu vermeiden
      const existing = await prisma.artikel.findUnique({
        where: { bezeichnung_kategorie: { bezeichnung: item.teiltyp, kategorie: item.teiltyp } },
      });
      if (existing) {
        artikel = existing;
        if (item.lagerplatz && !existing.lagerplatz) {
          artikel = await prisma.artikel.update({
            where: { id: existing.id },
            data:  { lagerplatz: item.lagerplatz },
          });
        }
      } else {
        artikel = await prisma.artikel.create({
          data: {
            bezeichnung: item.teiltyp,
            kategorie:   item.teiltyp,
            bestand:     0,
            lagerplatz:  item.lagerplatz ?? null,
          },
        });
      }
    } else if (item.lagerplatz && !artikel.lagerplatz) {
      artikel = await prisma.artikel.update({
        where: { id: artikel.id },
        data:  { lagerplatz: item.lagerplatz },
      });
    }

    // 4. EINGANG-Buchung erstellen
    const neuerBestand = artikel.bestand + item.menge;
    const notiz = [
      `Grading: ${item.grading}`,
      `Gerät: ${input.geraetName}`,
      item.notiz,
    ].filter(Boolean).join(" | ");

    const buchung = await bucheLager({
      artikelId:   artikel.id,
      menge:       item.menge,
      typ:         BuchungsTyp.EINGANG,
      mitarbeiter: input.mitarbeiter,
      notiz,
    });

    // 5. Beleg-Nummer generieren
    const belegNr = await naechsteBelegNr("EL");

    // 6. Kompatibilitaet anlegen/aktualisieren — für Techniker-Portal-Suchbarkeit!
    //    @@unique([geraet, teiltyp]) → upsert ist sicher
    await prisma.kompatibilitaet.upsert({
      where:  { geraet_teiltyp: { geraet: input.geraetName, teiltyp: item.teiltyp } },
      create: { geraet: input.geraetName, teiltyp: item.teiltyp, artikelId: artikel.id },
      update: {}, // bestehende Verknüpfung nicht überschreiben
    });

    results.push({
      teiltyp:      item.teiltyp,
      artikelId:    artikel.id,
      artikelName:  artikel.bezeichnung,
      kategorie:    artikel.kategorie,
      lagerplatz:   artikel.lagerplatz,
      menge:        item.menge,
      buchungId:    buchung.id,
      belegNr,
      neuerBestand,
      grading:      item.grading,
      notizText:    item.notiz,
      istNeu,
    });
  }

  return results;
}

// ── Lagerplatz-Vorschlag ──────────────────────────────────────────────────────

export async function lagerplatzVorschlag(kategorie: string): Promise<string | null> {
  // Gleichartige Teile mit vorhandenem Lagerplatz finden
  const gleiche = await prisma.artikel.findMany({
    where:  { kategorie, lagerplatz: { not: null } },
    select: { lagerplatz: true },
    take:   50,
  });

  const plaetze = gleiche.map((a) => a.lagerplatz!).filter(Boolean);

  if (plaetze.length > 0) {
    // Häufigsten Bereichs-Prefix finden (z.B. "L-1-2" aus "L-1-2-3")
    const counts = new Map<string, number>();
    for (const p of plaetze) {
      const parts = p.split("-");
      if (parts.length >= 3) {
        const prefix = parts.slice(0, 3).join("-");
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      }
    }

    let bestPrefix = "";
    let bestCount  = 0;
    for (const [prefix, count] of counts) {
      if (count > bestCount) { bestCount = count; bestPrefix = prefix; }
    }

    if (bestPrefix) {
      const inArea = await prisma.artikel.findMany({
        where:  { lagerplatz: { startsWith: bestPrefix + "-" } },
        select: { lagerplatz: true },
      });
      const usedNums = new Set(
        inArea
          .map((a) => parseInt(a.lagerplatz!.split("-").pop() ?? "0"))
          .filter((n) => !isNaN(n) && n > 0),
      );
      for (let i = 1; i <= 99; i++) {
        if (!usedNums.has(i)) return `${bestPrefix}-${i}`;
      }
    }
  }

  // Kein Gleiches → nächsten freien L-Slot im System vorschlagen
  const allPlaetze = await prisma.artikel.findMany({
    where:  { lagerplatz: { not: null } },
    select: { lagerplatz: true },
    take:   500,
  });
  const usedAll = new Set(allPlaetze.map((a) => a.lagerplatz!));

  for (let r = 1; r <= 9; r++) {
    for (let f = 1; f <= 9; f++) {
      const code = `L-1-${r}-${f}`;
      if (!usedAll.has(code)) return code;
    }
  }

  return null;
}

// Multi-Vorschlag für mehrere Kategorien auf einmal
export async function lagerplatzVorschlaegeMulti(
  kategorien: string[],
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    kategorien.map(async (k) => [k, await lagerplatzVorschlag(k)] as const),
  );
  return Object.fromEntries(entries);
}

// Hilfsfunktion: Icon für teiltyp aus STANDARD_TEILE
export function getTeilIcon(teiltyp: string): string {
  return STANDARD_TEILE.find((t) => t.id === teiltyp)?.icon ?? "🔧";
}
