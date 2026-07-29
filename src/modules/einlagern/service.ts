import { BuchungsTyp } from "@prisma/client";
import { TRPCError }           from "@trpc/server";
import { prisma }              from "@/core/db/prisma";
import { bucheLager }          from "@/modules/buchungen/service";
import { naechsteBelegNr }     from "@/core/infra/belegnr";
import { STANDARD_TEILE }      from "./constants";
import { VERSCHIEDENES_TEILTYP, verschiedenesKompatTeiltyp } from "@/lib/constants/teiltypen";
import { normalisiereHersteller } from "@/lib/geraete/herstellerFilter";
import { getOrCreateModell }   from "@/lib/geraete/getOrCreateModell";

/**
 * Effektiver teiltyp-Schlüssel für Bezeichnung + Kompatibilitaet.
 * Verschiedenes: pro Freitext eindeutig ("Verschiedenes — <Freitext>"),
 * damit unique(geraet, teiltyp) nicht kollidiert. Sonst: der Teiltyp selbst.
 * Wirft bei Verschiedenes ohne ausreichenden Freitext.
 */
function teiltypKeyFuer(teiltyp: string, verschiedenesText?: string): string {
  if (teiltyp !== VERSCHIEDENES_TEILTYP) return teiltyp;
  const freitext = (verschiedenesText ?? "").trim();
  if (freitext.length < 2) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Verschiedenes braucht einen Freitext (mind. 2 Zeichen)." });
  }
  return verschiedenesKompatTeiltyp(freitext);
}

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

// ── Modell schon im Regal? (rein lesende Früh-Prüfung für Step 1) ──────────────
// Bündelt nur vorhandene Bausteine: Name aus LogID/Eingabe → modellId via
// getOrCreateModell (allowCreate:false, legt NICHTS an, gleiche Hersteller-/Bereinigungs-
// Auflösung wie execute() → kein Fehlalarm "neu") → Fach über LagerplatzBelegung.
// Liefert zusätzlich den Standortnamen des Fachs, da das Fach an einem anderen Standort
// als dem aktuell gewählten liegen kann.
export type ModellImRegalResult = {
  bekannt:       boolean;          // Modell existiert als (aktives) GeraeteModell
  modellId:      number | null;
  imRegal:       boolean;          // Modell ist einem Fach zugewiesen
  fachCode?:     string;
  standortId?:   number;
  standortName?: string;
};

export async function modellImRegal(input: { logId?: string; geraetName?: string }): Promise<ModellImRegalResult> {
  // 1. Modellnamen ermitteln — direkt aus geraetName, sonst via LogID-Lookup (wie geraetSuchen).
  let name = (input.geraetName ?? "").trim();
  if (!name && input.logId) {
    const treffer = await geraetSuchen(input.logId);
    if (treffer.gefunden) name = treffer.name;
  }
  if (!name) return { bekannt: false, modellId: null, imRegal: false };

  // 2. modellId robust + KONSISTENT mit execute() auflösen — NICHTS anlegen.
  const herstellerRoh = name.split(" ")[0] ?? "";
  const hersteller    = normalisiereHersteller(herstellerRoh) ?? herstellerRoh;
  let modellId: number | null = null;
  if (hersteller) {
    const r = await getOrCreateModell(name, hersteller, { allowCreate: false, adminBestaetigt: false });
    if (r.modell) modellId = r.modell.id;
  }
  if (modellId == null) return { bekannt: false, modellId: null, imRegal: false };

  // 3. Fach über Belegung (lesend) inkl. Standortname des Fachs.
  const belegung = await prisma.lagerplatzBelegung.findUnique({
    where:   { modellId },
    include: { lagerplatz: { include: { standort: { select: { id: true, name: true } } } } },
  });
  if (!belegung) return { bekannt: true, modellId, imRegal: false };

  return {
    bekannt:      true,
    modellId,
    imRegal:      true,
    fachCode:     belegung.lagerplatz.code,
    standortId:   belegung.lagerplatz.standortId,
    standortName: belegung.lagerplatz.standort.name,
  };
}

// ── Preview ───────────────────────────────────────────────────────────────────

export type PreviewItem = { teiltyp: string; menge: number; grading: string; verschiedenesText?: string };

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

// standortId MUSS derselbe sein, mit dem execute() später bucht — sonst zeigt die
// Vorschau den Artikel/Bestand eines FREMDEN Standorts (vorher fest auf 1 verdrahtet)
// und widerspricht dem, was tatsächlich passiert.
export async function preview(items: PreviewItem[], geraetName: string, standortId = 1): Promise<PreviewResult[]> {
  return Promise.all(
    items.map(async (item): Promise<PreviewResult> => {
      // Verschiedenes: pro Freitext eindeutiger teiltyp-Schlüssel; Freitext wird
      // in die Bezeichnung gebacken. Kategorie bleibt "Verschiedenes".
      const teiltypKey = teiltypKeyFuer(item.teiltyp, item.verschiedenesText);

      // Artikel-Bezeichnung: EXAKT "<Gerät> <Teiltyp-Schlüssel>"
      const artikelBezeichnung = `${geraetName} ${teiltypKey}`;

      // 1. Exakter Kompatibilitaets-Treffer für dieses Gerät + Teiltyp
      //    (nur Artikel des Ziel-Standorts — sonst zeigt die Vorschau den Bestand
      //    eines anderen Standorts an, während execute() hier neu anlegt.)
      const komp = await prisma.kompatibilitaet.findFirst({
        where:   { geraet: geraetName, teiltyp: teiltypKey, artikel: { standortId } },
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
        where: { bezeichnung: artikelBezeichnung, kategorie: item.teiltyp, standortId },
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
  teiltyp:           string;
  menge:             number;
  grading:           string;
  notiz?:            string;
  lagerplatz?:       string;
  verschiedenesText?: string;
};

export type ExecuteInput = {
  geraetName:              string;
  logId?:                  string;
  mitarbeiter:             string;
  items:                   ExecuteItem[];
  gewaehlterLagerplatzId?: number;
  standortId?:             number;
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
  const sId     = input.standortId ?? 1;

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

  // Der Nutzer hat bewusst ein Fach gewaehlt — ohne aufgeloestes Modell kann aber
  // keine Belegung entstehen. Das darf NICHT still verschluckt werden (sonst denkt
  // er, der Platz sei vergeben). Steht VOR allen Buchungen → kein Teil-Zustand.
  if (input.gewaehlterLagerplatzId && !modellId) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: "Lagerplatz konnte nicht vergeben werden: Hersteller/Modell wurde nicht eindeutig erkannt. Bitte den Gerätenamen MIT Hersteller angeben (z. B. „HP EliteBook 840 G5“).",
    });
  }

  // Lagerplatz zuweisen — mehrere Modelle pro Fach (gleicher Hersteller, max 4).
  let etlLagerplatzCode: string | undefined;
  if (modellId) {
    const mId = modellId;

    // Modell bereits einem Fach zugewiesen? → behalten (kein Umzug ohne Umzug-Flow)
    const bestehende = await prisma.lagerplatzBelegung.findUnique({
      where:   { modellId: mId },
      include: { lagerplatz: { select: { code: true } } },
    });

    if (bestehende) {
      etlLagerplatzCode = bestehende.lagerplatz.code;
      console.log(`[Einlagern] Modell hat bereits Lagerplatz ${etlLagerplatzCode}`);
    } else if (input.gewaehlterLagerplatzId) {
      const platzId = input.gewaehlterLagerplatzId;
      // Transaktional: Kapazität + Hersteller-Reinheit prüfen, dann Belegung anlegen
      etlLagerplatzCode = await prisma.$transaction(async (tx) => {
        const platz = await tx.lagerplatz.findUnique({ where: { id: platzId } });
        if (!platz) return undefined;

        const belegt = await tx.lagerplatzBelegung.count({ where: { lagerplatzId: platzId } });
        if (belegt >= 4) {
          throw new TRPCError({ code: "CONFLICT", message: `Fach ${platz.code} ist voll (max 4 Modelle).` });
        }

        const erste = await tx.lagerplatzBelegung.findFirst({
          where:   { lagerplatzId: platzId },
          include: { modell: { select: { hersteller: true } } },
        });
        const fachHerst = erste?.modell.hersteller ?? null;
        if (fachHerst && hersteller !== fachHerst) {
          throw new TRPCError({
            code:    "BAD_REQUEST",
            message: `Fach ${platz.code} enthält ${fachHerst}-Modelle, ${hersteller} ist nicht erlaubt.`,
          });
        }

        await tx.lagerplatzBelegung.create({ data: { lagerplatzId: platzId, modellId: mId } });
        console.log(`[Einlagern] Lagerplatz ${platz.code} → Modell #${mId} (Fach ${belegt + 1}/4)`);
        return platz.code;
      });
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

    // Verschiedenes: pro Freitext eindeutiger teiltyp-Schlüssel; Freitext wird
    // in die Bezeichnung gebacken. Die Kategorie bleibt der Teiltyp selbst
    // ("Verschiedenes"), sodass mehrere Freitexte als eigene Artikel koexistieren.
    const teiltypKey = teiltypKeyFuer(item.teiltyp, item.verschiedenesText);
    const kategorie  = item.teiltyp;

    // Artikel-Bezeichnung: kanonische Form mit Prefix (= Artikel-Generator-Ausgabe)
    const artikelBezeichnung    = `${geraetVoll} ${teiltypKey}`;
    // Backward-Compat: alte Einträge ohne Prefix ("EliteBook 840 G5 Tastatur")
    const artikelBezeichnungAlt = geraetVoll !== sauberModellName
      ? `${sauberModellName} ${teiltypKey}`
      : null;
    console.log(`[Einlagern] Artikel: "${artikelBezeichnung}"`);

    // 1. Exakter Artikel via Kompatibilitaet (canonical + alt für Backward-Compat)
    let artikel = await prisma.artikel.findFirst({
      where: { kompatibel: { some: { geraet: { in: geraetNamen }, teiltyp: teiltypKey } } },
    });

    // 2. Artikel per kanonischer Bezeichnung — KEIN Kategorie-Fallback!
    if (!artikel) {
      artikel = await prisma.artikel.findFirst({
        where: { bezeichnung: artikelBezeichnung, kategorie, standortId: sId },
      });
    }

    // 2b. Backward-Compat: alte Bezeichnung mit Hersteller-Prefix
    if (!artikel && artikelBezeichnungAlt) {
      artikel = await prisma.artikel.findFirst({
        where: { bezeichnung: artikelBezeichnungAlt, kategorie, standortId: sId },
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
          kategorie,
          bestand:     0,
          lagerplatz:  lagerplatzFuerArtikel,
          standortId:  sId,
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
      // Herkunft festhalten: aus WELCHEM Spender-Altgerät stammt dieses Teil.
      // Die LogID wurde bisher nur ins Server-Log geschrieben und war danach weg.
      herkunftLogId: input.logId?.trim() || null,
    });

    // 5. Beleg-Nummer
    const belegNr = await naechsteBelegNr("EL");

    // 6. Kompatibilitaet: kanonische Form mit Prefix (= Artikel-Generator-Key).
    //    Verschiedenes nutzt den pro-Variante eindeutigen teiltypKey.
    await prisma.kompatibilitaet.upsert({
      where:  { geraet_teiltyp_artikelId: { geraet: geraetVoll, teiltyp: teiltypKey, artikelId: artikel.id } },
      create: { geraet: geraetVoll, teiltyp: teiltypKey, artikelId: artikel.id },
      update: {},
    });
    console.log(`[Einlagern] Verknüpft: "${geraetVoll}" + "${teiltypKey}" → Artikel #${artikel.id}`);

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

export async function lagerplatzVorschlag(kategorie: string, standortId?: number): Promise<string | null> {
  const sF = standortId != null ? { standortId } : {};
  // Gleichartige Teile mit vorhandenem Lagerplatz finden
  const gleiche = await prisma.artikel.findMany({
    where:  { ...sF, kategorie, lagerplatz: { not: null } },
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
  standortId?: number,
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    kategorien.map(async (k) => [k, await lagerplatzVorschlag(k, standortId)] as const),
  );
  return Object.fromEntries(entries);
}

// Hilfsfunktion: Icon für teiltyp aus STANDARD_TEILE
export function getTeilIcon(teiltyp: string): string {
  return STANDARD_TEILE.find((t) => t.id === teiltyp)?.icon ?? "🔧";
}
