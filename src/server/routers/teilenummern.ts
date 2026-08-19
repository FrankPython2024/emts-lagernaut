import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import {
  schlageNach, liste, aktualisiere, setzeModelle, ordneNamenZu, istPlausibel, normalisiere,
} from "@/modules/teilenummern/service";
import { schlageAutomatischNach } from "@/modules/teilenummern/nachschlag";
import { istEingerichtet, verbrauchHeute } from "@/lib/suche/google";

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

  sucheStatus: pflegen.query(async () => ({
    eingerichtet: istEingerichtet(),
    verbraucht:   await verbrauchHeute(),
    tageslimit:   90,
  })),
});
