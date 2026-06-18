// Zentrale Bereinigung der Freitext-Felder einer Pickup-Position.
// Wird von BEIDEN Insert-Wegen genutzt (Anlege-Import `erstellen` UND
// CSV-Merge `auftragAktualisieren`), damit eine einzelne überlange CSV-Zelle
// NIE den ganzen `createMany`-Batch killt ("value too long for column").
//
// Spaltenlimits (prisma/schema.prisma → PickupPosition):
//   • colli / stellplatz : unannotiert → VARCHAR(191) (Prisma-MySQL-Default)
//   • bezeichnung        : @db.Text — AfB-Bezeichnungen gehen auf 514+ Zeichen

// VARCHAR(191) — Prisma-Default für unannotierte String-Spalten auf MySQL.
const VARCHAR_LIMIT = 191;
// bezeichnung ist @db.Text (für unsere Daten praktisch unbegrenzt). Die harte
// Obergrenze ist nur ein Schutz gegen absurd große CSV-Zellen.
const TEXT_SOFT_LIMIT = 2000;

// Trimmen, leere Strings zu null, und auf das Spaltenlimit kappen.
function cap(v: string | null | undefined, max: number): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

export type RohePosition = {
  colli?:       string | null;
  stellplatz?:  string | null;
  bezeichnung?: string | null;
};

export type PickupPositionFelder = {
  colli:       string | null;
  stellplatz:  string | null;
  bezeichnung: string | null;
};

// Freitext-Felder einer Position bereinigen + sicher auf das jeweilige
// Spaltenlimit kappen.
export function bereinigePositionsFelder(p: RohePosition): PickupPositionFelder {
  return {
    colli:       cap(p.colli,       VARCHAR_LIMIT),
    stellplatz:  cap(p.stellplatz,  VARCHAR_LIMIT),
    bezeichnung: cap(p.bezeichnung, TEXT_SOFT_LIMIT),
  };
}
