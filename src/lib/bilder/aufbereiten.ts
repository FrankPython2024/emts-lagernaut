// ── Foto für die Erkennung aufbereiten ───────────────────────────────────────
//
// Läuft im Browser, damit kein 13-Megapixel-Bild durchs Netz muss.
//
// Zwei Sorten Bild entstehen, und der Unterschied ist der Kern der Sache:
//
//   Übersicht — auf 1024 Pixel verkleinert. Beantwortet „was ist das für ein
//   Teil". Dafür braucht es keine Auflösung, nur die Form.
//
//   Ausschnitte — Etikettbereiche in ORIGINALAUFLÖSUNG. Beantworten „was steht
//   drauf". Am 19.08.2026 an einer HP-Bodenschale gemessen: Auf dem verkleinerten
//   Gesamtbild war die Nummer unlesbar, im Originalausschnitt einwandfrei.
//   Ohne diesen Schritt scheitert die Erkennung bei Kunststoffteilen, ohne dass
//   jemand versteht warum.
//
// ⚠️ Die Ausschnitte werden NICHT geraten. Ein Gitter über das Bild, je Zelle
// die Kantenenergie messen, die dichtesten Zellen nehmen. Beschriftete Flächen
// haben viel Kantenenergie, glatter Kunststoff fast keine. Kein Modell nötig.

/** Erzeugt wird immer JPEG — der Typ sagt das auch, damit die Schnittstelle
 *  ihn ohne Umweg annimmt. */
export type Bilddaten = { base64: string; mimeType: "image/jpeg" };

export type Aufbereitet = {
  uebersicht:  Bilddaten;
  ausschnitte: Bilddaten[];
  breite:      number;
  hoehe:       number;
  /** Was tatsaechlich verschickt wird, in Kilobyte — fuer die Anzeige. */
  groesseKb:   number;
  /** Für die Anzeige: wo die Ausschnitte im Bild lagen. */
  bereiche:    { x: number; y: number; w: number; h: number }[];
};

const UEBERSICHT_KANTE = 768;
const GITTER           = 12;   // 12×12 Zellen über das Bild
const MAX_AUSSCHNITTE  = 2;
// ⚠️ Obergrenze für die Ausschnitte. „Originalauflösung" heißt hier: nicht
// kleiner als nötig — nicht: beliebig groß. Ein Ausschnitt von 900×1200 aus
// einem 13-Megapixel-Foto war zusammen mit den anderen so schwer, dass die
// Erkennung in die Zeitüberschreitung lief. Bei 1000 Bildpunkten längster
// Kante bleibt Kleingedrucktes lesbar und die Übertragung erträglich.
const AUSSCHNITT_KANTE = 1000;

function alsBase64(canvas: HTMLCanvasElement, guete = 0.9): string {
  // Ohne data-URL-Präfix — die Schnittstelle will die nackten Daten.
  return canvas.toDataURL("image/jpeg", guete).replace(/^data:[^;]+;base64,/, "");
}

/** Kantenenergie einer Zelle: Summe der Helligkeitssprünge zum rechten und unteren Nachbarn. */
function energie(daten: Uint8ClampedArray, breite: number, x0: number, y0: number, w: number, h: number): number {
  let summe = 0;
  // Jeden zweiten Bildpunkt reicht — halbiert die Rechenzeit, ändert die
  // Rangfolge der Zellen praktisch nicht.
  for (let y = y0; y < y0 + h - 1; y += 2) {
    for (let x = x0; x < x0 + w - 1; x += 2) {
      const i = (y * breite + x) * 4;
      const g  = daten[i]!;
      const gr = daten[i + 8]!;              // zwei Punkte weiter rechts
      const gu = daten[i + breite * 8]!;     // zwei Zeilen weiter unten
      summe += Math.abs(g - gr) + Math.abs(g - gu);
    }
  }
  return summe / ((w * h) / 4 || 1);
}

export async function bereiteFotoAuf(datei: File): Promise<Aufbereitet> {
  const bild = await ladeBild(datei);
  const bw = bild.naturalWidth, bh = bild.naturalHeight;

  // ── 1. Übersicht ────────────────────────────────────────────────────────
  const f  = Math.min(1, UEBERSICHT_KANTE / Math.max(bw, bh));
  const uw = Math.max(1, Math.round(bw * f)), uh = Math.max(1, Math.round(bh * f));
  const uc = document.createElement("canvas");
  uc.width = uw; uc.height = uh;
  uc.getContext("2d")!.drawImage(bild, 0, 0, uw, uh);

  // ── 2. Beschriftete Stellen finden ──────────────────────────────────────
  // Gesucht wird auf einer kleinen Graustufenfassung; gefunden wird damit die
  // POSITION, geschnitten wird danach aus dem Original.
  const sw = 480, sh = Math.max(1, Math.round((bh / bw) * 480));
  const sc = document.createElement("canvas");
  sc.width = sw; sc.height = sh;
  const sctx = sc.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(bild, 0, 0, sw, sh);
  const daten = sctx.getImageData(0, 0, sw, sh).data;

  const zellW = Math.floor(sw / GITTER), zellH = Math.floor(sh / GITTER);
  const zellen: { x: number; y: number; wert: number }[] = [];
  for (let zy = 0; zy < GITTER; zy++) {
    for (let zx = 0; zx < GITTER; zx++) {
      zellen.push({
        x: zx, y: zy,
        wert: energie(daten, sw, zx * zellW, zy * zellH, zellW, zellH),
      });
    }
  }
  zellen.sort((a, b) => b.wert - a.wert);

  // ⚠️ Früher stand hier „nur Zellen, die 1,6-fach über dem Mittelwert liegen".
  // Das war ein Denkfehler: Auf einer Platine ist das GANZE Bild voller Kanten,
  // also liegt der Mittelwert hoch und keine Zelle sticht heraus — es kam kein
  // einziger Ausschnitt zustande, ausgerechnet bei den Teilen mit der besten
  // Beschriftung.
  //
  // Richtig ist: Die stärksten Zellen sind per Definition die besten
  // Kandidaten, egal wie der Rest des Bildes aussieht. Eine Untergrenze bleibt
  // nur, damit ein leeres oder komplett unscharfes Bild keine sinnlosen
  // Ausschnitte erzeugt.
  const MINDEST_ENERGIE = 4;
  const kandidaten = zellen.filter((z) => z.wert > MINDEST_ENERGIE);

  // Zellen, die zu nah beieinander liegen, würden fast dasselbe zeigen.
  const gewaehlt: typeof kandidaten = [];
  for (const z of kandidaten) {
    if (gewaehlt.length >= MAX_AUSSCHNITTE) break;
    if (gewaehlt.some((g) => Math.abs(g.x - z.x) < 3 && Math.abs(g.y - z.y) < 3)) continue;
    gewaehlt.push(z);
  }

  // ── 3. Aus dem Original schneiden ───────────────────────────────────────
  const skalaX = bw / sw, skalaY = bh / sh;
  const ausschnitte: Aufbereitet["ausschnitte"] = [];
  const bereiche:    Aufbereitet["bereiche"]    = [];

  for (const z of gewaehlt) {
    // Großzügig um die Zelle herum schneiden: Eine Nummer reicht fast immer
    // über eine Zellgrenze hinaus.
    const mitteX = (z.x + 0.5) * zellW * skalaX;
    const mitteY = (z.y + 0.5) * zellH * skalaY;
    const aw = Math.min(bw, Math.round(zellW * skalaX * 3.5));
    const ah = Math.min(bh, Math.round(zellH * skalaY * 3.5));
    const ax = Math.max(0, Math.min(bw - aw, Math.round(mitteX - aw / 2)));
    const ay = Math.max(0, Math.min(bh - ah, Math.round(mitteY - ah / 2)));

    // Nur so weit verkleinern, wie die Obergrenze es verlangt — und keinen
    // Deut mehr. Ist der Bereich ohnehin kleiner, bleibt er Punkt für Punkt.
    const af = Math.min(1, AUSSCHNITT_KANTE / Math.max(aw, ah));
    const zw = Math.max(1, Math.round(aw * af)), zh = Math.max(1, Math.round(ah * af));

    const ac = document.createElement("canvas");
    ac.width = zw; ac.height = zh;
    ac.getContext("2d")!.drawImage(bild, ax, ay, aw, ah, 0, 0, zw, zh);

    ausschnitte.push({ base64: alsBase64(ac, 0.85), mimeType: "image/jpeg" as const });
    bereiche.push({ x: ax, y: ay, w: aw, h: ah });
  }

  URL.revokeObjectURL(bild.src);

  const uebersicht = { base64: alsBase64(uc, 0.8), mimeType: "image/jpeg" as const };
  // base64 blaeht die Daten um ein Drittel auf; das ist die Menge, die
  // tatsaechlich ueber die Leitung geht.
  const zeichen = uebersicht.base64.length + ausschnitte.reduce((s2, a) => s2 + a.base64.length, 0);

  return {
    uebersicht,
    ausschnitte,
    bereiche,
    breite: bw, hoehe: bh,
    groesseKb: Math.round(zeichen * 0.75 / 1024),
  };
}

function ladeBild(datei: File): Promise<HTMLImageElement> {
  return new Promise((fertig, fehler) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload  = () => fertig(img);
    img.onerror = () => fehler(new Error("Bild konnte nicht gelesen werden."));
    img.src = url;
  });
}
