"use client";

// ── Druckerstand über den Lagernaut-Server (3D-Druck Paket 3, Stufe 3) ───────
// Die Druckbrücke am Laptop beim Drucker meldet ihren Stand an den Server
// (src/modules/druck/bruecke.ts); jeder PC liest ihn von dort. Vorher fragte der
// Browser die Brücke direkt unter 127.0.0.1 — das ging nur am Laptop selbst.
//
// Nur die Druckerkarte fragt regelmäßig nach (`nachfragen`); Drucken-Knöpfe auf
// jeder Vorlagenkarte lesen denselben Zwischenspeicher mit, statt selbst alle
// 3 s eine Anfrage zu schicken.

import { api } from "@/trpc/react";

export function useDruckerStand({ nachfragen = false }: { nachfragen?: boolean } = {}) {
  return api.druck.druckerStand.useQuery(undefined, {
    refetchInterval: nachfragen ? 3000 : false,
    refetchIntervalInBackground: false,
    staleTime: nachfragen ? 0 : 10_000,
  });
}
