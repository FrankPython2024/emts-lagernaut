import * as Icons from "lucide-react";
import { Box, type LucideIcon } from "lucide-react";

/**
 * Lookup-Helper: Icon-Name (z.B. "Wifi", "Battery") → LucideIcon-Komponente.
 * Fallback auf Box wenn Name nicht gefunden — kein Crash bei unbekanntem String.
 */
export function getLucideIcon(name?: string | null): LucideIcon {
  if (!name) return Box;
  const Icon = (Icons as Record<string, unknown>)[name];
  return (typeof Icon === "function" || typeof Icon === "object" && Icon !== null
    ? Icon
    : Box) as LucideIcon;
}
