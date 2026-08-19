import { z } from "zod";
import { createTRPCRouter, permissionProcedure } from "@/server/trpc";
import type { SessionUser } from "@/core/types";
import {
  speichereFoto, listeFotos, loescheFoto, loescheAlle, ablageOrt,
} from "@/modules/kameratest/service";

// ── Testfotos für die Teile-Erkennung ────────────────────────────────────────
// Hängt am Einlager-Recht: Wer einlagert, ist die Person, die auch fotografiert.
// Kein eigenes Recht, damit für eine Messreihe kein seed-rbac nötig wird.
const erfassen = permissionProcedure("ARTIKEL_EINLAGERN");

const messungSchema = z.object({
  breite:       z.number().int().positive().optional(),
  hoehe:        z.number().int().positive().optional(),
  schaerfe:     z.number().optional(),
  helligkeit:   z.number().optional(),
  ueberstrahlt: z.number().optional(),
  quelle:       z.string().max(40).optional(),
}).optional();

export const kameratestRouter = createTRPCRouter({

  liste: erfassen.query(async () => ({
    fotos: await listeFotos(),
    ort:   ablageOrt(),
  })),

  speichern: erfassen
    .input(z.object({
      // 16 MB Rohtext ≈ 12 MB Bild; der Service prüft die echte Größe nochmal.
      base64:   z.string().min(100).max(16_000_000),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      notiz:    z.string().max(200).optional(),
      messung:  messungSchema,
    }))
    .mutation(({ ctx, input }) => {
      const user = ctx.session!.user as SessionUser;
      return speichereFoto({
        base64:   input.base64,
        mimeType: input.mimeType,
        notiz:    input.notiz,
        benutzer: user.kuerzel || user.name || null,
        messung:  input.messung ?? null,
      });
    }),

  loeschen: erfassen
    .input(z.object({ name: z.string().max(120) }))
    .mutation(async ({ input }) => { await loescheFoto(input.name); return { ok: true }; }),

  alleLoeschen: erfassen.mutation(() => loescheAlle()),
});
