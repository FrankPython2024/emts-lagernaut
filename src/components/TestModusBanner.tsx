"use client";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTestModus, setzeTestModus, darfTestModus } from "@/lib/testModus/testModus";

/**
 * Oranger Test-Modus-Banner im Techniker-Portal.
 *
 * Nur sichtbar wenn Test-Modus aktiv UND der angemeldete User ein Admin
 * (ADMIN / ADMIN_READONLY) ist. „Zurück zum Admin" beendet den Test-Modus und
 * springt zurück ins Dashboard.
 */
export function TestModusBanner() {
  const router            = useRouter();
  const { data: session } = useSession();
  const rolle             = (session?.user as { rolle?: string } | undefined)?.rolle;
  const aktiv             = useTestModus();

  if (!aktiv || !darfTestModus(rolle)) return null;

  function zurueck() {
    setzeTestModus(false);
    router.push("/admin");
  }

  return (
    <div
      role="status"
      style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        flexWrap:       "wrap",
        gap:            "0.75rem",
        padding:        "0.6rem 1rem",
        background:     "linear-gradient(90deg, #f59e0b 0%, #f97316 100%)",
        color:          "#fff",
        fontFamily:     "'Ubuntu', sans-serif",
        fontWeight:     700,
        fontSize:       "0.92rem",
        boxShadow:      "0 2px 6px rgba(0,0,0,0.15)",
        position:       "sticky",
        top:            0,
        zIndex:         1100,
      }}
    >
      <span>🧪 TEST-MODUS · Anfragen zählen nicht in Statistik</span>
      <button
        onClick={zurueck}
        style={{
          background:   "rgba(255,255,255,0.95)",
          color:        "#b45309",
          border:       "none",
          borderRadius: 8,
          padding:      "0.35rem 0.9rem",
          fontWeight:   800,
          fontSize:     "0.85rem",
          cursor:       "pointer",
          fontFamily:   "'Ubuntu', sans-serif",
          whiteSpace:   "nowrap",
        }}
      >
        ← Zurück zum Admin
      </button>
    </div>
  );
}
