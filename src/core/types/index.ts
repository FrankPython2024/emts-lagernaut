import type {
  User,
  Artikel,
  Buchung,
  Anfrage,
  Kompatibilitaet,
  GeraeteModell,
  GeraeteLookup,
  Warenkorb,
  WarenkorbItem,
  TechnikerSession,
  UserRolle,
  BuchungsTyp,
  AnfrageStatus,
  KorbStatus,
} from "@prisma/client";

// Re-exports
export type {
  User,
  Artikel,
  Buchung,
  Anfrage,
  Kompatibilitaet,
  GeraeteModell,
  GeraeteLookup,
  Warenkorb,
  WarenkorbItem,
  TechnikerSession,
  UserRolle,
  BuchungsTyp,
  AnfrageStatus,
  KorbStatus,
};

// Artikel mit aktuellem Bestand-Status
export type ArtikelMitStatus = Artikel & {
  verfuegbar: boolean; // bestand > 0
};

// Anfrage mit Artikel-Info (für Listen)
export type AnfrageWithArtikel = Anfrage & {
  artikel: Pick<Artikel, "id" | "bezeichnung" | "kategorie">;
};

// Warenkorb mit Items und Artikel-Details
export type WarenkorbWithItems = Warenkorb & {
  items: (WarenkorbItem & {
    artikel: Pick<Artikel, "id" | "bezeichnung" | "kategorie" | "bestand">;
  })[];
};

// Session-Payload für NextAuth
export type SessionUser = {
  id: number;
  name: string;
  kuerzel: string;
  email: string;
  rolle: UserRolle;
};

// Buchungs-Abschluss für Label/Beleg
export type BuchungsAbschluss = {
  techniker: string;
  logId: string;
  datum: string;
  ersatzteil: string;
  geraet: string;
  lagerort: string;
};

// Suchergebnis aus Meilisearch / DB-Suche
export type SuchErgebnis = {
  id: number;
  bezeichnung: string;
  kategorie: string;
  bestand: number;
  kompatibel?: string[];
};
