"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

// ── Kamera-Test für die Teile-Erkennung ──────────────────────────────────────
//
// Zweck: herausfinden, ob die Kamera eines Geräts (Handscanner, Handy, Tablet)
// eine aufgedruckte Ersatzteilnummer überhaupt lesbar aufnimmt. Das ist die
// offene Frage, an der die ganze Erkennung hängt — vor dem Bauen messen statt
// hinterher feststellen.
//
// Gemessen wird im Browser, gespeichert auf dem Server: Ein Foto vom Handgerät
// nützt nichts, wenn es auf dem Handgerät liegen bleibt. „An Server senden"
// legt es in einem Ordner ab, der als Bind-Mount am Container hängt und einen
// Rebuild überlebt. Keine Datenbank — das sind Wegwerf-Aufnahmen für eine
// Messreihe, keine Stammdaten.
//
// ⚠️ Hochgeladen wird die ORIGINALDATEI, nicht das Canvas-Bild. Über Canvas
// würde das Foto neu kodiert und verlöre genau die Schärfe, die hier geprüft
// werden soll.
//
// ⚠️ Zwei Aufnahmewege, und der Unterschied ist der Kern des Tests:
//   • Kamera-App (Dateiauswahl mit `capture`): liefert die VOLLE Fotoauflösung
//     des Geräts. Das ist der realistische Fall.
//   • Live-Vorschau (getUserMedia): liefert nur die Videoauflösung, oft bloß
//     1280×720. Gut zum Finden von Abstand und Licht, aber als Qualitätsurteil
//     irreführend — deshalb steht das ausdrücklich dran.

type Messung = {
  breite:      number;
  hoehe:       number;
  megapixel:   number;
  schaerfe:    number;  // Varianz des Laplace-Filters
  helligkeit:  number;  // 0..255
  ueberstrahlt: number; // Anteil Pixel >= 250 in Prozent
  zuDunkel:    number;  // Anteil Pixel <= 10 in Prozent
  quelle:      "Kamera-App" | "Live-Vorschau";
};

// Schwellen für die Ampel. Bewusst grob: die Zahl ist ein Anhaltspunkt,
// das Urteil fällt am 1:1-Ausschnitt weiter unten mit eigenen Augen.
const SCHAERFE_GUT    = 300;
const SCHAERFE_MITTEL = 100;

export default function KameraTestPage() {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const cropRef   = useRef<HTMLCanvasElement>(null);
  const [stream,  setStream]  = useState<MediaStream | null>(null);
  const [bild,    setBild]    = useState<string | null>(null);
  const [messung, setMessung] = useState<Messung | null>(null);
  const [fehler,  setFehler]  = useState<string | null>(null);
  const [dateiInfo, setDateiInfo] = useState<string | null>(null);
  const [notiz, setNotiz] = useState("");
  // Rohdaten des Bildes getrennt vom Anzeige-URL halten: zum Hochladen braucht
  // es base64, fuer die Vorschau reicht eine Objekt-URL.
  const [roh, setRoh] = useState<{ base64: string; mimeType: string } | null>(null);

  const { show } = useToast();
  const utils = api.useUtils();
  const gespeicherte = api.kameratest.liste.useQuery();

  const senden = api.kameratest.speichern.useMutation({
    onSuccess: (r) => {
      show(`Auf Server gespeichert (${(r.groesse / 1048576).toFixed(1)} MB)`, "success");
      setNotiz("");
      void utils.kameratest.liste.invalidate();
    },
    onError: (e) => show(e.message, "error"),
  });

  const loeschen = api.kameratest.loeschen.useMutation({
    onSuccess: () => void utils.kameratest.liste.invalidate(),
    onError:   (e) => show(e.message, "error"),
  });

  const alleLoeschen = api.kameratest.alleLoeschen.useMutation({
    onSuccess: (r) => { show(`${r.geloescht} Bilder geloescht`, "success"); void utils.kameratest.liste.invalidate(); },
    onError:   (e) => show(e.message, "error"),
  });

  // Kamera beim Verlassen der Seite freigeben — sonst leuchtet sie weiter.
  useEffect(() => () => { stream?.getTracks().forEach((t) => t.stop()); }, [stream]);

  async function vorschauStarten() {
    setFehler(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width:  { ideal: 3840 },
          height: { ideal: 2160 },
        },
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
    } catch (e) {
      setFehler(
        "Kamera nicht verfügbar: " + ((e as Error).message || "unbekannt") +
        " — die Live-Vorschau braucht HTTPS und eine Freigabe im Browser. " +
        "Der Weg über die Kamera-App funktioniert auch ohne.",
      );
    }
  }

  function vorschauStoppen() {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }

  /** Bild analysieren: Auflösung, Schärfe, Helligkeit, Überstrahlung. */
  function analysiere(img: HTMLImageElement | HTMLVideoElement, quelle: Messung["quelle"]) {
    const breite = "videoWidth"  in img ? img.videoWidth  : img.naturalWidth;
    const hoehe  = "videoHeight" in img ? img.videoHeight : img.naturalHeight;
    if (!breite || !hoehe) { setFehler("Bild konnte nicht gelesen werden."); return; }

    // Für die Rechnung auf handliche Größe bringen. Die Schärfe wird dadurch
    // vergleichbar zwischen Geräten mit sehr unterschiedlicher Auflösung —
    // sonst gewinnt immer die größere Kamera, unabhängig von der Optik.
    const ZIEL = 1000;
    const f = Math.min(1, ZIEL / Math.max(breite, hoehe));
    const bw = Math.max(1, Math.round(breite * f));
    const bh = Math.max(1, Math.round(hoehe  * f));

    const c = document.createElement("canvas");
    c.width = bw; c.height = bh;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) { setFehler("Canvas nicht verfügbar."); return; }
    ctx.drawImage(img as CanvasImageSource, 0, 0, bw, bh);

    const daten = ctx.getImageData(0, 0, bw, bh).data;

    // Graustufen + Helligkeitsverteilung in einem Durchgang
    const grau = new Float32Array(bw * bh);
    let summe = 0, hell = 0, dunkel = 0;
    for (let i = 0, p = 0; i < daten.length; i += 4, p++) {
      const g = 0.299 * daten[i]! + 0.587 * daten[i + 1]! + 0.114 * daten[i + 2]!;
      grau[p] = g;
      summe += g;
      if (g >= 250) hell++;
      if (g <= 10)  dunkel++;
    }

    // Laplace-Filter; die Varianz der Antwort ist das gängige Schärfemaß.
    // Ein unscharfes Bild hat kaum Kantenenergie, die Varianz geht gegen null.
    let lSumme = 0, lQuadrat = 0, n = 0;
    for (let y = 1; y < bh - 1; y++) {
      for (let x = 1; x < bw - 1; x++) {
        const i = y * bw + x;
        const l = grau[i - bw]! + grau[i + bw]! + grau[i - 1]! + grau[i + 1]! - 4 * grau[i]!;
        lSumme += l; lQuadrat += l * l; n++;
      }
    }
    const mittel   = lSumme / n;
    const schaerfe = lQuadrat / n - mittel * mittel;

    setMessung({
      breite, hoehe,
      megapixel:    (breite * hoehe) / 1_000_000,
      schaerfe,
      helligkeit:   summe / (bw * bh),
      ueberstrahlt: (hell   / (bw * bh)) * 100,
      zuDunkel:     (dunkel / (bw * bh)) * 100,
      quelle,
    });

    // 1:1-Ausschnitt aus der Bildmitte in ORIGINALAUFLÖSUNG. Das ist der
    // eigentliche Test: Wer die Nummer hier nicht lesen kann, dessen Kamera
    // reicht auch für die Erkennung nicht.
    const cc = cropRef.current;
    if (cc) {
      const aw = Math.min(720, breite), ah = Math.min(280, hoehe);
      cc.width = aw; cc.height = ah;
      const cx = cc.getContext("2d");
      cx?.drawImage(
        img as CanvasImageSource,
        Math.round((breite - aw) / 2), Math.round((hoehe - ah) / 2), aw, ah,
        0, 0, aw, ah,
      );
    }
  }

  function ausVorschau() {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    const dataUrl = c.toDataURL("image/jpeg", 0.92);
    setBild(dataUrl);
    setRoh({ base64: dataUrl, mimeType: "image/jpeg" });
    setDateiInfo(null);
    analysiere(v, "Live-Vorschau");
  }

  function ausDatei(e: React.ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0];
    if (!datei) return;
    setFehler(null);
    setDateiInfo(`${datei.name || "Foto"} · ${(datei.size / 1_048_576).toFixed(1)} MB`);
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => { setBild(url); analysiere(img, "Kamera-App"); };
    img.onerror = () => setFehler("Datei konnte nicht als Bild gelesen werden.");
    img.src = url;

    // Parallel das Original als base64 vorhalten — NICHT ueber Canvas, sonst
    // wuerde das Bild neu kodiert und verloere genau die Schaerfe, um die es geht.
    const leser = new FileReader();
    leser.onload = () => {
      const mime = ["image/jpeg", "image/png", "image/webp"].includes(datei.type)
        ? datei.type : "image/jpeg";
      setRoh({ base64: String(leser.result), mimeType: mime });
    };
    leser.readAsDataURL(datei);
  }

  const urteil = !messung ? null
    : messung.schaerfe >= SCHAERFE_GUT    ? { text: "scharf",   farbe: "#04B475" }
    : messung.schaerfe >= SCHAERFE_MITTEL ? { text: "grenzwertig", farbe: "#f7b928" }
    :                                       { text: "unscharf", farbe: "#fa3e3e" };

  const knopf = "px-5 py-3 rounded-xl font-bold min-h-[56px] text-base";

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">📷 Kamera-Test</h1>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Prüft, ob die Kamera dieses Geräts eine aufgedruckte Ersatzteilnummer lesbar aufnimmt.
          Nichts wird gespeichert oder verschickt, alles rechnet hier im Browser.
        </p>
      </div>

      {/* ── Anleitung ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#008BD2]/40 bg-[#008BD2]/8 p-4 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
        <strong>So testest du:</strong>
        <ol className="list-decimal ml-5 mt-2 space-y-1 text-[#65676b] dark:text-[#b0b3b8]">
          <li>Teil mit der Nummer nach oben hinlegen, gutes Licht, <strong>kein Blitz</strong>.</li>
          <li>Teil leicht kippen, bis die Spiegelung neben der Schrift liegt.</li>
          <li>Etwa 15 bis 20 cm Abstand, auf die Nummer tippen zum Scharfstellen.</li>
          <li>Die Nummer <strong>in die Bildmitte</strong> — der Ausschnitt unten kommt von dort.</li>
        </ol>
      </div>

      {/* ── Aufnahme ──────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm space-y-4">

        <div>
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Weg 1: Kamera-App</h2>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5 mb-2">
            Der aussagekräftige Weg. Nutzt die volle Fotoauflösung des Geräts.
          </p>
          <label className={`${knopf} inline-flex items-center bg-[#0064d2] text-white cursor-pointer`}>
            Foto aufnehmen
            <input type="file" accept="image/*" capture="environment"
              onChange={ausDatei} className="sr-only" />
          </label>
          {dateiInfo && (
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-2">{dateiInfo}</p>
          )}
        </div>

        <hr className="border-[#ced4da] dark:border-[#3e4042]" />

        <div>
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Weg 2: Live-Vorschau</h2>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5 mb-2">
            Zum Ausprobieren von Abstand und Licht. Liefert nur Videoauflösung,
            oft deutlich weniger als ein Foto — als Qualitätsurteil also nicht geeignet.
          </p>
          <div className="flex gap-2 flex-wrap">
            {!stream ? (
              <button onClick={vorschauStarten}
                className={`${knopf} border-2 border-[#0064d2] text-[#0064d2] dark:text-[#45bdff]`}>
                Vorschau starten
              </button>
            ) : (
              <>
                <button onClick={ausVorschau} className={`${knopf} bg-[#04B475] text-white`}>
                  Standbild nehmen
                </button>
                <button onClick={vorschauStoppen}
                  className={`${knopf} border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]`}>
                  Vorschau aus
                </button>
              </>
            )}
          </div>
          <video ref={videoRef} playsInline muted
            className={`mt-3 w-full rounded-lg bg-black ${stream ? "" : "hidden"}`} />
        </div>

        {fehler && (
          <p className="text-sm text-[#c62828] dark:text-[#ff8a80] font-semibold">{fehler}</p>
        )}
      </div>

      {/* ── Ergebnis ──────────────────────────────────────────────────── */}
      {messung && urteil && (
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Ergebnis</h2>
            <span className="text-xs font-mono text-[#65676b] dark:text-[#b0b3b8]">
              Quelle: {messung.quelle}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kachel titel="Auflösung"
              wert={`${messung.breite}×${messung.hoehe}`}
              zusatz={`${messung.megapixel.toFixed(1)} MP`} />
            <Kachel titel="Schärfe"
              wert={messung.schaerfe.toFixed(0)}
              zusatz={urteil.text} farbe={urteil.farbe} />
            <Kachel titel="Helligkeit"
              wert={messung.helligkeit.toFixed(0)}
              zusatz={messung.helligkeit < 60 ? "zu dunkel" : messung.helligkeit > 200 ? "sehr hell" : "in Ordnung"} />
            <Kachel titel="Überstrahlt"
              wert={`${messung.ueberstrahlt.toFixed(1)} %`}
              zusatz={messung.ueberstrahlt > 5 ? "Spiegelung!" : "in Ordnung"}
              farbe={messung.ueberstrahlt > 5 ? "#f7b928" : undefined} />
          </div>

          <div>
            <h3 className="font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">
              Bildmitte, unverkleinert
            </h3>
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mb-2">
              Das ist der eigentliche Test. Kannst du die Nummer hier flüssig lesen,
              reicht die Kamera. Musst du raten, reicht sie nicht.
            </p>
            <div className="overflow-x-auto border border-[#ced4da] dark:border-[#3e4042] rounded-lg bg-[#f0f2f5] dark:bg-[#18191a]">
              <canvas ref={cropRef} className="block" />
            </div>
          </div>

          {/* ── An Server senden ─────────────────────────────────────── */}
          <div className="rounded-lg border-2 border-[#008BD2]/40 bg-[#008BD2]/8 p-4 space-y-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-1">
                Notiz zum Bild (optional)
              </label>
              <input
                type="text" value={notiz} onChange={(e) => setNotiz(e.target.value)}
                placeholder="z. B. Touchpad HP, Aufkleber halb abgerieben"
                className="w-full px-3 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[48px]"
              />
            </div>
            <button
              onClick={() => roh && senden.mutate({
                base64:   roh.base64,
                mimeType: roh.mimeType as "image/jpeg" | "image/png" | "image/webp",
                notiz:    notiz.trim() || undefined,
                messung: {
                  breite: messung.breite, hoehe: messung.hoehe,
                  schaerfe: Math.round(messung.schaerfe),
                  helligkeit: Math.round(messung.helligkeit),
                  ueberstrahlt: Number(messung.ueberstrahlt.toFixed(2)),
                  quelle: messung.quelle,
                },
              })}
              disabled={!roh || senden.isPending}
              className={`${knopf} w-full bg-[#202F61] text-white disabled:opacity-50`}
            >
              {senden.isPending ? "Wird hochgeladen…" : "An Server senden"}
            </button>
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Die Messwerte werden mitgespeichert. Bilder bleiben liegen, bis sie
              gelöscht werden; ab 40 Stück fallen die ältesten automatisch raus.
            </p>
          </div>

          {bild && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-[#0064d2] dark:text-[#45bdff]">
                Ganzes Bild anzeigen
              </summary>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bild} alt="Aufgenommenes Teil" className="mt-3 w-full rounded-lg" />
              <a href={bild}
                download={`teiletest-${messung.breite}x${messung.hoehe}-schaerfe${messung.schaerfe.toFixed(0)}.jpg`}
                className="inline-block mt-3 text-sm font-bold text-[#0064d2] dark:text-[#45bdff] underline">
                Bild speichern (Dateiname enthält die Messwerte)
              </a>
            </details>
          )}
        </div>
      )}

      {/* ── Auf dem Server ────────────────────────────────────────────── */}
      {gespeicherte.data && gespeicherte.data.fotos.length > 0 && (
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
              Auf dem Server ({gespeicherte.data.fotos.length})
            </h2>
            <button
              onClick={() => { if (confirm("Wirklich ALLE Testbilder vom Server löschen?")) alleLoeschen.mutate(); }}
              className="text-xs font-bold text-[#c62828] dark:text-[#ff8a80] underline"
            >
              alle löschen
            </button>
          </div>

          <p className="text-xs font-mono text-[#65676b] dark:text-[#b0b3b8] break-all">
            {gespeicherte.data.ort}
          </p>

          <ul className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
            {gespeicherte.data.fotos.map((f) => (
              <li key={f.name} className="flex items-center gap-3 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/kameratest/bild?name=${encodeURIComponent(f.name)}`}
                  alt={f.notiz ?? f.name}
                  className="w-16 h-16 object-cover rounded-lg border border-[#ced4da] dark:border-[#3e4042] flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">
                    {f.notiz ?? "ohne Notiz"}
                  </div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    {new Date(f.zeit).toLocaleString("de-DE")}
                    {f.benutzer ? ` · ${f.benutzer}` : ""}
                    {` · ${(f.groesse / 1048576).toFixed(1)} MB`}
                  </div>
                  {f.messung && (
                    <div className="text-xs font-mono text-[#90939a] truncate">
                      {f.messung.breite}×{f.messung.hoehe} · Schärfe {f.messung.schaerfe} · {f.messung.quelle}
                    </div>
                  )}
                </div>
                <a
                  href={`/api/kameratest/bild?name=${encodeURIComponent(f.name)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="px-3 py-2 text-xs font-bold rounded-lg border border-[#0064d2]/40 text-[#0064d2] dark:text-[#45bdff]"
                >
                  öffnen
                </a>
                <button
                  onClick={() => loeschen.mutate({ name: f.name })}
                  aria-label={`${f.name} löschen`}
                  className="px-3 py-2 text-xs font-bold rounded-lg text-[#fa3e3e]"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Kachel({ titel, wert, zusatz, farbe }: {
  titel: string; wert: string; zusatz?: string; farbe?: string;
}) {
  return (
    <div className="rounded-lg border border-[#ced4da] dark:border-[#3e4042] p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
        {titel}
      </div>
      <div className="text-lg font-black tabular-nums text-[#1a1a1a] dark:text-[#e4e6eb] mt-0.5">
        {wert}
      </div>
      {zusatz && (
        <div className="text-xs font-semibold mt-0.5"
          style={{ color: farbe ?? "var(--text-dim, #65676b)" }}>
          {zusatz}
        </div>
      )}
    </div>
  );
}
