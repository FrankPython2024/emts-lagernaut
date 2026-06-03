"use client";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTestModus, setzeTestModus, darfTestModus } from "@/lib/testModus/testModus";

/**
 * Sidebar-Toggle „🧪 Test-Modus" (Admin-Fußzeile).
 *
 * Sichtbar nur für ADMIN und ADMIN_READONLY. Klick aktiviert den Test-Modus und
 * springt direkt ins Techniker-Portal; erneuter Klick deaktiviert ihn wieder.
 */
export function TestModusToggle() {
  const router            = useRouter();
  const { data: session } = useSession();
  const rolle             = (session?.user as { rolle?: string } | undefined)?.rolle;
  const aktiv             = useTestModus();

  if (!darfTestModus(rolle)) return null;

  function toggle() {
    const next = !aktiv;
    setzeTestModus(next);
    if (next) router.push("/techniker");
  }

  return (
    <button
      onClick={toggle}
      title={aktiv ? "Test-Modus aktiv — klicken zum Beenden" : "Test-Modus starten (öffnet das Techniker-Portal)"}
      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-colors min-h-[44px] ${
        aktiv
          ? "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 font-semibold"
          : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
      }`}
    >
      <span className="w-5 text-center text-base" style={{ filter: aktiv ? "none" : "grayscale(1)", opacity: aktiv ? 1 : 0.6 }}>
        🧪
      </span>
      <span className="flex-1 text-left">Test-Modus</span>
      <span
        className={`flex-shrink-0 text-[11px] font-bold leading-none rounded-full px-2 py-1 ${
          aktiv ? "bg-amber-500 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
        }`}
      >
        {aktiv ? "An" : "Aus"}
      </span>
    </button>
  );
}
