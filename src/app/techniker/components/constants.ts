export const TEIL_ICONS: Record<string, string> = {
  Displaymodul:    "🖥️",
  Tastatur:        "⌨️",
  Touchpad:        "🖱️",
  "Füße vorne":   "🦶",
  "Füße hinten":  "🦶",
  "D Cover":       "🔲",
  "USB Board":     "🔌",
  "Power Button":  "⏻",
  Lautsprecher:    "🔊",
  Lüfter:          "💨",
  Thermalmodul:    "🌡️",
  "BIOS Batterie": "🔋",
  Akku:            "🔋",
};

export const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  NEU:              { bg: "#dbeafe", color: "#1d4ed8", label: "NEU" },
  BEDARF:           { bg: "#fef3c7", color: "#92400e", label: "Bedarf" },
  IN_BEARBEITUNG:   { bg: "#fef3c7", color: "#92400e", label: "IN BEARBEITUNG 🔧" },
  ABGESCHLOSSEN:    { bg: "#dcfce7", color: "#15803d", label: "ERLEDIGT ✅" },
  STORNIERT:        { bg: "#fee2e2", color: "#b91c1c", label: "STORNIERT" },
  NICHT_VERFUEGBAR: { bg: "#ffedd5", color: "#c2410c", label: "NICHT VERFÜGBAR ⚠️" },
};

export type AnfrageRow = {
  id:               number;
  techniker:        string;
  logId:            string;
  geraet:           string;
  geraeteName:      string | null;
  teil:             string;
  // Stückzahl der Anfrage — nur bei den Füßen > 1 (max 2), sonst 1.
  menge?:           number;
  status:           string;
  datum:            Date;
  grading?:         string | null;
  kommentar?:       string | null;
  bearbeitetVon?:   string | null;
  bearbeitetSeit?:  Date | null;
  istSonderAnfrage?: boolean;
  beschreibung?:    string | null;
  sonderKategorie?: string | null;
};

export type GruppeData = {
  key:         string;
  logId:       string | null;
  gruppenNr:   string | null;
  geraeteName: string | null;
  datum:       Date;
  anfragen:    AnfrageRow[];
};

export type StornoPayload = {
  id:        number;
  teil:      string;
  techniker: string;
  logId:     string;
  status:    string; // für den Hinweis „wird schon bearbeitet" im Storno-Dialog
};
