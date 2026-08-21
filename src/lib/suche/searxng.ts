import { redis } from "@/core/infra/redis";
import type { Fundstelle, SucheErgebnis } from "./typen";

// ── Suche über die eigene SearXNG-Instanz ────────────────────────────────────
//
// SearXNG hat keinen eigenen Index. Es reicht die Anfrage an Google, Bing,
// DuckDuckGo und andere weiter und fasst die Antworten zusammen. Die Treffer
// sind also im Kern die der großen Suchmaschinen, nur ohne Konto, ohne Karte
// und ohne Kontingent, das jemand von heute auf morgen streichen kann.
//
// ⚠️ Der Preis dafür: Es gibt keine Zusage. Erkennt eine Suchmaschine den
// Verkehr als automatisiert, blockt sie ihn. Deshalb bleibt das Tempo bewusst
// niedrig und der Rückfallweg — Modelle von Hand eintragen — bleibt bestehen.
//
// Erreichbar ist der Dienst nur im Docker-Netz. Von außen ist kein Port offen.

// Deutlich großzügiger als bei Google, weil kein fremdes Kontingent verbraucht
// wird. Trotzdem eine Grenze: Eine Schleife im Code soll nicht stundenlang
// Suchanfragen absetzen und die Instanz auffällig machen.
const TAGESLIMIT = 300;

export function istEingerichtet(): boolean {
  return !!process.env.SEARXNG_URL;
}

function schluessel(): string {
  return `searx:${new Date().toISOString().slice(0, 10)}`;
}

export async function verbrauchHeute(): Promise<number> {
  try {
    const wert = await redis.get(schluessel());
    return wert ? Number(wert) : 0;
  } catch {
    return 0;
  }
}

async function zaehleHoch(): Promise<number> {
  try {
    const k = await redis.incr(schluessel());
    if (k === 1) await redis.expire(schluessel(), 172_800);
    return k;
  } catch {
    return 0; // Redis weg ist kein Grund, die Suche zu verweigern
  }
}

export async function suche(begriff: string, anzahl = 8): Promise<SucheErgebnis> {
  const basis = process.env.SEARXNG_URL;
  if (!basis) return { ok: false, grund: "SearXNG ist nicht eingerichtet (SEARXNG_URL fehlt)." };

  const verbraucht = await zaehleHoch();
  if (verbraucht > TAGESLIMIT) {
    return { ok: false, grund: `Eigene Tagesgrenze von ${TAGESLIMIT} Abfragen erreicht.` };
  }

  const url = new URL("/search", basis);
  url.searchParams.set("q", begriff);
  url.searchParams.set("format", "json");
  // Allgemeine Websuche; Bilder und Nachrichten wären hier nur Rauschen.
  url.searchParams.set("categories", "general");
  url.searchParams.set("safesearch", "0");

  try {
    const antwort = await fetch(url, {
      headers: { Accept: "application/json" },
      // 8 statt 15 Sekunden. SearXNG fragt selbst mehrere Suchmaschinen und
      // liefert normalerweise in 2 bis 4 Sekunden. Was länger braucht, ist
      // fast immer eine Maschine, die klemmt — darauf zu warten verlängert nur
      // die Wartezeit an der Werkbank, ohne mehr Fundstellen zu bringen.
      signal:  AbortSignal.timeout(8_000),
    });

    if (!antwort.ok) {
      const text = await antwort.text().catch(() => "");
      // 403 heißt bei SearXNG fast immer: In settings.yml fehlt das
      // JSON-Format oder der Ratenbegrenzer greift.
      if (antwort.status === 403) {
        return { ok: false, grund: "SearXNG lehnt JSON ab. In settings.yml muss unter search.formats der Eintrag json stehen." };
      }
      return { ok: false, grund: `SearXNG antwortet mit ${antwort.status}. ${text.slice(0, 200)}` };
    }

    const daten = await antwort.json() as {
      results?: { title?: string; content?: string; url?: string }[];
    };

    const fundstellen: Fundstelle[] = (daten.results ?? [])
      .slice(0, anzahl)
      .map((r) => ({
        titel:   r.title   ?? "",
        ausriss: r.content ?? "",
        link:    r.url     ?? "",
      }));

    return { ok: true, fundstellen, verbraucht };
  } catch (e) {
    return { ok: false, grund: `SearXNG nicht erreichbar: ${(e as Error).message}` };
  }
}
