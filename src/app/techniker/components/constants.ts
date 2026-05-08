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
  NEU:           { bg: "#dbeafe", color: "#1d4ed8", label: "NEU" },
  BEDARF:        { bg: "#ede9fe", color: "#7c3aed", label: "BEDARF" },
  ABGESCHLOSSEN: { bg: "#dcfce7", color: "#15803d", label: "ERLEDIGT ✅" },
  STORNIERT:     { bg: "#f3f4f6", color: "#9ca3af", label: "STORNIERT" },
};

export type AnfrageRow = {
  id:          number;
  techniker:   string;
  logId:       string;
  geraet:      string;
  geraeteName: string | null;
  teil:        string;
  status:      string;
  datum:       Date;
  grading?:    string | null;
  kommentar?:  string | null;
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
};
