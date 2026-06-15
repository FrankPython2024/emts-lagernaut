"use client";
import { GeraetModalProvider } from "./_geraetModal";

// Layout der Geräte-Reise: stellt das Detail-Popup modulweit bereit, damit ein
// Klick auf eine LogID (egal von welcher Seite) als Overlay öffnet und die
// aktuelle Liste erhalten bleibt.
export default function GeraeteReiseLayout({ children }: { children: React.ReactNode }) {
  return <GeraetModalProvider>{children}</GeraetModalProvider>;
}
