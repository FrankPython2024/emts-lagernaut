"use client";
import { GeraetModalProvider, GeraetModalOverlay } from "./_geraetModal";
import { ColliModalProvider, ColliModalOverlay } from "./_colliModal";

// Layout der Geräte-Reise: stellt das LogID-Detail-Popup und das Colli-Popup
// modulweit bereit, damit ein Klick auf eine LogID oder eine Colli-Nummer (egal
// von welcher Seite) als Overlay öffnet und die aktuelle Liste erhalten bleibt.
//
// Beide Provider liefern nur Kontext/State. Beide Overlays werden GEMEINSAM am
// innersten Punkt gerendert — innerhalb beider Provider. So sieht das LogID-Modal
// useColliModal (klickbarer Colli) UND das Colli-Modal useGeraetModal (klickbares
// Gerät), ohne zirkuläre Provider-Schachtelung. Beide Overlays sind stapelbar.
export default function GeraeteReiseLayout({ children }: { children: React.ReactNode }) {
  return (
    <GeraetModalProvider>
      <ColliModalProvider>
        {children}
        <GeraetModalOverlay />
        <ColliModalOverlay />
      </ColliModalProvider>
    </GeraetModalProvider>
  );
}
