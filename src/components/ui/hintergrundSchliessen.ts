"use client";
import { useRef } from "react";

/**
 * Dialog per Klick auf den Hintergrund schließen — ohne beim Markieren zuzuklappen.
 *
 * ⚠️ Der naheliegende Weg `onClick={onClose}` am Hintergrund ist falsch, und der
 * Fehler fällt erst beim Arbeiten auf: Wer Text IM Dialog markiert und die Maus
 * dabei über den Rand hinauszieht, drückt innen und lässt draußen los. Der
 * Browser feuert `click` dann auf den gemeinsamen Elternteil — den Hintergrund.
 * Der Dialog schließt, die Eingaben sind weg. Ein `stopPropagation` am inneren
 * Kasten hilft nicht: Das Ziel des Klicks IST der Hintergrund, der innere Kasten
 * kommt im Ereignispfad gar nicht vor.
 *
 * Deshalb wird gemerkt, wo das Drücken begann. Geschlossen wird nur, wenn beides
 * — Drücken und Loslassen — auf dem Hintergrund selbst passiert ist.
 *
 * `onPointerDown` statt `onMouseDown`, damit Maus, Finger und Stift gleich
 * behandelt werden (Handheld im Lager).
 *
 * Verwendung am Hintergrund-Element:
 *
 *     const hintergrund = useHintergrundSchliessen(onClose);
 *     <div className="fixed inset-0 …" {...hintergrund}> … </div>
 *
 * Das `onClick={(e) => e.stopPropagation()}` am inneren Kasten kann bleiben oder
 * wegfallen — es ist mit dieser Prüfung wirkungslos, aber auch nicht schädlich.
 */
export function useHintergrundSchliessen(onClose: () => void) {
  const startAufHintergrund = useRef(false);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      startAufHintergrund.current = e.target === e.currentTarget;
    },
    onClick: (e: React.MouseEvent) => {
      if (startAufHintergrund.current && e.target === e.currentTarget) onClose();
      startAufHintergrund.current = false;
    },
  };
}
