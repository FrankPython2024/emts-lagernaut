// ── Modellbilder aus dem AfB-Shop holen ──────────────────────────────────────
//
// Der Shop führt genau die Geräte, die AfB aufbereitet, und zeigt je Modell
// eine Bildergalerie: vorn, hinten, links, rechts und die Anschlussseite.
// Drei EliteBooks 840 G5 mit unterschiedlicher Ausstattung verweisen dabei auf
// DIESELBEN Bilder — es sind Modellbilder, keine Fotos einzelner Geräte.
//
// Rechtlich unkritisch, weil es AfB-eigenes Material für AfB-interne Zwecke
// ist. Deshalb diese Quelle und ausdrücklich NICHT die Bildersuche.
//
// ⚠️ Ausgewertet wird der DATEINAME, nicht die Seitenstruktur. Der Shop läuft
// auf Shopware, dessen Markup sich mit jedem Update ändert. Die Bildadressen
// dagegen sehen so aus:
//   .../media/b9/5b/55/1686648690/hp-elitebook-840-g5-14inch-...-ports.jpg
//
// Daraus folgt der Filter, und er ist umsonst zu haben: Nur Bilder, deren
// Dateiname den Modellnamen enthält, werden genommen. Werbebanner wie
// „wirkungszahlen-notebook-2025.jpg", Prüfsiegel, Zahlungssymbole und Logos
// fallen damit von selbst durch — ohne dass irgendwo eine Ausschlussliste
// gepflegt werden muss, die irgendwann veraltet.

const BASIS = "https://www.afbshop.de";
const KOPF = {
  // Ehrlich benennen, wer da klopft. Ein Shop-Betreiber soll im Protokoll
  // sehen, dass das ein internes System ist und kein Fremder.
  "User-Agent": "EMTS-Lagernaut/1.0 (internes Werkzeug, AfB Soemmerda)",
};

/** Vergleichsform: klein, nur Buchstaben und Ziffern. */
function schluessel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Dateiname ohne Pfad, ohne Abfrageteil, ohne Endung. */
function dateiname(url: string): string {
  return url.split("/").pop()?.split("?")[0]?.replace(/\.[a-z0-9]+$/i, "") ?? "";
}

/**
 * Was zeigt das Bild? Steht am Ende des Dateinamens.
 * „…-notebook-back-right.jpg" → „back right"
 */
function deuteAnsicht(url: string, modellKey: string): string | null {
  const name = dateiname(url).toLowerCase();
  for (const wort of ["front-right", "front-left", "back-right", "back-left", "ports", "front", "back", "top", "side"]) {
    if (name.endsWith(wort)) return wort.replace("-", " ");
  }
  return modellKey ? null : null;
}

async function hole(url: string): Promise<string | null> {
  try {
    const antwort = await fetch(url, {
      headers: { ...KOPF, Accept: "text/html" },
      signal:  AbortSignal.timeout(12_000),
    });
    return antwort.ok ? await antwort.text() : null;
  } catch {
    return null;
  }
}

/** Alle Bildadressen aus einer Seite ziehen, ohne Vorschaubilder. */
function bilderAus(html: string): string[] {
  const roh = html.match(/https:\/\/www\.afbshop\.de\/media\/[^"'\s)\\]+?\.(?:jpg|jpeg|png|webp)/gi) ?? [];
  // Shopware legt neben dem Original verkleinerte Fassungen unter /thumbnail/
  // ab. Die wollen wir nicht — wir speichern das Bild einmal in guter Größe.
  const ohneMiniatur = roh.filter((u) => !u.includes("/thumbnail/"));
  // Nach Dateiname eindeutig machen: Dasselbe Bild taucht auf der Seite
  // mehrfach auf (Galerie, Vergrößerung, Vorschau).
  const gesehen = new Set<string>();
  const liste: string[] = [];
  for (const u of ohneMiniatur) {
    const n = dateiname(u);
    if (!n || gesehen.has(n)) continue;
    gesehen.add(n);
    liste.push(u.split("?")[0]!);
  }
  return liste;
}

export type ShopBild = {
  url:     string;
  ansicht: string | null;
};

/**
 * Bildergalerie zu einem Modellnamen suchen.
 *
 * Zwei Schritte: erst die Shop-Suche, um auf eine Produktseite zu kommen,
 * dann die Produktseite selbst — dort liegt die vollständige Galerie. Die
 * Suchergebnisliste zeigt nur je ein Vorschaubild.
 */
export async function sucheShopBilder(
  anzeige: string,
  modell?: string | null,
): Promise<ShopBild[]> {
  const voll = schluessel(anzeige);
  const nur  = modell ? schluessel(modell) : "";
  const passt = (name: string) =>
    (voll.length >= 6 && name.includes(voll)) || (nur.length >= 6 && name.includes(nur));

  const suchSeite = await hole(`${BASIS}/search?search=${encodeURIComponent(anzeige)}`);
  if (!suchSeite) return [];

  // ── Produktseite finden ────────────────────────────────────────────────
  // Produktadressen sehen aus wie /hp-elitebook-840-g5/de-33.310-a/ — der
  // Modellname steckt also schon im Pfad, und genau darauf prüfen wir.
  const links = suchSeite.match(/https:\/\/www\.afbshop\.de\/[a-z0-9-]+\/de-[\d.]+-[a-z]\//gi) ?? [];
  const produkt = links.find((l) => passt(schluessel(l.split("/")[3] ?? "")));

  // ── Bilder einsammeln ──────────────────────────────────────────────────
  // Ohne passende Produktseite bleibt die Suchergebnisseite als Rückfall;
  // dort steht wenigstens das Titelbild.
  const seite = produkt ? await hole(produkt) : null;
  const quelle = seite ?? suchSeite;

  const treffer = bilderAus(quelle).filter((u) => passt(schluessel(dateiname(u))));

  // Reihenfolge: erst die Frontansicht, danach der Rest wie gefunden.
  // Sie ist das, was man beim Öffnen sehen will.
  treffer.sort((a, b) => {
    const wert = (u: string) => (dateiname(u).toLowerCase().endsWith("front") ? 0 : 1);
    return wert(a) - wert(b);
  });

  // Mehr als acht Ansichten hat kein Notebook, und jedes Bild kostet Platz
  // in der Datenbank.
  return treffer.slice(0, 8).map((url) => ({ url, ansicht: deuteAnsicht(url, voll) }));
}

/** Bild herunterladen. Gibt Bytes und Typ zurück, oder null. */
export async function ladeBild(
  bildUrl: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const antwort = await fetch(bildUrl, { headers: KOPF, signal: AbortSignal.timeout(15_000) });
    if (!antwort.ok) return null;

    const typ = (antwort.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(typ)) return null;

    const bytes = Buffer.from(await antwort.arrayBuffer());
    // Ein Produktbild über 6 MB gibt es nicht; wäre eines dabei, stimmt etwas
    // nicht und es hat in der Datenbank nichts verloren.
    if (bytes.length === 0 || bytes.length > 6 * 1024 * 1024) return null;

    return { bytes, mimeType: typ };
  } catch {
    return null;
  }
}
