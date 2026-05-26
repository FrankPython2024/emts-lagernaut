import { useEffect, useState } from "react";

/**
 * Debounce-Hook: liefert `value` erst zurück, wenn sich `delayMs` ms lang nichts mehr geändert hat.
 *
 * Schreibvorgang am Such-Input bleibt sofort sichtbar (state vom Caller),
 * abhängige Queries / Filter laufen aber nur einmal pro „Pause".
 */
export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handler);
  }, [value, delayMs]);

  return debounced;
}
