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
  // die Meldung sagt selbst „try again later". Also versuchen wir es zwei Mal
  // nach, statt dem Mitarbeiter an der Werkbank eine Fehlermeldung hinzuwerfen.
  // Kurze Wartezeiten, damit niemand ewig davorsteht.
  const WARTEN = [1200, 2500];
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
            maxOutputTokens: 800,
            responseMimeType: "application/json",
          },
        }),
        // Wer an der Werkbank steht, wartet nicht ewig.
        signal: AbortSignal.timeout(15_000),
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
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = daten.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text.trim()) {
        return { ok: false, nochmal: true, antwort: { ok: false, grund: "Gemini hat nichts zurückgegeben." } };
      }

      return { ok: true, nochmal: false, antwort: { ok: true, text } };
    } catch (e) {
      // Zeitüberschreitung oder Netzproblem: einmal nachfassen lohnt sich.
      return {
        ok: false, nochmal: true,
        antwort: { ok: false, grund: `Gemini nicht erreichbar: ${(e as Error).message}` },
      };
    }
  }
}

/**
 * Antwort als JSON lesen. Modelle packen ihre Ausgabe gern in ```json-Blöcke,
 * auch wenn man sie ausdrücklich darum bittet, es nicht zu tun.
 */
export function alsJson<T>(text: string): T | null {
  const sauber = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(sauber) as T; } catch { return null; }
}
