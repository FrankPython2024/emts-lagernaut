"use client";
import { GeraetModalProvider } from "./_geraetModal";
import { ColliModalProvider } from "./_colliModal";

// Layout der Geräte-Reise: stellt das LogID-Detail-Popup und das Colli-Popup
// modulweit bereit, damit ein Klick auf eine LogID oder eine Colli-Nummer (egal
// von welcher Seite) als Overlay öffnet und die aktuelle Liste erhalten bleibt.
// ColliModalProvider liegt INNERHALB des GeraetModalProvider, damit ein Klick auf
// ein Gerät im Colli-Popup das LogID-Popup darüber öffnen kann.
export default function GeraeteReiseLayout({ children }: { children: React.ReactNode }) {
  return (
    <GeraetModalProvider>
      <ColliModalProvider>{children}</ColliModalProvider>
    </GeraetModalProvider>
  );
}
