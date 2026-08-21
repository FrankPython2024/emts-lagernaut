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
  | { ok: true;  text: string;  dauerMs: number }
  | { ok: false; grund: string; dauerMs: number };

// ── Denkstufe ────────────────────────────────────────────────────────────────
//
// Die neueren Modelle denken vor der Antwort. Für „schreibe mir einen Text"
// ist das Gold wert, für unsere Aufgabe nicht: Hier wird ein Etikett abgelesen
// und einer festen Liste zugeordnet. Das Denken ist der größte Einzelposten in
// der Wartezeit an der Werkbank.
//
// ⚠️ Zwei Dinge, die am 21.08.2026 Geld gekostet haben:
//
// 1. Es gibt ZWEI Felder, und das falsche ist ein sofortiger 400.
//    `thinkingBudget` gehört zu Gemini 2.5, `thinkingLevel` zur 3er-Reihe.
//    Unser Modell ist ein 3er — mit `thinkingBudget` kam nur
//    „Request contains an invalid argument". Beide zusammen sind laut Google
//    ebenfalls ein Fehler.
//
// 2. Ganz abschalten geht bei Flash NICHT. Google schreibt ausdrücklich, dass
//    Gemini 3 Flash und Flash-Lite kein vollständiges „thinking off" können.
//    Die niedrigste erlaubte Stufe ist „low" — mehr ist nicht zu holen.
//
// Erlaubt sind low | medium | high, Vorgabe des Modells wäre medium.
// Über GEMINI_DENKSTUFE in der .env änderbar, falls „low" die Erkennung
// spürbar verschlechtert.
//
// Und weil wir Googles API-Oberfläche nicht in der Hand haben: Antwortet ein
// Modell auf das Feld mit 400, wird der Aufruf EINMAL ohne die Stufe
// wiederholt. Nur wenn DAS klappt, gilt das Feld als abgelehnt — sonst hätte
// ein 400 aus ganz anderem Grund (etwa ein kaputtes Bild) die Beschleunigung
// dauerhaft stillgelegt.
const DENKSTUFEN = ["low", "medium", "high"] as const;
let stufeAbgelehnt = false;

function denkstufe(): string {
  const gewuenscht = (process.env.GEMINI_DENKSTUFE || "low").toLowerCase();
  return (DENKSTUFEN as readonly string[]).includes(gewuenscht) ? gewuenscht : "low";
}

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
  const start = Date.now();
  const schluessel = process.env.GEMINI_API_KEY;
  if (!schluessel) {
    return { ok: false, grund: "Gemini ist nicht eingerichtet (GEMINI_API_KEY fehlt).", dauerMs: 0 };
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
  return {
    ok: false,
    grund: `${letzterGrund} (auch nach ${WARTEN.length + 1} Versuchen)`,
    dauerMs: Date.now() - start,
  };

  /** Kurzformen, damit die Zeitmessung an keinem Ausgang vergessen wird. */
  function gut(text: string): KiAntwort  { return { ok: true,  text,  dauerMs: Date.now() - start }; }
  function mies(grund: string): KiAntwort { return { ok: false, grund, dauerMs: Date.now() - start }; }

  function koerper(mitStufe: boolean): string {
    const sparsam = mitStufe && denkstufe() === "low";
    return JSON.stringify({
      contents: [{ parts: teile }],
      generationConfig: {
        // Niedrig, weil hier nichts erfunden werden soll. Die Aufgabe ist
        // Ablesen und Zuordnen, nicht Formulieren.
        temperature:     0,
        // ⚠️ Die Denkschritte zählen auf dieses Budget mit. Bei „low" reicht
        // weniger; sobald das Modell frei denken darf, muss das großzügige
        // Budget stehen bleiben — sonst bricht das JSON mittendrin ab
        // (19.08.2026, Antwort kam leer zurück).
        maxOutputTokens: sparsam ? 2048 : 4096,
        responseMimeType: "application/json",
        ...(mitStufe ? { thinkingConfig: { thinkingLevel: denkstufe() } } : {}),
      },
    });
  }

  /** Ein einzelner Aufruf. `nochmal` sagt, ob sich ein weiterer Versuch lohnt. */
  async function einVersuch(): Promise<{ ok: boolean; nochmal: boolean; antwort: KiAntwort }> {
    const mitStufe = !stufeAbgelehnt;

    try {
      let antwort = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    koerper(mitStufe),
        // 45 Sekunden. Mit gedrosseltem Denken ist die Antwort deutlich früher
        // da; das Zeitlimit ist nur noch die Notbremse, damit niemand an der
        // Werkbank endlos vor einem hängenden Bildschirm steht.
        signal: AbortSignal.timeout(45_000),
      });

      // ⚠️ JEDER 400 wird einmal ohne die Denkstufe wiederholt — nicht nur
      // einer, dessen Text zufällig „thinking" enthält. Genau daran ist der
      // Rückfall am 21.08.2026 vorbeigelaufen: Google schrieb bloß
      // „Request contains an invalid argument", und der Mitarbeiter bekam eine
      // Fehlermeldung statt eines Ergebnisses.
      //
      // Als abgelehnt gilt das Feld nur, wenn der Versuch OHNE es klappt. Ein
      // 400 aus anderem Grund soll die Beschleunigung nicht stilllegen.
      if (antwort.status === 400 && mitStufe) {
        const meldung = await antwort.clone().text().catch(() => "");
        const zweite = await fetch(url, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    koerper(false),
          signal:  AbortSignal.timeout(45_000),
        });
        if (zweite.ok) {
          stufeAbgelehnt = true;
          console.warn(`[Gemini] thinkingLevel wird abgelehnt, künftig ohne. Meldung war: ${meldung.slice(0, 200)}`);
          antwort = zweite;
        }
        // Sonst bleibt die ursprüngliche Antwort stehen und wird unten ehrlich
        // als Fehler gemeldet.
      }

      if (!antwort.ok) {
        const text = await antwort.text().catch(() => "");

        // 429 = Tageskontingent aufgebraucht. Erwarteter Normalfall, kein
        // Defekt — und ein weiterer Versuch würde es nur schlimmer machen.
        if (antwort.status === 429) {
          return {
            ok: false, nochmal: false,
            antwort: mies("Gemini-Tageskontingent aufgebraucht. Morgen wieder, oder von Hand eintragen."),
          };
        }

        // 500 bis 504 sind Auslastung auf Googles Seite. Genau dafür ist die
        // Wiederholung da.
        const voruebergehend = antwort.status >= 500 && antwort.status <= 504;
        return {
          ok: false, nochmal: voruebergehend,
          antwort: mies(voruebergehend
            ? "Gemini ist gerade überlastet."
            : `Gemini antwortet mit ${antwort.status}. ${text.slice(0, 200)}`),
        };
      }

      const daten = await antwort.json() as {
        candidates?: {
          content?: { parts?: { text?: string; thought?: boolean }[] };
          finishReason?: string;
        }[];
      };
      const kandidat = daten.candidates?.[0];

      // Denkschritte herausfiltern: Sie kommen als eigene Teile mit. Bleibt
      // das Denken abgeschaltet, ist die Liste ohnehin leer — der Filter
      // schadet dann nicht und trägt weiter, falls jemand es wieder einschaltet.
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
        return { ok: false, nochmal: true, antwort: mies(`Gemini hat nichts zurückgegeben${warum}.`) };
      }

      return { ok: true, nochmal: false, antwort: gut(text) };
    } catch (e) {
      const meldung = (e as Error).message;
      // Nach einer Zeitüberschreitung NICHT wiederholen — siehe oben.
      const zeitAus = /timeout|abort/i.test(meldung);
      return {
        ok: false, nochmal: !zeitAus,
        antwort: mies(zeitAus
          ? "Die Erkennung hat zu lange gedauert. Bitte von Hand erfassen oder es gleich nochmal versuchen."
          : `Gemini nicht erreichbar: ${meldung}`),
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
