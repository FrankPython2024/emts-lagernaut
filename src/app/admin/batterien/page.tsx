"use client";
import { EntsorgungUebersicht } from "@/app/admin/_entsorgung/Uebersicht";
import { BEREICHE } from "@/lib/entsorgung/bereiche";

export default function Seite() {
  return <EntsorgungUebersicht bereich={BEREICHE.BATTERIE} />;
}
