/**
 * Gibt eine menschenlesbare relative Zeitangabe zurück.
 * Immer DE-Format, z.B. "vor 3 Min." oder "gerade eben".
 */
export function relTime(date: Date | string): string {
  const d       = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

  if (seconds < 60)      return "gerade eben";
  if (seconds < 3_600)   return `vor ${Math.floor(seconds / 60)} Min.`;
  if (seconds < 86_400)  return `vor ${Math.floor(seconds / 3_600)} Std.`;
  if (seconds < 604_800) return `vor ${Math.floor(seconds / 86_400)} Tag(en)`;
  return d.toLocaleDateString("de-DE");
}
