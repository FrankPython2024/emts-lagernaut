// ── Datenträger und Arbeitsspeicher: Merkmale und Bezeichnungs-Aufbau ────────
//
// Diese Teile sind NICHT gerätegebunden: Ein 512-GB-NVMe ist ein 512-GB-NVMe,
// egal aus welchem Notebook er stammt. Deshalb ergibt sich die Artikel-
// Bezeichnung aus festen Merkmalen statt aus einem Gerätenamen.
//
// ⚠️ Die Bezeichnung wird AUSSCHLIESSLICH hier gebaut. Würde sie an mehreren
// Stellen zusammengesetzt, entstünden Schreibvarianten desselben Artikels —
// genau der Fehler, der bei den Notebook-Teilen dazu geführt hat, dass ein
// einziges Touchpad 24-mal in der Datenbank steht.

export const KATEGORIE_DATENTRAEGER   = "Datenträger";
export const KATEGORIE_ARBEITSSPEICHER = "Arbeitsspeicher";

// ── Datenträger ──────────────────────────────────────────────────────────────

export const DT_ART = ["SSD", "HDD"] as const;

export const DT_GROESSE = [
  "128 GB", "256 GB", "512 GB", "1 TB", "2 TB", "4 TB",
] as const;

export const DT_SCHNITTSTELLE = [
  "SATA", "NVMe PCIe3", "NVMe PCIe4",
] as const;

// M.2-Längen in Standard-Schreibweise (22 mm breit, Zahl = Länge in mm).
export const DT_BAUFORM = [
  "M.2 2230", "M.2 2242", "M.2 2280", "2,5\"", "3,5\"",
] as const;

// ── Arbeitsspeicher ──────────────────────────────────────────────────────────

export const RAM_GROESSE = [
  "2 GB", "4 GB", "8 GB", "16 GB", "32 GB", "64 GB",
] as const;

export const RAM_GENERATION = ["DDR3", "DDR3L", "DDR4", "DDR5"] as const;

export const RAM_BAUFORM = ["SO-DIMM", "DIMM"] as const;

// ── Bezeichnungen ────────────────────────────────────────────────────────────

export type DatentraegerMerkmale = {
  art:           string;
  groesse:       string;
  schnittstelle: string;
  bauform:       string;
};

export type RamMerkmale = {
  groesse:    string;
  generation: string;
  bauform:    string;
};

/** z. B. „SSD 512 GB NVMe PCIe3 M.2 2280" */
export function bezeichnungDatentraeger(m: DatentraegerMerkmale): string {
  return [m.art, m.groesse, m.schnittstelle, m.bauform]
    .map((s) => s.trim()).filter(Boolean).join(" ");
}

/** z. B. „RAM 16 GB DDR4 SO-DIMM" */
export function bezeichnungRam(m: RamMerkmale): string {
  return ["RAM", m.groesse, m.generation, m.bauform]
    .map((s) => s.trim()).filter(Boolean).join(" ");
}
