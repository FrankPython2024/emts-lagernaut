// ── Gemini-Zugang (Gratis-Kontingent) ────────────────────────────────────────
//
// Wird gebraucht, um aus einer Teilenummer oder einem Foto herauszufinden, was
// für ein Teil das ist. Bewusst über den Gratis-Zugang von aistudio.google.com:
// kein Zahlungskonto, keine Karte, keine laufenden Kosten.
//
// ⚠️ Zwei Dinge, die den Umgang hier bestimmen:
//
// 1. Ein Sprachmodell antwortet auch dann flüssig, wenn es nichts weiß. Was
//    hier zurückkommt, ist ein VORSCHLAG, nie ein Fakt. Alles, was daraus in
//    die Datenbank wandert, muss entweder gegen die eigenen Daten geprüft oder
//    von einem Menschen bestätigt sein.
//
// 2. Auf dem Gratis-Zugang darf Google die Eingaben zum Training verwenden.
//    Deshalb gehen hier nur Teilenummern und Fotos von Bauteilen raus, niemals
//    LogIDs, Kundendaten oder Bildschirminhalte.

// ⚠️ Google schließt ältere Modelle für neue Konten. Am 19.08.2026 lieferte
// „gemini-2.5-flash" ein 404 mit dem Hinweis, „gemini-3.6-flash" zu nehmen.
// Falls das wieder passiert: Der Name lässt sich über GEMINI_MODELL in der
// .env überschreiben, ohne dass hier etwas geändert werden muss. Die
// Fehlermeldung von Google nennt den Nachfolger jeweils selbst.
const STANDARD_MODELL = "gemini-3.6-flash";

export type KiAntwort =
  | { ok: true;  text: string }
  | { ok: false; grund: string };

export function istEingerichtet(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Eine Anfrage an Gemini. Optional mit Bild (base64, ohne data-URL-Präfix).
 *
 * Gibt nie eine Ausnahme weiter: Die Erkennung ist eine Zugabe und darf keinen
 * Arbeitsablauf abbrechen. Fehler kommen als `ok: false` zurück.
 */
export async function frage(
  anweisung: string,
  bilder?: { base64: string; mimeType: string }[],
): Promise<KiAntwort> {
  const schluessel = process.env.GEMINI_API_KEY;
  if (!schluessel) {
    return { ok: false, grund: "Gemini ist nicht eingerichtet (GEMINI_API_KEY fehlt)." };
  }

  const modell = process.env.GEMINI_MODELL || STANDARD_MODELL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modell}:generateContent?key=${encodeURIComponent(schluessel)}`;

  // Anweisung zuerst, dann die Bilder in der Reihenfolge, die dort beschrieben
  // ist: Übersicht, danach die Ausschnitte.
  const teile: Record<string, unknown>[] = [{ text: anweisung }];
  for (const b of bilder ?? []) {
    teile.push({ inline_data: { mime_type: b.mimeType, data: b.base64 } });
  }

  // ⚠️ Der Gratis-Zugang antwortet zeitweise mit 503 „high demand". Das ist
  // kein Fehler, den jemand beheben könnte, sondern Googles Auslastung — und
  // die Meldung sagt selbst „try again later". Also versuchen wir es nach,
  // statt dem Mitarbeiter an der Werkbank eine Fehlermeldung hinzuwerfen.
  //
  // ⚠️ Wiederholt wird NUR bei schnellen Fehlern (5xx). Nach einer
  // Zeitüberschreitung nochmal 60 Sekunden zu warten hieße, jemanden drei
  // Minuten vor dem Bildschirm stehen zu lassen — dann lieber ehrlich abbrechen
  // und von Hand erfassen.
  const WARTEN = [1500];
  let letzterGrund = "Gemini nicht erreichbar.";

  for (let versuch = 0; versuch <= WARTEN.length; versuch++) {
    if (versuch > 0) await new Promise((r) => setTimeout(r, WARTEN[versuch - 1]));
    const ergebnis = await einVersuch();
    if (ergebnis.ok || !ergebnis.nochmal) return ergebnis.antwort;
    letzterGrund = ergebnis.antwort.ok ? letzterGrund : ergebnis.antwort.grund;
  }
  return { ok: false, grund: `${letzterGrund} (auch nach ${WARTEN.length + 1} Versuchen)` };

  /** Ein einzelner Aufruf. `nochmal` sagt, ob sich ein weiterer Versuch lohnt. */
  async function einVersuch(): Promise<{ ok: boolean; nochmal: boolean; antwort: KiAntwort }> {
    try {
      const antwort = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: teile }],
          generationConfig: {
            // Niedrig, weil hier nichts erfunden werden soll. Die Aufgabe ist
            // Ablesen und Zuordnen, nicht Formulieren.
            temperature:     0,
            // ⚠️ Großzügig. Die neueren Modelle denken vor der Antwort, und
            // diese Denkschritte zählen mit. Mit 800 Token brach das JSON
            // mittendrin ab und war nicht mehr lesbar — die Antwort selbst
            // braucht keine 200 Token, das Denken davor aber schon.
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
        // Großzügig: Mit mehreren Bildern und einem denkenden Modell sind
        // 15 Sekunden zu knapp — daran ist es am 19.08.2026 gescheitert.
        // Eine Minute ist an der Werkbank lang, aber immer noch besser als
        // eine Fehlermeldung nach 45 Sekunden.
        signal: AbortSignal.timeout(60_000),
      });

      if (!antwort.ok) {
        const text = await antwort.text().catch(() => "");

        // 429 = Tageskontingent aufgebraucht. Erwarteter Normalfall, kein
        // Defekt — und ein weiterer Versuch würde es nur schlimmer machen.
        if (antwort.status === 429) {
          return {
            ok: false, nochmal: false,
            antwort: { ok: false, grund: "Gemini-Tageskontingent aufgebraucht. Morgen wieder, oder von Hand eintragen." },
          };
        }

        // 500 bis 504 sind Auslastung auf Googles Seite. Genau dafür ist die
        // Wiederholung da.
        const voruebergehend = antwort.status >= 500 && antwort.status <= 504;
        return {
          ok: false, nochmal: voruebergehend,
          antwort: {
            ok: false,
            grund: voruebergehend
              ? "Gemini ist gerade überlastet."
              : `Gemini antwortet mit ${antwort.status}. ${text.slice(0, 200)}`,
          },
        };
      }

      const daten = await antwort.json() as {
        candidates?: {
          content?: { parts?: { text?: string; thought?: boolean }[] };
          finishReason?: string;
        }[];
      };
      const kandidat = daten.candidates?.[0];

      // Denkschritte herausfiltern: Die neueren Modelle liefern sie als eigene
      // Teile mit. Würde man sie mitnehmen, stünde vor dem JSON noch Fließtext.
      const text = (kandidat?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");

      if (!text.trim()) {
        // Häufigster Grund: MAX_TOKENS. Dann hat das Modell nur gedacht und
        // nichts mehr geantwortet. Das gehört in die Meldung, sonst sucht
        // jemand an der falschen Stelle.
        const warum = kandidat?.finishReason
          ? ` (Abbruchgrund: ${kandidat.finishReason})`
          : "";
        return {
          ok: false, nochmal: true,
          antwort: { ok: false, grund: `Gemini hat nichts zurückgegeben${warum}.` },
        };
      }

      return { ok: true, nochmal: false, antwort: { ok: true, text } };
    } catch (e) {
      const meldung = (e as Error).message;
      // Nach einer Zeitüberschreitung NICHT wiederholen — siehe oben.
      const zeitAus = /timeout|abort/i.test(meldung);
      return {
        ok: false, nochmal: !zeitAus,
        antwort: {
          ok: false,
          grund: zeitAus
            ? "Die Erkennung hat zu lange gedauert. Bitte von Hand erfassen oder es gleich nochmal versuchen."
            : `Gemini nicht erreichbar: ${meldung}`,
        },
      };
    }
  }
}

/**
 * Antwort als JSON lesen.
 *
 * Zwei Eigenheiten, die man einkalkulieren muss: Modelle packen ihre Ausgabe
 * gern in ```json-Blöcke, auch wenn man ausdrücklich darum bittet, es nicht zu
 * tun. Und manchmal steht ein Satz davor oder dahinter.
 *
 * Deshalb wird notfalls das erste vollständige geschweifte Klammerpaar aus dem
 * Text herausgeschnitten, statt an einem Zeichen zu scheitern.
 */
export function alsJson<T>(text: string): T | null {
  const sauber = text.trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  try { return JSON.parse(sauber) as T; } catch { /* zweiter Versuch unten */ }

  // Klammern zählen statt einer Zeichenkettensuche: Ein einfaches „bis zur
  // letzten Klammer" würde bei verschachtelten Objekten daneben greifen.
  const start = sauber.indexOf("{");
  if (start === -1) return null;
  let tiefe = 0, inText = false, entwertet = false;
  for (let i = start; i < sauber.length; i++) {
    const z = sauber[i]!;
    if (entwertet) { entwertet = false; continue; }
    if (z === "\\") { entwertet = true; continue; }
    if (z === '"') { inText = !inText; continue; }
    if (inText) continue;
    if (z === "{") tiefe++;
    else if (z === "}") {
      tiefe--;
      if (tiefe === 0) {
        try { return JSON.parse(sauber.slice(start, i + 1)) as T; } catch { return null; }
      }
    }
  }
  return null;
}
