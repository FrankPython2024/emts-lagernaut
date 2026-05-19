import { BuchungsTyp } from "@prisma/client";
import { TRPCError }           from "@trpc/server";
import { prisma }              from "@/core/db/prisma";
import { bucheLager }          from "@/modules/buchungen/service";
import { naechsteBelegNr }     from "@/core/infra/belegnr";
import { STANDARD_TEILE }      from "./constants";
import { normalisiereHersteller } from "@/lib/geraete/herstellerFilter";
import { getOrCreateModell }   from "@/lib/geraete/getOrCreateModell";

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
      // Artikel-Bezeichnung: EXAKT "<Gerät> <Teiltyp>"
      const artikelBezeichnung = `${geraetName} ${item.teiltyp}`;

      // 1. Exakter Kompatibilitaets-Treffer für dieses Gerät + Teiltyp
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

      // 2. Exakter Artikel-Bezeichnungs-Lookup — KEIN Kategorie-Fallback!
      //    Verhindert Cross-Device-Zuordnung (z.B. T14-Tastatur zu HP 840 zuweisen)
      const artikel = await prisma.artikel.findFirst({
        where: { bezeichnung: artikelBezeichnung, kategorie: item.teiltyp, standortId: 1 }, // TODO Phase 2: aus User-Kontext (ctx.user.standortId ?? Filter)
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

      // 3. Komplett neu — geplante Bezeichnung zeigen damit Admin sieht was angelegt wird
      return {
        teiltyp:          item.teiltyp,
        menge:            item.menge,
        grading:          item.grading,
        istNeu:           true,
        artikelId:        null,
        artikelName:      artikelBezeichnung,
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
  geraetName:              string;
  logId?:                  string;
  mitarbeiter:             string;
  items:                   ExecuteItem[];
  gewaehlterLagerplatzId?: number;
};

export type ExecuteResult = {
  teiltyp:       string;
  artikelId:     number;
  artikelName:   string;
  kategorie:     string;
  lagerplatz:    string | null;
  etlLagerplatz?: string;
  menge:         number;
  buchungId:     number;
  belegNr:       string;
  neuerBestand:  number;
  grading:       string;
  notizText:     string | undefined;
  istNeu:        boolean;
};

export async function execute(input: ExecuteInput): Promise<ExecuteResult[]> {
  const results: ExecuteResult[] = [];

  console.log(`[Einlagern] Gerät: "${input.geraetName}"${input.logId ? ` (LogID: ${input.logId})` : ""}`);

  // Hersteller normalisieren (verhindert "EliteBook" als Hersteller bei "EliteBook 840 G5")
  const herstellerRoh = input.geraetName.split(" ")[0] ?? "";
  const hersteller    = normalisiereHersteller(herstellerRoh) ?? herstellerRoh;

  // GeraeteModell sicher suchen/anlegen + kanonischen Namen ermitteln
  let sauberModellName = input.geraetName;
  let modellId: number | null = null;
  if (hersteller) {
    const modellResult = await getOrCreateModell(input.geraetName, hersteller, {
      allowCreate:     true,
      adminBestaetigt: true,
    });
    if (modellResult.fehler) {
      console.warn(`[Einlagern] GeraeteModell abgelehnt: ${modellResult.fehler}`);
    } else if (modellResult.modell) {
      sauberModellName = modellResult.modell.modell;
      modellId = modellResult.modell.id;
    }
  }

  // Lagerplatz zuweisen (1 Modell = 1 Lagerplatz)
  let etlLagerplatzCode: string | undefined;
  if (modellId) {
    if (input.gewaehlterLagerplatzId) {
      const bestehender = await prisma.lagerplatz.findUnique({ where: { modellId } });

      if (bestehender) {
        if (bestehender.id === input.gewaehlterLagerplatzId) {
          etlLagerplatzCode = bestehender.code;
        } else {
          // Anderer Platz bereits zugewiesen → behalte ihn (kein Überschreiben ohne Umzug-Flow)
          etlLagerplatzCode = bestehender.code;
          console.log(`[Einlagern] Modell hat bereits Lagerplatz ${bestehender.code}`);
        }
      } else {
        const platz = await prisma.lagerplatz.findUnique({ where: { id: input.gewaehlterLagerplatzId } });
        if (platz?.modellId && platz.modellId !== modellId) {
          throw new TRPCError({ code: "CONFLICT", message: `Lagerplatz ${platz.code} ist bereits von einem anderen Modell belegt` });
        }
        if (platz) {
          await prisma.lagerplatz.update({ where: { id: platz.id }, data: { modellId } });
          etlLagerplatzCode = platz.code;
          console.log(`[Einlagern] Lagerplatz ${platz.code} → Modell #${modellId} zugewiesen`);
        }
      }
    } else {
      // Kein Platz gewählt — evtl. bereits zugewiesen aus früherer Einlagerung
      const bestehender = await prisma.lagerplatz.findUnique({ where: { modellId } });
      if (bestehender) etlLagerplatzCode = bestehender.code;
    }
  }

  // Kanonische Form MIT Hersteller-Prefix — identisch mit dem Artikel-Generator
  // (Generator speichert: `${bereinigt} ${teiltyp}` = "HP EliteBook 840 G5 Tastatur")
  // Vorher wurde hier sauberModellName (ohne Prefix) verwendet, was zu zwei verschiedenen
  // Kompatibilitaet.geraet-Strings führte und den Techniker-Lookup brach.
  const geraetVoll = (sauberModellName !== input.geraetName && hersteller)
    ? `${hersteller} ${sauberModellName}`.trim()
    : input.geraetName;

  // Rückwärts-Compat: alle Namensformen für die Artikel-Suche (bestehende DB-Einträge)
  const geraetNamen = [...new Set([geraetVoll, sauberModellName, input.geraetName])];

  for (const item of input.items) {
    let istNeu = false;

    // Artikel-Bezeichnung: kanonische Form mit Prefix (= Artikel-Generator-Ausgabe)
    const artikelBezeichnung    = `${geraetVoll} ${item.teiltyp}`;
    // Backward-Compat: alte Einträge ohne Prefix ("EliteBook 840 G5 Tastatur")
    const artikelBezeichnungAlt = geraetVoll !== sauberModellName
      ? `${sauberModellName} ${item.teiltyp}`
      : null;
    console.log(`[Einlagern] Artikel: "${artikelBezeichnung}"`);

    // 1. Exakter Artikel via Kompatibilitaet (canonical + alt für Backward-Compat)
    let artikel = await prisma.artikel.findFirst({
      where: { kompatibel: { some: { geraet: { in: geraetNamen }, teiltyp: item.teiltyp } } },
    });

    // 2. Artikel per kanonischer Bezeichnung — KEIN Kategorie-Fallback!
    if (!artikel) {
      artikel = await prisma.artikel.findFirst({
        where: { bezeichnung: artikelBezeichnung, kategorie: item.teiltyp, standortId: 1 }, // TODO Phase 2: aus User-Kontext (ctx.user.standortId ?? Filter)
      });
    }

    // 2b. Backward-Compat: alte Bezeichnung mit Hersteller-Prefix
    if (!artikel && artikelBezeichnungAlt) {
      artikel = await prisma.artikel.findFirst({
        where: { bezeichnung: artikelBezeichnungAlt, kategorie: item.teiltyp, standortId: 1 }, // TODO Phase 2: aus User-Kontext (ctx.user.standortId ?? Filter)
      });
    }

    // 3. Neuen geräte-spezifischen Artikel anlegen
    // ETL-Code hat Vorrang vor legacy item.lagerplatz
    const lagerplatzFuerArtikel = etlLagerplatzCode ?? item.lagerplatz ?? null;
    if (!artikel) {
      istNeu  = true;
      artikel = await prisma.artikel.create({
        data: {
          bezeichnung: artikelBezeichnung,
          kategorie:   item.teiltyp,
          bestand:     0,
          lagerplatz:  lagerplatzFuerArtikel,
        },
      });
      console.log(`[Einlagern] Neuer Artikel: "${artikelBezeichnung}" (ID: ${artikel.id})`);
    } else if (lagerplatzFuerArtikel && artikel.lagerplatz !== lagerplatzFuerArtikel) {
      // ETL-Code aktuell halten (auch wenn Artikel schon existiert)
      artikel = await prisma.artikel.update({
        where: { id: artikel.id },
        data:  { lagerplatz: lagerplatzFuerArtikel },
      });
    }

    // 4. EINGANG-Buchung
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

    // 5. Beleg-Nummer
    const belegNr = await naechsteBelegNr("EL");

    // 6. Kompatibilitaet: kanonische Form mit Prefix (= Artikel-Generator-Key)
    await prisma.kompatibilitaet.upsert({
      where:  { geraet_teiltyp: { geraet: geraetVoll, teiltyp: item.teiltyp } },
      create: { geraet: geraetVoll, teiltyp: item.teiltyp, artikelId: artikel.id },
      update: { artikelId: artikel.id },
    });
    console.log(`[Einlagern] Verknüpft: "${geraetVoll}" + "${item.teiltyp}" → Artikel #${artikel.id}`);

    results.push({
      teiltyp:       item.teiltyp,
      artikelId:     artikel.id,
      artikelName:   artikel.bezeichnung,
      kategorie:     artikel.kategorie,
      lagerplatz:    artikel.lagerplatz,
      etlLagerplatz: etlLagerplatzCode,
      menge:         item.menge,
      buchungId:     buchung.id,
      belegNr,
      neuerBestand,
      grading:       item.grading,
      notizText:     item.notiz,
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
