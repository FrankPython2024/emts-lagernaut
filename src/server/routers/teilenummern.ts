import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import {
  schlageNach, liste, aktualisiere, setzeModelle, ordneNamenZu, istPlausibel, normalisiere,
} from "@/modules/teilenummern/service";
import { schlageAutomatischNach, sucheModelleZuNummer } from "@/modules/teilenummern/nachschlag";
import { platzVorschlaege } from "@/modules/teilenummern/lagerplatz";
import { resolveStandortId } from "@/lib/auth/standortFilter";
import { erkenneTeil } from "@/modules/teilenummern/bilderkennung";
import { istEingerichtet as kiEingerichtet } from "@/lib/ki/gemini";
import { leseNummern, istEingerichtet as ocrEingerichtet } from "@/lib/ocr/tesseract";
import { istEingerichtet, verbrauchHeute, tageslimit, aktiveQuelle } from "@/lib/suche";

// ── Teilenummern ─────────────────────────────────────────────────────────────
// Lesen darf, wer Artikel sehen darf; pflegen, wer Artikel bearbeiten darf.
// Nachschlagen beim Scannen hängt am Einlager-Recht — das ist die Person an
// der Werkbank. Bewusst KEIN neues Recht, damit kein seed-rbac nötig wird.
const lesen    = permissionProcedure("ARTIKEL_VIEW");
const pflegen  = permissionProcedure("ARTIKEL_EDIT");
const scannen  = permissionProcedure("ARTIKEL_EINLAGERN");

export const teilenummernRouter = createTRPCRouter({

  // Scanfeld: sofort zeigen, ob die Nummer bekannt ist. Legt nichts an.
  nachschlagen: scannen
    .input(z.object({ nummer: z.string().min(1).max(120) }))
    .query(async ({ input }) => {
      const normal = normalisiere(input.nummer);
      return {
        normal,
        plausibel: istPlausibel(input.nummer),
        treffer:   await schlageNach(input.nummer),
      };
    }),

  liste: lesen
    .input(z.object({
      nurOffen: z.boolean().optional(),
      suche:    z.string().max(120).optional(),
      limit:    z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(({ input }) => liste(input ?? {})),

  aktualisieren: pflegen
    .input(z.object({
      id:              z.number().int().positive(),
      nummer:          z.string().min(3).max(120).optional(),
      hersteller:      z.string().max(100).nullish(),
      teiltyp:         z.string().max(100).nullish(),
      notiz:           z.string().max(500).nullish(),
      istSeriennummer: z.boolean().optional(),
      geprueft:        z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...rest } = input;
      return aktualisiere(id, rest);
    }),

  setzeModelle: pflegen
    .input(z.object({
      id:        z.number().int().positive(),
      modellIds: z.array(z.number().int().positive()).max(500),
    }))
    .mutation(({ input }) => setzeModelle(input.id, input.modellIds)),

  // „Liste aus dem Netz einfügen": Modellnamen als Freitext, eine Zeile je
  // Modell. Was nicht in GeraeteModell existiert, wird zurückgemeldet statt
  // still verschluckt — sonst glaubt man, es seien mehr Modelle zugeordnet.
  ordneNamenZu: pflegen
    .input(z.object({
      id:    z.number().int().positive(),
      namen: z.array(z.string().max(200)).max(500),
    }))
    .mutation(({ input }) => ordneNamenZu(input.id, input.namen)),

  // ── Automatisches Nachschlagen ──────────────────────────────────────────
  // Sucht Fundstellen zur Nummer und gleicht sie gegen die EIGENE
  // Modelltabelle ab. Schreibt nichts — die Uebernahme laeuft ueber
  // setzeModelle, also erst nach Bestaetigung durch einen Menschen.
  //
  // Bewusst eine Mutation, obwohl nur gelesen wird: Der Aufruf verbraucht
  // Tageskontingent und darf deshalb nicht von React automatisch wiederholt
  // werden, wie es bei einer Query passieren wuerde.
  automatischSuchen: pflegen
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => schlageAutomatischNach(input.id)),

  // ── Foto-Erkennung ──────────────────────────────────────────────────────
  // Haengt am Einlager-Recht: Das ist die Person an der Werkbank, die das Teil
  // in der Hand haelt. Schreibt nichts — liefert nur einen Vorschlag.
  erkenneFoto: scannen
    .input(z.object({
      uebersicht:  z.object({
        base64:   z.string().min(100).max(8_000_000),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      }),
      ausschnitte: z.array(z.object({
        base64:   z.string().min(100).max(8_000_000),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      })).max(3).optional(),
    }))
    .mutation(({ input }) => erkenneTeil(input)),

  kiStatus: scannen.query(async () => ({
    eingerichtet: kiEingerichtet(),
    ocr:          await ocrEingerichtet(),
  })),

  /**
   * Etikett lesen — ohne fremdes Kontingent.
   *
   * Läuft VOR der Bilderkennung und in aller Regel statt ihrer: Gedruckte
   * Etiketten liest Tesseract im eigenen Container in etwa einer Sekunde.
   * Siebdruck auf Platinen liest er nicht — dafür gibt es den Knopf zur
   * Bilderkennung, den ein Mensch drückt, wenn keine Nummer passt.
   *
   * ⚠️ Bewusst KEINE Automatik, die selbst auf Gemini umschaltet. Beim
   * Messen lieferte das USB-Board „2S01L“ — Lesemüll, der echt aussieht. Eine
   * Regel „irgendetwas gefunden, also fertig“ hätte genau dort den Rückfall
   * unterdrückt. Der Mensch hält das Teil in der Hand und sieht das Etikett;
   * er entscheidet das in einer Sekunde.
   */
  leseFoto: scannen
    .input(z.object({
      uebersicht:  z.object({
        base64:   z.string().min(100).max(8_000_000),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      }),
      ausschnitte: z.array(z.object({
        base64:   z.string().min(100).max(8_000_000),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      })).max(3).optional(),
    }))
    .mutation(async ({ input }) => {
      const bilder = [input.uebersicht, ...(input.ausschnitte ?? [])].slice(0, 4);
      const gelesen = await leseNummern(bilder);

      // Kennen wir eine der Nummern schon? Gleichzeitig prüfen, Reihenfolge
      // bleibt gewahrt — es gewinnt die erste Nummer der Liste mit Treffer.
      const treffer = await Promise.all(gelesen.nummern.map((n) => schlageNach(n)));
      const erster  = treffer.find(Boolean);

      return {
        nummern: gelesen.nummern,
        dauerMs: gelesen.dauerMs,
        bekannt: erster
          ? {
              nummer:     erster.nummer,
              teiltyp:    erster.teiltyp,
              hersteller: erster.hersteller,
              modelle:    erster.modelle.length,
            }
          : null,
      };
    }),

  /**
   * Der Schritt nach der Foto-Erkennung: Zu einer gelesenen Nummer heraus-
   * finden, in welche Geräte das Teil passt — und wo es hingehört.
   *
   * ⚠️ Hier liegt der Kern des Ablaufs. Die Geräteliste kommt NICHT aus dem
   * Bildmodell (ein Foto einer nackten Platine enthält diese Angabe nicht),
   * sondern aus der Suche nach der aufgedruckten Nummer, mit Fundstellen zum
   * Nachlesen. Belegbar statt geraten.
   */
  zuNummer: scannen
    .input(z.object({
      nummer:     z.string().min(4).max(120),
      teiltyp:    z.string().max(100).optional(),
      standortId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const vorhanden = await schlageNach(input.nummer);
      const bekannt = vorhanden?.modelle.map((m) => m.modellId) ?? [];

      const fund = await sucheModelleZuNummer(input.nummer, bekannt);

      // Bestätigte Modelle der Nummer immer mitnehmen: Was ein Mensch schon
      // freigegeben hat, ist verlässlicher als jeder frische Fund.
      const gesichert = (vorhanden?.modelle ?? [])
        .filter((m) => m.bestaetigt)
        .map((m) => `${m.hersteller} ${m.modell}`.trim());

      const geraete = Array.from(new Set([
        ...gesichert,
        ...fund.vorschlaege.map((v) => v.name),
      ]));

      // ⚠️ Ids MITGEBEN, nicht nur Namen. Die Fachbelegung hängt an
      // `modellId`; über den Namen allein ist sie nicht auffindbar — genau
      // deshalb blieb sie bis 21.08.2026 ungenutzt.
      const modellIds = Array.from(new Set([
        ...fund.vorschlaege.map((v) => v.modellId),
        ...bekannt,
      ]));

      const plaetze = input.teiltyp
        ? await platzVorschlaege({
            teilenummerId: vorhanden?.id ?? null,
            teiltyp:       input.teiltyp,
            geraete,
            modellIds,
            standortId:    resolveStandortId(ctx, input.standortId),
          })
        : [];

      return {
        bekannt:   vorhanden ? { id: vorhanden.id, nummer: vorhanden.nummer, gesichert } : null,
        fund,
        plaetze,
      };
    }),

  sucheStatus: pflegen.query(async () => ({
    eingerichtet: istEingerichtet(),
    quelle:       aktiveQuelle(),
    verbraucht:   await verbrauchHeute(),
    tageslimit:   tageslimit(),
  })),
});
