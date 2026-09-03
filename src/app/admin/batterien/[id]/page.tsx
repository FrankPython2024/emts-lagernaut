"use client";
import { useParams } from "next/navigation";
import { EntsorgungAuftragSeite } from "@/app/admin/_entsorgung/AuftragSeite";
import { BEREICHE } from "@/lib/entsorgung/bereiche";

export default function Seite() {
  const params = useParams<{ id: string }>();
  return <EntsorgungAuftragSeite bereich={BEREICHE.BATTERIE} auftragId={Number(params?.id)} />;
}
