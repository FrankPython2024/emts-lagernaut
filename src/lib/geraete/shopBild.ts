// ── Modellbild aus dem AfB-Shop holen ────────────────────────────────────────
//
// Der Shop führt genau die Geräte, die AfB aufbereitet, und zeigt je Modell ein
// Produktbild. Drei EliteBooks 840 G5 mit unterschiedlicher Ausstattung
// verweisen dort auf DASSELBE Bild — es ist also ein Modellbild, kein Foto
// eines Einzelgeräts. Genau das brauchen wir.
//
// Rechtlich unkritisch, weil es AfB-eigenes Material für AfB-interne Zwecke
// ist. Deshalb diese Quelle und ausdrücklich NICHT die Bildersuche.
//
// ⚠️ Ausgewertet wird der DATEINAME des Bildes, nicht die Seitenstruktur.
// Der Shop läuft auf Shopware, und dessen Markup ändert sich mit jedem Update.
// Die Bildadresse dagegen sieht so aus:
//   .../media/b9/5b/55/1686648690/hp-elitebook-840-g5-14inch-...-front.jpg
// Der Modellname steckt also im Dateinamen. Das ist stabiler als jeder
// Auswahlpfad durch HTML und überlebt einen Shop-Umbau.

const BASIS = "https://www.afbshop.de";

/** Vergleichsform: klein, nur Buchstaben und Ziffern. */
function schluessel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type ShopTreffer = {
  bildUrl: string;
  /** Woran der Treffer festgemacht wurde — für die Nachvollziehbarkeit. */
  wie:     "dateiname" | "alttext";
};

/**
 * Bild zu einem Modellnamen suchen.
 *
 * `anzeige` ist der volle Name mit Hersteller, z. B. „HP EliteBook 840 G5".
 * `modell` ist derselbe ohne Hersteller — als zweite, schwächere Chance.
 */
export async function sucheShopBild(
  anzeige: string,
  modell?: string | null,
): Promise<ShopTreffer | null> {
  const url = `${BASIS}/search?search=${encodeURIComponent(anzeige)}`;

  let html: string;
  try {
    const antwort = await fetch(url, {
      headers: {
        // Ehrlich benennen, wer da klopft. Ein Shop-Betreiber soll in seinem
        // Log sehen können, dass das ein internes System ist und kein Fremder.
        "User-Agent": "EMTS-Lagernaut/1.0 (internes Werkzeug, AfB Soemmerda)",
        "Accept":     "text/html",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!antwort.ok) return null;
    html = await antwort.text();
  } catch {
    return null;
  }

  const voll = schluessel(anzeige);
  const nur  = modell ? schluessel(modell) : "";

  // ── Weg 1: über den Dateinamen ─────────────────────────────────────────
  const bilder = html.match(/https:\/\/www\.afbshop\.de\/media\/[^"'\s)]+?\.(?:jpg|jpeg|png|webp)/gi) ?? [];
  for (const kandidat of [voll, nur]) {
    if (kandidat.length < 6) continue;
    for (const bild of bilder) {
      const datei = schluessel(bild.split("/").pop()?.split("?")[0] ?? "");
      if (datei.includes(kandidat)) return { bildUrl: bild, wie: "dateiname" };
    }
  }

  // ── Weg 2: über den Alternativtext am Bild ─────────────────────────────
  // Greift, wenn der Shop das Bild anders benennt als das Produkt heißt.
  const mitAlt = html.matchAll(
    /<img[^>]+?(?:src|data-src)=["'](https:\/\/www\.afbshop\.de\/media\/[^"']+?)["'][^>]*?alt=["']([^"']*)["']/gi,
  );
  for (const treffer of mitAlt) {
    const bild = treffer[1]!, alt = schluessel(treffer[2] ?? "");
    for (const kandidat of [voll, nur]) {
      if (kandidat.length >= 6 && alt.includes(kandidat)) {
        return { bildUrl: bild, wie: "alttext" };
      }
    }
  }

  // Nichts gefunden. Das ist kein Fehler: Der Shop führt nur, was gerade
  // verkauft wird, ältere Modelle fehlen dort naturgemäß.
  return null;
}

/** Bild herunterladen. Gibt Bytes und Typ zurück, oder null. */
export async function ladeBild(
  bildUrl: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const antwort = await fetch(bildUrl, {
      headers: { "User-Agent": "EMTS-Lagernaut/1.0 (internes Werkzeug, AfB Soemmerda)" },
      signal:  AbortSignal.timeout(15_000),
    });
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
