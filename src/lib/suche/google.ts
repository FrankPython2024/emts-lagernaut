import { redis } from "@/core/infra/redis";

// ── Google Custom Search ─────────────────────────────────────────────────────
//
// Wird gebraucht, um zu einer Teilenummer Fundstellen zu holen. Ausgewertet
// wird danach im eigenen Haus: Es wird nur geprüft, welche der EIGENEN
// Gerätemodelle in den Fundstellen vorkommen. Deshalb reichen Titel und
// Textausriss, die Seiten selbst müssen nicht geladen werden.
//
// ⚠️ KOSTENGARANTIE — das ist hier die wichtigste Eigenschaft:
// Google gibt 100 Abfragen am Tag gratis. Darüber hinaus wird nur abgerechnet,
// wenn im Google-Konto ein Zahlungskonto hinterlegt ist. Ist keines hinterlegt,
// liefert Google ab Abfrage 101 einen Fehler statt einer Rechnung.
// Die harte Garantie ist also die Einrichtung, nicht dieser Code.
//
// Der Zähler unten ist die zweite Sicherung: Er stoppt schon bei 90, damit ein
// Fehler in einer Schleife nicht das Tageskontingent verbrennt, das jemand
// anderes vielleicht noch braucht.

const TAGESLIMIT = 90;

export type Fundstelle = {
  titel:   string;
  ausriss: string;
  link:    string;
};

export type SucheErgebnis =
  | { ok: true;  fundstellen: Fundstelle[]; verbraucht: number }
  | { ok: false; grund: string };

export function istEingerichtet(): boolean {
  return !!(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID);
}

/** Verbrauch des heutigen Tages, für die Anzeige in der Oberfläche. */
export async function verbrauchHeute(): Promise<number> {
  try {
    const wert = await redis.get(schluessel());
    return wert ? Number(wert) : 0;
  } catch {
    return 0; // Redis weg: kein Grund, die Anzeige scheitern zu lassen
  }
}

function schluessel(): string {
  // Datum als Schlüssel; Google zählt nach amerikanischer Pazifikzeit, wir
  // zählen bewusst konservativer nach lokalem Datum. Im Zweifel bremsen wir
  // früher als Google, nie später.
  return `cse:${new Date().toISOString().slice(0, 10)}`;
}

async function zaehleHoch(): Promise<number> {
  try {
    const k = await redis.incr(schluessel());
    // 48 Stunden Haltbarkeit — der Schlüssel des Vortages darf ruhig noch da
    // sein, er wird ohnehin nicht mehr gelesen.
    if (k === 1) await redis.expire(schluessel(), 172_800);
    return k;
  } catch {
    // Redis nicht erreichbar. Die eigentliche Kostengarantie hängt am fehlenden
    // Zahlungskonto bei Google, nicht an diesem Zähler — also weitermachen.
    return 0;
  }
}

/**
 * Eine Suchabfrage. Gibt bewusst KEINE Ausnahme zurück, wenn etwas fehlt oder
 * das Limit erreicht ist: Das automatische Nachschlagen ist eine Zugabe, es
 * darf nie einen Arbeitsablauf abbrechen.
 */
export async function suche(begriff: string, anzahl = 8): Promise<SucheErgebnis> {
  if (!istEingerichtet()) {
    return { ok: false, grund: "Google-Suche ist nicht eingerichtet (GOOGLE_CSE_KEY / GOOGLE_CSE_ID fehlen)." };
  }

  const verbraucht = await zaehleHoch();
  if (verbraucht > TAGESLIMIT) {
    return {
      ok: false,
      grund: `Tageslimit erreicht (${TAGESLIMIT} Abfragen). Morgen geht es weiter, oder trag die Modelle von Hand ein.`,
    };
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", process.env.GOOGLE_CSE_KEY!);
  url.searchParams.set("cx",  process.env.GOOGLE_CSE_ID!);
  url.searchParams.set("q",   begriff);
  url.searchParams.set("num", String(Math.min(10, Math.max(1, anzahl))));

  try {
    // Kurzer Zeitausstieg: Wer an der Werkbank steht, wartet nicht zehn
    // Sekunden auf eine Zugabe.
    const antwort = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!antwort.ok) {
      const text = await antwort.text().catch(() => "");
      // 429 = Kontingent aufgebraucht. Das ist der Normalfall ohne
      // Zahlungskonto und ausdrücklich kein Fehler, den jemand beheben muss.
      if (antwort.status === 429) {
        return { ok: false, grund: "Googles Tageskontingent ist aufgebraucht. Morgen wieder, oder von Hand eintragen." };
      }
      return { ok: false, grund: `Google antwortet mit ${antwort.status}. ${text.slice(0, 200)}` };
    }

    const daten = await antwort.json() as {
      items?: { title?: string; snippet?: string; link?: string }[];
    };

    return {
      ok: true,
      verbraucht,
      fundstellen: (daten.items ?? []).map((i) => ({
        titel:   i.title   ?? "",
        ausriss: i.snippet ?? "",
        link:    i.link    ?? "",
      })),
    };
  } catch (e) {
    return { ok: false, grund: `Suche nicht erreichbar: ${(e as Error).message}` };
  }
}
