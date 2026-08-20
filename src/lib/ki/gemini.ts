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

const STANDARD_MODELL = "gemini-2.5-flash";

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
      signal: AbortSignal.timeout(20_000),
    });

    if (!antwort.ok) {
      const text = await antwort.text().catch(() => "");
      // 429 = Tageskontingent aufgebraucht. Erwarteter Normalfall, kein Defekt.
      if (antwort.status === 429) {
        return { ok: false, grund: "Gemini-Tageskontingent aufgebraucht. Morgen wieder, oder von Hand eintragen." };
      }
      return { ok: false, grund: `Gemini antwortet mit ${antwort.status}. ${text.slice(0, 200)}` };
    }

    const daten = await antwort.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = daten.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) return { ok: false, grund: "Gemini hat nichts zurückgegeben." };

    return { ok: true, text };
  } catch (e) {
    return { ok: false, grund: `Gemini nicht erreichbar: ${(e as Error).message}` };
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
