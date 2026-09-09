import type { KeyboardEvent } from "react";

/**
 * Props für eine anklickbare Tabellenzeile — auch ohne Maus bedienbar.
 *
 * ⚠️ Ein `onClick` auf `<tr>` allein ist für Tastatur und Screenreader nicht
 * vorhanden: Die Zeile lässt sich nicht anspringen, nicht auslösen und wird
 * nicht als bedienbar angesagt. In der Lagerfuchs-Liste war das der EINZIGE Weg
 * ins Gerätedetail — ohne Maus also gar keiner.
 *
 * Liefert deshalb zusätzlich `role`, `tabIndex` und einen Tastatur-Handler für
 * Enter und Leertaste (die beiden Tasten, die eine Schaltfläche auslösen).
 *
 * Verwendung:
 *
 *     <tr {...klickbareZeile(() => oeffne(g.logId))} className="cursor-pointer …">
 *
 * ⚠️ Enthält die Zeile eigene Schaltflächen, müssen diese `e.stopPropagation()`
 * aufrufen — sonst löst ein Klick darauf zusätzlich die Zeile aus. Das galt
 * schon vorher, ändert sich hier also nicht.
 */
export function klickbareZeile(onAktivieren: () => void) {
  return {
    role: "button",
    tabIndex: 0,
    onClick: onAktivieren,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      // Nur reagieren, wenn die Zeile SELBST den Fokus hat — sonst löst Enter
      // in einem Feld innerhalb der Zeile ungewollt die Zeile mit aus.
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onAktivieren();
      }
    },
  };
}
