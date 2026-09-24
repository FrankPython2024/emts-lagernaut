"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { useSession } from "next-auth/react";
import type { SessionUser } from "@/core/types";
import { formatLogId } from "@/lib/pickup/logId";
import { GeraetDetail, type PickupPos } from "../GeraetDetail";
import { nurZiffern } from "@/lib/format/ziffern";
import { playScanSound, playComplete, playColliKomplett, playNegativeSound, playWagenTreffer, playWagenLeer, type ScanResult } from "@/lib/pickup/scanSound";
import { ordneWeg, planeRunden, naechsterHalt, richtungVon } from "@/lib/pickup/route";
import {
  werteScanAus, fehlerArt, wartezeitMs, ladeWarteschlange, speichereWarteschlange,
  mitLokalenFunden, type OffenerScan,
} from "@/lib/pickup/scanAuswertung";

// Farben wie ModusBanner: Blau = LogID-Auftrag, Violett = Colli-Auftrag.
// Status nie NUR über Farbe — immer zusätzlich Icon + Klartext.
const BLAU    = "#008BD2";
const VIOLETT = "#7c3aed";


type ScanPos = {
  id: number; logId: string; colli: string | null; stellplatz: string | null;
  bezeichnung: string | null; status: string; gefundenVonName: string | null; gefundenAm: Date | string | null;
};

// Einheitliches Ergebnis des letzten Scans — LogID-Scan ODER Colli-Prüfung.
type Feedback =
  | { kind: "logid"; result: ScanResult; logId: string; position: ScanPos | null }
  | { kind: "colli"; colliNummer: string; colliBekannt: boolean; treffer: { logId: string; bezeichnung: string | null }[]; anzahlTreffer: number }
  | { kind: "vorabscan"; hauptcolli: string; stellplatz: string | null; kartons: { karton: string; anzahl: number }[] }
  | { kind: "unbekannt"; wert: string }
  | { kind: "gemerkt"; anzahl: number };

function fmtZeit(d: Date | string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// ── „Zuletzt gescannt" — kompakt: IMMER Icon + Text + Farbe zugleich ───────────
function ErgebnisBanner({ fb, istColli }: { fb: Feedback | null; istColli: boolean }) {
  if (!fb) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl px-3 min-h-[56px] bg-[#f0f2f5] dark:bg-[#18191a] border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-base">
        <span aria-hidden>🔍</span>
        <span>Noch nichts gescannt</span>
      </div>
    );
  }

  // ── Colli-Prüfung ──
  if (fb.kind === "colli") {
    if (fb.anzahlTreffer > 0) {
      return (
        <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#04B475", background: "rgba(4,180,117,0.10)" }}>
          <div className="flex items-center gap-4">
            <span className="text-5xl" aria-hidden>📦</span>
            <div className="min-w-0">
              <div className="text-2xl font-black" style={{ color: "#04713f" }}>Diesen Colli durchscannen</div>
              <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">{formatLogId(fb.colliNummer)}</div>
              <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                {fb.anzahlTreffer} {fb.anzahlTreffer === 1 ? "gesuchtes Gerät" : "gesuchte Geräte"} hier drin:
              </div>
            </div>
          </div>
          <ul className="mt-3 space-y-1">
            {fb.treffer.map((t) => (
              <li key={t.logId} className="flex items-center gap-2 text-base">
                <span aria-hidden>🏷️</span>
                <span className="font-mono font-bold text-[#202F61] dark:text-[#e4e6eb]">{formatLogId(t.logId)}</span>
                <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{t.bezeichnung ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    // 0 Treffer / unbekannt — weiter zum nächsten Colli
    return (
      <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#fa3e3e", background: "rgba(250,62,62,0.10)" }}>
        <div className="flex items-center gap-4">
          <span className="text-5xl" aria-hidden>➡️</span>
          <div className="min-w-0">
            <div className="text-2xl font-black" style={{ color: "#b3261e" }}>Nichts Gesuchtes hier</div>
            <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb]">Weiter zum nächsten Colli.</div>
            <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] font-mono">
              {fb.colliNummer ? formatLogId(fb.colliNummer) : "—"}
              <span className="font-sans"> · {fb.colliBekannt ? "kein gesuchtes Gerät drin" : "unbekannt"}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Hauptcolli-Vorabscan (Wegweisung am Wagen — hakt NICHTS ab) ──
  if (fb.kind === "vorabscan") {
    const hat = fb.kartons.length > 0;
    if (hat) {
      return (
        <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#4f46e5", background: "rgba(79,70,229,0.10)" }}>
          <div className="flex items-start gap-4">
            <span className="text-5xl" aria-hidden>🚛</span>
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wide mb-1" style={{ background: "#4f46e5", color: "#fff" }}>
                Vorabscan · Wagen
              </span>
              <div className="text-2xl font-black" style={{ color: "#04713f" }}>
                {fb.kartons.length} {fb.kartons.length === 1 ? "gesuchter Colli" : "gesuchte Collis"} in diesem Wagen
              </div>
              <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">
                Wagen {formatLogId(fb.hauptcolli)}{fb.stellplatz ? ` · ${fb.stellplatz}` : ""}
              </div>
              <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                Nichts wird abgehakt. Diese Collis hier herausnehmen und scannen:
              </div>
            </div>
          </div>
          <ul className="mt-3 space-y-1">
            {fb.kartons.map((k) => (
              <li key={k.karton} className="flex items-center gap-2 text-base">
                <span aria-hidden>🧭</span>
                <span className="font-mono font-bold text-[#202F61] dark:text-[#e4e6eb]">{formatLogId(nurZiffern(k.karton)) || k.karton}</span>
                {!istColli && (
                  <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">· {k.anzahl} {k.anzahl === 1 ? "Gerät" : "Geräte"}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    // 0 gesuchte — neutral, weiter zum nächsten Wagen
    return (
      <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#90939a", background: "rgba(144,147,154,0.12)" }}>
        <div className="flex items-center gap-4">
          <span className="text-5xl" aria-hidden>🚛</span>
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wide mb-1" style={{ background: "#65676b", color: "#fff" }}>
              Vorabscan · Wagen
            </span>
            <div className="text-2xl font-black text-[#65676b] dark:text-[#b0b3b8]">Nichts Gesuchtes in diesem Wagen</div>
            <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">
              Wagen {formatLogId(fb.hauptcolli)}{fb.stellplatz ? ` · ${fb.stellplatz}` : ""}
            </div>
            <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">Weiter zum nächsten Wagen.</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Auftrag lädt noch — Scan ist gemerkt, nicht verloren ──
  if (fb.kind === "gemerkt") {
    return (
      <div role="status" aria-live="assertive" className="flex items-center gap-3 rounded-xl border-2 px-3 min-h-[56px]" style={{ borderColor: "#BA7517", background: "rgba(186,117,23,0.12)" }}>
        <span className="text-2xl" aria-hidden>⏳</span>
        <span className="text-base font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
          Auftrag lädt noch — {fb.anzahl} {fb.anzahl === 1 ? "Scan" : "Scans"} gemerkt
        </span>
      </div>
    );
  }

  // ── Nicht erkannt (falsche Ziffernlänge) ──
  if (fb.kind === "unbekannt") {
    return (
      <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#BA7517", background: "rgba(186,117,23,0.10)" }}>
        <div className="flex items-center gap-4">
          <span className="text-5xl" aria-hidden>❓</span>
          <div className="min-w-0">
            <div className="text-2xl font-black" style={{ color: "#BA7517" }}>Nicht erkannt</div>
            <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">{fb.wert || "—"}</div>
            <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">Das ist keine LogID und kein Colli. Bitte erneut scannen.</div>
          </div>
        </div>
      </div>
    );
  }

  // ── LogID-Scan — kompakte Statuszeile (~56px), Icon + Farbe + Klartext ──
  const p = fb.position;
  if (fb.result === "GEFUNDEN") {
    return (
      <div role="status" aria-live="assertive" className="flex items-center gap-3 rounded-xl border-2 px-3 min-h-[56px]" style={{ borderColor: "#04B475", background: "rgba(4,180,117,0.12)" }}>
        <span className="text-2xl" aria-hidden style={{ color: "#04713f" }}>✓</span>
        <span className="font-mono font-black text-lg text-[#202F61] dark:text-[#e4e6eb] whitespace-nowrap">{formatLogId(fb.logId)}</span>
        <span className="min-w-0 truncate text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
          Colli {p?.colli ?? "—"} · {p?.bezeichnung ?? "—"}
        </span>
      </div>
    );
  }
  if (fb.result === "SCHON") {
    return (
      <div role="status" aria-live="assertive" className="flex items-center gap-3 rounded-xl border-2 px-3 min-h-[56px]" style={{ borderColor: "#BA7517", background: "rgba(186,117,23,0.12)" }}>
        <span className="text-2xl" aria-hidden style={{ color: "#BA7517" }}>⚠</span>
        <span className="font-mono font-black text-lg text-[#202F61] dark:text-[#e4e6eb] whitespace-nowrap">{formatLogId(fb.logId)}</span>
        <span className="min-w-0 truncate text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
          Schon gefunden{p?.gefundenVonName ? ` · ${p.gefundenVonName}` : ""}
        </span>
      </div>
    );
  }
  // FREMD
  return (
    <div role="status" aria-live="assertive" className="flex items-center gap-3 rounded-xl border-2 px-3 min-h-[56px]" style={{ borderColor: "#fa3e3e", background: "rgba(250,62,62,0.12)" }}>
      <span className="text-2xl" aria-hidden style={{ color: "#b3261e" }}>✗</span>
      <span className="font-mono font-black text-lg text-[#202F61] dark:text-[#e4e6eb] whitespace-nowrap">{fb.logId ? formatLogId(fb.logId) : "—"}</span>
      <span className="min-w-0 truncate text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">Gehört nicht dazu</span>
    </div>
  );
}

// Gruppierungs-Schlüssel: LogID-Auftrag → Colli, Colli-Auftrag → Stellplatz.
function gruppenKey(p: ScanPos, istColli: boolean): string {
  return istColli ? (p.stellplatz ?? "") : (p.colli ?? "");
}

// Gruppiert Positionen (LogID-Auftrag → nach Colli, Colli-Auftrag → nach Stellplatz).
function gruppiere(positionen: ScanPos[], nachStellplatz: boolean) {
  const keyOf = (p: ScanPos) => (nachStellplatz ? (p.stellplatz ?? "") : (p.colli ?? ""));
  const map = new Map<string, ScanPos[]>();
  for (const p of positionen) {
    const key = keyOf(p);
    const arr = map.get(key);
    if (arr) arr.push(p); else map.set(key, [p]);
  }
  const out = [...map.entries()].map(([key, items]) => ({ key, items }));
  out.sort((a, b) => {
    if (a.key === "" && b.key === "") return 0;
    if (a.key === "") return 1;
    if (b.key === "") return -1;
    return a.key.localeCompare(b.key, "de", { numeric: true });
  });
  for (const g of out) {
    g.items.sort((x, y) => {
      const s = (x.stellplatz ?? "").localeCompare(y.stellplatz ?? "", "de", { numeric: true });
      return s !== 0 ? s : x.logId.localeCompare(y.logId, "de", { numeric: true });
    });
  }
  return out;
}

export default function PickupScanPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfPick = has("PICKUP_PICK");

  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const router = useRouter();
  const utils = api.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);

  const [eingabe, setEingabe]   = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Session-Liste „Gehört nicht dazu": fremde LogIDs + nicht passende Collis.
  const [nichtDazu, setNichtDazu] = useState<{ art: "logid" | "colli"; wert: string; zeit: Date }[]>([]);
  const [ansicht, setAnsicht] = useState<"offen" | "gefunden" | "fremd">("offen");
  // Wegführung (src/lib/pickup/route.ts): der Stellplatz, an dem der Picker gerade
  // ist — gesetzt beim Start (vollster Platz), beim Scannen (der Halt folgt dem
  // Menschen) und automatisch weiter, sobald ein Platz leer gepickt ist.
  // ⚠️ Ersetzt die Knöpfe „Meiste / Wenigste LogIDs zuerst": Die sortierten Collis
  // nach MENGE, nie nach ORT — am Auftrag „Richard 179" (115 Collis auf 31
  // Stellplätzen) lief der Picker dadurch 07-32 → 07-30 → 07-32 → 07-30 …
  const [haltWahl, setHaltWahl] = useState<string | null>(null);
  const richtungRef = useRef<1 | -1>(1);
  const [haltToast, setHaltToast] = useState<{ fertig: string; weiter: string } | null>(null);
  const haltToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pulse-Trigger des „Zuletzt gescannt"-Banners (steigt bei jedem Scan).
  const [pulseKey, setPulseKey]     = useState(0);
  // Hilfe-Texte standardmäßig eingeklappt — kosten sonst dauerhaft Platz im Kopf.
  const [hilfeAuf, setHilfeAuf]     = useState(false);

  // Nur noch Handscanner (Frank, 23.09.2026). Vorher erkannte die Seite den Zebra
  // am Touchscreen als „Mobil" — und holte in diesem Modus den Fokus nach einem
  // Tipp in die Liste bewusst NICHT zurück (sonst spränge jedes Mal die
  // Bildschirmtastatur auf). Folge: Nach jedem Tipp musste man ins Feld klicken.
  // `vonHand` ist nur der Notweg für ein unlesbares Etikett: Tastatur für EINE
  // Eingabe, danach wieder Scanner.
  const [vonHand, setVonHand] = useState(false);
  const tastatur = vonHand;

  const [abschlussDialog, setAbschlussDialog] = useState(false);
  const [unvollDialog, setUnvollDialog]       = useState(false);
  const [abschlussErgebnis, setAbschlussErgebnis] = useState<{ name: string; gesamt: number; gefunden: number; nichtGefunden: number } | null>(null);
  const prevVollRef = useRef<boolean | null>(null);

  // "Colli/Stellplatz komplett"-Toast — feiert, wenn innerhalb EINES Collis
  // (bzw. Stellplatzes) alle gesuchten LogIDs gefunden wurden. Eigener Sound,
  // unabhängig von der Gesamt-Auftrags-Fanfare (playComplete).
  const [colliToast, setColliToast]           = useState<{ key: string; anzahl: number } | null>(null);
  const colliKomplettInitRef = useRef(false);
  const colliKomplettMapRef  = useRef<Map<string, boolean>>(new Map());
  const colliToastTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Beim Wechsel des Auftrags (andere id) den Erkennungs-Zustand zurücksetzen,
  // sonst könnte ein alter Zwischenstand fälschlich als "neu komplett" gelten.
  useEffect(() => {
    colliKomplettInitRef.current = false;
    colliKomplettMapRef.current  = new Map();
    setColliToast(null);
    setHaltWahl(null);
    setHaltToast(null);
    richtungRef.current = 1;
  }, [id]);

  useEffect(() => () => {
    if (colliToastTimerRef.current) clearTimeout(colliToastTimerRef.current);
    if (haltToastTimerRef.current) clearTimeout(haltToastTimerRef.current);
  }, []);

  const [abschlussFehler, setAbschlussFehler] = useState<string | null>(null);
  const abschliessen = api.pickup.abschliessen.useMutation({
    onMutate: () => setAbschlussFehler(null),
    onSuccess: (r) => {
      setAbschlussErgebnis({ name: r.name, gesamt: r.gesamt, gefunden: r.gefunden, nichtGefunden: r.nichtGefunden });
      setTimeout(() => router.push("/pickup"), 1800);
    },
    onError: (e) => setAbschlussFehler(e.message || "Abschließen hat nicht geklappt. Bitte nochmal tippen."),
  });

  const { data: serverDaten, isLoading, error, refetch } = api.pickup.pickDetails.useQuery(
    { id },
    { enabled: !permsLoading && darfPick && Number.isInteger(id) && id > 0 },
  );
  const { data: session } = useSession();
  const meinKuerzel = (session?.user as SessionUser | undefined)?.kuerzel ?? null;

  // ── Kein Scan geht verloren (Paket 1, 24.09.2026) ─────────────────────────
  // Vorher wartete die Seite bei jedem Scan auf den Server: Ein zweiter Scan
  // während einer laufenden Anfrage wurde still verworfen (`if (!scan.isPending)`),
  // seine Ziffern klebten an die alten, Speicherfehler blieben stumm.
  // Jetzt: Das Gerät entscheidet sofort (src/lib/pickup/scanAuswertung.ts), Funde
  // gehen in eine Warteschlange, die der Reihe nach speichert und bei Netzfehlern
  // selbst wiederholt. Die Schlange liegt zusätzlich im localStorage — Neuladen
  // oder abgelaufene Anmeldung verlieren nichts. `lokalRef` hält Funde sichtbar
  // abgehakt, bis der Server sie bestätigt, auch wenn die Seite zwischendurch den
  // älteren Server-Stand neu lädt.
  // ⚠️ Refs statt State als Wahrheit: Der Scanner feuert schneller, als React neu
  // zeichnet — ein Doppelscan desselben Geräts muss schon beim zweiten Mal „schon
  // gefunden" ergeben, nicht ein zweites Mal in die Schlange.
  const lokalRef = useRef<Map<string, number>>(new Map());
  const [lokalStand, setLokalStand] = useState(0);
  const schlangeRef = useRef<OffenerScan[]>([]);
  const [schlange, setSchlange] = useState<OffenerScan[]>([]);
  const [sendeStatus, setSendeStatus] = useState<"ok" | "wartet" | "anmelden">("ok");
  const [speicherFehler, setSpeicherFehler] = useState<string | null>(null);
  const sendetRef = useRef(false);
  const weckerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abgleichRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Scans, die kamen, bevor der Auftrag geladen war.
  const vorLadenRef = useRef<string[]>([]);

  function setzeLokal(logId: string, am: number | null) {
    if (am === null) lokalRef.current.delete(logId); else lokalRef.current.set(logId, am);
    setLokalStand((n) => n + 1);
  }
  function setzeSchlange(neu: OffenerScan[]) {
    schlangeRef.current = neu;
    setSchlange(neu);
    speichereWarteschlange(id, neu);
  }

  const data = useMemo(() => {
    if (!serverDaten) return undefined;
    const positionen = mitLokalenFunden(serverDaten.positionen, lokalRef.current, meinKuerzel);
    return { ...serverDaten, positionen, gefunden: positionen.filter((p) => p.status === "GEFUNDEN").length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDaten, lokalStand, meinKuerzel]);

  const scanSpeichern = api.pickup.scan.useMutation();
  const sendeWeiterRef = useRef<() => Promise<void>>(async () => {});
  sendeWeiterRef.current = async () => {
    if (sendetRef.current) return;
    sendetRef.current = true;
    if (weckerRef.current) { clearTimeout(weckerRef.current); weckerRef.current = null; }
    let allesGesendet = false;
    try {
      while (schlangeRef.current.length > 0) {
        const s = schlangeRef.current[0]!;
        try {
          const res = await scanSpeichern.mutateAsync({ auftragId: id, logIdRaw: s.logId });
          setzeSchlange(schlangeRef.current.filter((x) => x.key !== s.key));
          // Die Position gibt es nicht mehr (Auftrag geändert) → Haken zurücknehmen.
          if (res.result === "FREMD") setzeLokal(s.logId, null);
          setSendeStatus("ok");
        } catch (err) {
          const art = fehlerArt(err);
          if (art === "aufgeben") {
            setzeSchlange(schlangeRef.current.filter((x) => x.key !== s.key));
            setzeLokal(s.logId, null);
            setSpeicherFehler(`${formatLogId(s.logId)} ist NICHT gespeichert: ${(err as Error)?.message || "vom Server abgelehnt"}`);
            playNegativeSound();
            continue;
          }
          if (art === "anmelden") { setSendeStatus("anmelden"); return; }
          setzeSchlange(schlangeRef.current.map((x) => (x.key === s.key ? { ...x, versuche: x.versuche + 1 } : x)));
          setSendeStatus("wartet");
          weckerRef.current = setTimeout(() => { void sendeWeiterRef.current(); }, wartezeitMs(s.versuche + 1));
          return;
        }
      }
      allesGesendet = true;
    } finally {
      sendetRef.current = false;
    }
    if (!allesGesendet) return;
    // Alles gespeichert → mit dem Server abgleichen. Erst nach 1,5 s Ruhe: Beim
    // zügigen Scannen würde sonst nach JEDEM Gerät der ganze Auftrag neu geladen.
    if (abgleichRef.current) clearTimeout(abgleichRef.current);
    abgleichRef.current = setTimeout(async () => {
      abgleichRef.current = null;
      const frisch = await refetch();
      if (!frisch.data) return; // kein Netz → Überlagerung bleibt, nichts geht verloren
      // Vom Server bestätigte Funde aus der Überlagerung nehmen — ab jetzt gilt
      // der Server-Stand (auch wenn z. B. ein Admin einen Fund zurücksetzt).
      const unterwegs = new Set(schlangeRef.current.map((x) => x.logId));
      const bestaetigt = new Set(frisch.data.positionen.filter((x) => x.status === "GEFUNDEN").map((x) => nurZiffern(x.logId)));
      let geaendert = false;
      for (const k of [...lokalRef.current.keys()]) {
        if (!unterwegs.has(k) && bestaetigt.has(k)) { lokalRef.current.delete(k); geaendert = true; }
      }
      if (geaendert) setLokalStand((n) => n + 1);
    }, 1500);
  };

  // Beim Öffnen: unsendete Scans vom letzten Mal übernehmen und losschicken.
  useEffect(() => {
    const alt = ladeWarteschlange(id);
    lokalRef.current = new Map(alt.map((x) => [x.logId, x.erfasstAm]));
    setLokalStand((n) => n + 1);
    schlangeRef.current = alt;
    setSchlange(alt);
    setSendeStatus("ok");
    setSpeicherFehler(null);
    vorLadenRef.current = [];
    if (alt.length > 0) void sendeWeiterRef.current();
    return () => {
      if (weckerRef.current) clearTimeout(weckerRef.current);
      if (abgleichRef.current) clearTimeout(abgleichRef.current);
    };
  }, [id]);

  // WLAN wieder da / zurück in der App → sofort weitersenden statt auf den Wecker warten.
  useEffect(() => {
    const los = () => { void sendeWeiterRef.current(); };
    window.addEventListener("online", los);
    document.addEventListener("visibilitychange", los);
    return () => {
      window.removeEventListener("online", los);
      document.removeEventListener("visibilitychange", los);
    };
  }, []);

  const zuruecksetzen = api.pickup.treffersZuruecksetzen.useMutation({
    // Auch ein nur lokal gebuchter (noch nicht gesendeter) Fund wird zurückgenommen.
    onMutate: ({ positionId }) => {
      const pos = data?.positionen.find((x) => x.id === positionId);
      if (!pos) return;
      const d = nurZiffern(pos.logId);
      setzeLokal(d, null);
      setzeSchlange(schlangeRef.current.filter((x) => x.logId !== d));
    },
    onSuccess: () => { void utils.pickup.pickDetails.invalidate({ id }); inputRef.current?.focus({ preventScroll: true }); },
    onError: () => setSpeicherFehler("Zurücksetzen hat nicht geklappt. Bitte nochmal tippen."),
  });

  // Nach jedem Ergebnis Fokus zurück ins Scan-Feld (Handheld-tauglich).
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, [feedback]);

  // Banner bei jedem neuen Scan kurz aufpulsen (Key-Bump → Re-Mount der Animation).
  useEffect(() => { if (feedback) setPulseKey((k) => k + 1); }, [feedback]);

  const vollstaendig = !!data && data.gesamt > 0 && data.gefunden === data.gesamt;
  const offen        = data ? data.gesamt - data.gefunden : 0;
  const istColli     = data?.typ === "COLLI";

  // Farbe nach Auftragstyp (kein Untermodus mehr): Blau = LogID, Violett = Colli.
  const aktivFarbe = istColli ? VIOLETT : BLAU;

  // Live-Abschluss-Fanfare nur beim Übergang unvollständig → vollständig.
  useEffect(() => {
    if (!data) return;
    const istVoll = data.gesamt > 0 && data.gefunden === data.gesamt;
    if (prevVollRef.current === null) { prevVollRef.current = istVoll; return; }
    if (istVoll && !prevVollRef.current) playComplete();
    prevVollRef.current = istVoll;
  }, [data]);

  const offenePositionen   = useMemo(() => (data?.positionen ?? []).filter((p) => p.status !== "GEFUNDEN"), [data]);
  const gefundenePositionen = useMemo(() => (data?.positionen ?? []).filter((p) => p.status === "GEFUNDEN"), [data]);
  const gruppenGefunden = useMemo(() => gruppiere(gefundenePositionen, !!istColli), [gefundenePositionen, istColli]);

  // Farbe für den Aufpuls-Effekt des Banners (Statusfarbe, sonst Cyan).
  const pulseColor = useMemo(() => {
    const fb = feedback;
    if (!fb) return "#00bcd4";
    if (fb.kind === "logid")     return fb.result === "GEFUNDEN" ? "#04B475" : fb.result === "SCHON" ? "#BA7517" : "#fa3e3e";
    if (fb.kind === "colli")     return fb.anzahlTreffer > 0 ? "#04B475" : "#fa3e3e";
    if (fb.kind === "vorabscan") return fb.kartons.length > 0 ? "#4f46e5" : "#90939a";
    if (fb.kind === "unbekannt") return "#BA7517";
    return "#00bcd4";
  }, [feedback]);

  // ALLE Positionen nach Colli (LogID-Auftrag) bzw. Stellplatz (Colli-Auftrag)
  // gruppieren — inkl. bereits gefundener (im Karton grün abgehakt). Membership
  // darf sich beim Scannen ändern; die REIHENFOLGE bleibt davon unberührt.
  const colliGruppen = useMemo(() => {
    const m = new Map<string, ScanPos[]>();
    for (const p of data?.positionen ?? []) {
      const key = gruppenKey(p, !!istColli);
      const arr = m.get(key);
      if (arr) arr.push(p); else m.set(key, [p]);
    }
    for (const arr of m.values()) {
      arr.sort((x, y) => {
        const s = (x.stellplatz ?? "").localeCompare(y.stellplatz ?? "", "de", { numeric: true });
        return s !== 0 ? s : x.logId.localeCompare(y.logId, "de", { numeric: true });
      });
    }
    return m;
  }, [data?.positionen, istColli]);

  // Erkennt den Übergang "Colli/Stellplatz war offen → ist jetzt komplett" und
  // feiert genau diesen Moment (Sound + Toast). "Ohne Colli/Stellplatz" (key "")
  // wird nicht gefeiert. Wird der GANZE Auftrag durch diesen Scan komplett, hat
  // die Auftrags-Fanfare (playComplete, unten) Vorrang — kein doppeltes Feiern.
  //
  // WICHTIG: Solange `data` noch nicht geladen ist, ist colliGruppen leer — ohne
  // das Warten hier würde die erste (leere) Ausführung fälschlich als Ausgangs-
  // zustand gelten. Sobald die echten Daten nachladen, sähen dann bereits
  // abgeschlossene Collis wie "gerade neu fertig" aus (Retrigger bei jedem F5).
  useEffect(() => {
    if (!data) return;
    const current = new Map<string, boolean>();
    for (const [key, items] of colliGruppen.entries()) {
      if (!key) continue;
      current.set(key, items.length > 0 && items.every((p) => p.status === "GEFUNDEN"));
    }
    if (!colliKomplettInitRef.current) {
      colliKomplettInitRef.current = true;
      colliKomplettMapRef.current = current;
      return;
    }
    const prev = colliKomplettMapRef.current;
    if (!vollstaendig) {
      for (const [key, komplett] of current.entries()) {
        if (komplett && prev.get(key) !== true) {
          const anzahl = colliGruppen.get(key)?.length ?? 0;
          setColliToast({ key, anzahl });
          playColliKomplett();
          if (colliToastTimerRef.current) clearTimeout(colliToastTimerRef.current);
          colliToastTimerRef.current = setTimeout(() => setColliToast(null), 2600);
          break; // Regelfall: ein Scan schließt genau ein Colli ab
        }
      }
    }
    colliKomplettMapRef.current = current;
  }, [colliGruppen, vollstaendig, data]);

  // ── Wegführung: Stellplätze als Halte ─────────────────────────────────────
  // Gilt für beide Auftragsarten: Bei LogID-Aufträgen liegen am Halt Collis mit
  // Geräten, bei Colli-Aufträgen die gesuchten Collis selbst.
  const halteMap = useMemo(() => {
    const m = new Map<string, ScanPos[]>();
    for (const p of data?.positionen ?? []) {
      const key = p.stellplatz ?? "";
      const arr = m.get(key);
      if (arr) arr.push(p); else m.set(key, [p]);
    }
    return m;
  }, [data?.positionen]);
  const halteSig = useMemo(() => [...halteMap.keys()].sort().join("|"), [halteMap]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const weg = useMemo(() => ordneWeg([...halteMap.keys()]), [halteSig]);
  const offenJeHalt = useMemo(() => {
    const m = new Map<string, number>();
    for (const [k, items] of halteMap) m.set(k, items.filter((p) => p.status !== "GEFUNDEN").length);
    return m;
  }, [halteMap]);
  // Haupt-/Restrunde EINGEFROREN: nur neu, wenn sich die Platzmenge ändert —
  // sonst rutschte ein Platz mitten im Laufen von der Haupt- in die Restrunde.
  const offenJeHaltRef = useRef(offenJeHalt);
  offenJeHaltRef.current = offenJeHalt;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const runden = useMemo(() => planeRunden(offenJeHaltRef.current, weg), [weg, data !== undefined]);

  const aktuellerHalt = useMemo(
    () => naechsterHalt({ weg, offen: offenJeHalt, haupt: runden.haupt, aktuell: haltWahl, richtung: richtungRef.current }),
    [weg, offenJeHalt, runden, haltWahl],
  );
  // Was kommt danach? (Vorschau im Karten-Fuß)
  const danachHalt = useMemo(() => {
    if (aktuellerHalt === null) return null;
    const ohne = new Map(offenJeHalt);
    ohne.set(aktuellerHalt, 0);
    return naechsterHalt({ weg, offen: ohne, haupt: runden.haupt, aktuell: aktuellerHalt, richtung: richtungRef.current });
  }, [aktuellerHalt, offenJeHalt, weg, runden]);

  // Für den Scan-Rückruf, der vor diesen Werten definiert ist.
  const wegRef = useRef(weg);
  wegRef.current = weg;
  const aktuellerHaltRef = useRef(aktuellerHalt);
  aktuellerHaltRef.current = aktuellerHalt;

  function wechselHalt(key: string) {
    if (!wegRef.current.includes(key) || key === aktuellerHaltRef.current) return;
    // Nachscan an einem schon leeren Platz (z. B. „schon gefunden") lenkt nicht um.
    if ((offenJeHaltRef.current.get(key) ?? 0) === 0) return;
    richtungRef.current = richtungVon(wegRef.current, aktuellerHaltRef.current, key, richtungRef.current);
    setHaltWahl(key);
  }

  // Halt leer gepickt → automatisch weiter. Beim Start (haltWahl null) nur
  // übernehmen, ohne Meldung — sonst gäbe es bei jedem Öffnen ein „fertig".
  useEffect(() => {
    if (!data || aktuellerHalt === null || aktuellerHalt === haltWahl) return;
    if (haltWahl !== null) {
      richtungRef.current = richtungVon(weg, haltWahl, aktuellerHalt, richtungRef.current);
      if (!vollstaendig) {
        setColliToast(null); // ein Hinweis reicht — der Halt sagt mehr als der Colli
        setHaltToast({ fertig: haltWahl, weiter: aktuellerHalt });
        if (haltToastTimerRef.current) clearTimeout(haltToastTimerRef.current);
        haltToastTimerRef.current = setTimeout(() => setHaltToast(null), 3500);
      }
    }
    setHaltWahl(aktuellerHalt);
  }, [aktuellerHalt, haltWahl, data, weg, vollstaendig]);

  // Hauptcolli-Vorabscan — kompakte Wagen-Karte für LOGID- UND COLLI-Aufträge.
  // Einmal geladen; die Treffer rechnet das Frontend lokal aus dem Live-Zustand.
  const wagenKarteQ = api.pickup.wagenKarte.useQuery(
    { auftragId: id },
    { enabled: !permsLoading && darfPick && Number.isInteger(id) && id > 0 },
  );
  const hauptcolliMap = useMemo(
    () => new Map((wagenKarteQ.data?.hauptcollis ?? []).map((h) => [h.hauptcolli, h.stellplatz])),
    [wagenKarteQ.data],
  );
  const untercolliZuHaupt = useMemo(
    () => new Map((wagenKarteQ.data?.zuordnung ?? []).map((m) => [m.untercolli, m.hauptcolli])),
    [wagenKarteQ.data],
  );
  const hauptcolliSet = useMemo(() => new Set(hauptcolliMap.keys()), [hauptcolliMap]);

  // Lokales Negativ-Feedback ohne Server (z. B. falsche Länge, klar fremd).
  // Gerätedetails: welche Position gerade angetippt wurde.
  const [detail, setDetail] = useState<ScanPos | null>(null);

  // ── Scan-Feld immer bereit ────────────────────────────────────────────────
  // Der Handscanner „tippt" wie eine Tastatur. Hat das Feld den Fokus verloren
  // (Tipp auf Liste, Knopf, Kopfzeile, App-Wechsel), liefen Scans bisher ins
  // Leere. Drei Wege zurück — außer ein Dialog ist offen (dessen Knöpfe
  // brauchen den Fokus) oder ein anderes Eingabefeld ist bewusst gewählt:
  //   1. Jede Taste ohne Fokus im Feld holt das Feld — das Zeichen landet dort.
  //   2. Nach jedem Antippen irgendwo kurz danach zurück ins Feld.
  //   3. Beim Zurückkehren in die App / den Tab.
  const dialogOffen = !!detail || abschlussDialog || unvollDialog || !!abschlussErgebnis;
  const dialogOffenRef = useRef(dialogOffen);
  dialogOffenRef.current = dialogOffen;
  // Ein Scan hat Vorrang vor einem offenen Fenster: Vorher liefen Scans ins Leere,
  // solange z. B. die Gerätedetails offen waren — ohne jeden Ton. Nur während des
  // Abschließens selbst bleibt das Fenster stehen.
  const schliesseFuerScanRef = useRef<() => boolean>(() => false);
  schliesseFuerScanRef.current = () => {
    if (abschlussErgebnis || abschliessen.isPending) return false;
    setDetail(null);
    setAbschlussDialog(false);
    setUnvollDialog(false);
    dialogOffenRef.current = false;
    return true;
  };
  useEffect(() => {
    const istAnderesFeld = (el: Element | null) =>
      !!el && el !== inputRef.current &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
    const holen = () => {
      if (dialogOffenRef.current) return;
      const aktiv = document.activeElement;
      if (aktiv === inputRef.current || istAnderesFeld(aktiv)) return;
      inputRef.current?.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (dialogOffenRef.current && /^\d$/.test(e.key) && schliesseFuerScanRef.current()) {
        inputRef.current?.focus({ preventScroll: true });
        return;
      }
      if (e.key.length === 1 || e.key === "Enter") holen();
    };
    let t: ReturnType<typeof setTimeout> | null = null;
    const onTipp = () => { if (t) clearTimeout(t); t = setTimeout(holen, 150); };
    const onSichtbar = () => { if (document.visibilityState === "visible") holen(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerup", onTipp, true);
    document.addEventListener("visibilitychange", onSichtbar);
    window.addEventListener("focus", holen);
    return () => {
      if (t) clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerup", onTipp, true);
      document.removeEventListener("visibilitychange", onSichtbar);
      window.removeEventListener("focus", holen);
    };
  }, []);
  // „↑ Nach oben" — erscheint erst, wenn man weit in die Liste gescrollt hat
  // (Frank, 23.09.2026). Bewusst ein Knopf statt Dreifach-Tipp: Der erste Tipp
  // träfe fast immer ein Gerät oder eine Karte und öffnete dort schon etwas.
  const [weitUnten, setWeitUnten] = useState(false);
  useEffect(() => {
    const pruefen = () => setWeitUnten(window.scrollY > 400);
    pruefen();
    window.addEventListener("scroll", pruefen, { passive: true });
    return () => window.removeEventListener("scroll", pruefen);
  }, []);
  function nachOben() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    inputRef.current?.focus({ preventScroll: true });
  }

  // Dialog zu → sofort wieder scanbereit.
  useEffect(() => {
    if (!dialogOffen) inputRef.current?.focus({ preventScroll: true });
  }, [dialogOffen]);

  function meldeUnbekannt(wert: string) {
    setFeedback({ kind: "unbekannt", wert });
    playNegativeSound();
    setEingabe("");
    inputRef.current?.focus({ preventScroll: true });
  }

  // Karton-(Untercolli-)Schlüssel einer Position — bei COLLI-Aufträgen ist die
  // Position selbst der Untercolli (logId), bei LOGID-Aufträgen steckt der Karton
  // im colli-Feld (NICHT die LogID!). Beide via nurZiffern → Join gegen Lagerwagen.
  function kartonKey(p: ScanPos): string {
    return istColli ? p.logId : nurZiffern(p.colli ?? "");
  }

  // Hauptcolli-Vorabscan (LOGID + COLLI): markiert NICHTS als gefunden. Gesuchte =
  // offene Positionen dieses Auftrags, deren Karton/Untercolli zu diesem Hauptcolli
  // gehört — aus dem Live-Zustand, aktualisiert sich beim Abhaken. Nach Karton
  // gruppiert (bei LOGID liegen mehrere Geräte im selben Karton).
  function handleVorabscan(hauptcolli: string) {
    const stellplatz = hauptcolliMap.get(hauptcolli) ?? null;
    const proKarton = new Map<string, { karton: string; anzahl: number }>();
    for (const p of data?.positionen ?? []) {
      if (p.status === "GEFUNDEN") continue;
      const key = kartonKey(p);
      if (!key || untercolliZuHaupt.get(key) !== hauptcolli) continue;
      const anzeige = (istColli ? p.colli ?? p.logId : p.colli ?? key);
      const e = proKarton.get(key);
      if (e) e.anzahl += 1; else proKarton.set(key, { karton: anzeige, anzahl: 1 });
    }
    const kartons = [...proKarton.values()].sort((a, b) => a.karton.localeCompare(b.karton, "de", { numeric: true }));
    setFeedback({ kind: "vorabscan", hauptcolli, stellplatz, kartons });
    if (kartons.length > 0) playWagenTreffer(); else playWagenLeer();
    setEingabe("");
    inputRef.current?.focus({ preventScroll: true });
  }

  // Ein Scan: sofort auf dem Gerät auswerten, Funde in die Warteschlange.
  function verarbeiteScan(v: string) {
    if (!serverDaten) {
      vorLadenRef.current.push(v);
      setFeedback({ kind: "gemerkt", anzahl: vorLadenRef.current.length });
      return;
    }
    if (serverDaten.status !== "offen") {
      setSpeicherFehler("Dieser Auftrag ist schon abgeschlossen. Scans werden nicht gespeichert.");
      playNegativeSound();
      return;
    }
    setSpeicherFehler(null);
    const positionen = mitLokalenFunden(serverDaten.positionen, lokalRef.current, meinKuerzel);
    const urteil = werteScanAus({ roh: v, istColli: serverDaten.typ === "COLLI", positionen, hauptcollis: hauptcolliSet });

    if (urteil.art === "vorabscan") { handleVorabscan(urteil.hauptcolli); return; }
    if (urteil.art === "unbekannt") { meldeUnbekannt(urteil.wert); return; }
    if (urteil.art === "colli") {
      setFeedback({ kind: "colli", colliNummer: urteil.colliNummer, colliBekannt: urteil.colliBekannt, treffer: urteil.treffer, anzahlTreffer: urteil.treffer.length });
      if (urteil.treffer.length > 0) {
        playScanSound("GEFUNDEN");
        // Gesuchter Colli in der Hand → der Picker steht an dessen Stellplatz.
        const pos = positionen.find((x) => nurZiffern(x.logId) === urteil.treffer[0]!.logId);
        if (pos) wechselHalt(pos.stellplatz ?? "");
      } else {
        playNegativeSound();
        setNichtDazu((prev) => [{ art: "colli" as const, wert: urteil.colliNummer, zeit: new Date() }, ...prev].slice(0, 50));
      }
      return;
    }

    // Gerät (bzw. Colli im Colli-Auftrag)
    setFeedback({ kind: "logid", result: urteil.result, logId: urteil.logId, position: urteil.position as ScanPos | null });
    playScanSound(urteil.result);
    if (urteil.result === "FREMD") {
      setNichtDazu((prev) => [{ art: "logid" as const, wert: urteil.logId, zeit: new Date() }, ...prev].slice(0, 50));
      return;
    }
    // Wer hier scannt, steht hier — der Halt folgt ihm.
    if (urteil.position) wechselHalt(urteil.position.stellplatz ?? "");
    if (urteil.result === "GEFUNDEN") {
      const jetzt = Date.now();
      setzeLokal(urteil.logId, jetzt);
      setzeSchlange([...schlangeRef.current, { key: `${urteil.logId}-${jetzt}`, logId: urteil.logId, erfasstAm: jetzt, versuche: 0 }]);
      void sendeWeiterRef.current();
    }
  }

  // Was vor dem Laden gescannt wurde, jetzt nachholen.
  useEffect(() => {
    if (!serverDaten || vorLadenRef.current.length === 0) return;
    const liste = vorLadenRef.current;
    vorLadenRef.current = [];
    for (const v of liste) verarbeiteScan(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDaten]);

  function handleScan() {
    const v = eingabe.trim();
    // ⚠️ SOFORT leeren. Vorher erst nach der Server-Antwort — die Ziffern des
    // nächsten Scans hängten sich an die alten (18 Stellen → „nicht erkannt").
    setEingabe("");
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.focus({ preventScroll: true });
    if (!v) return;
    setVonHand(false);
    verarbeiteScan(v);
  }

  if (permsLoading) {
    return <div className="py-16 text-center text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfPick) {
    return (
      <div className="py-16 text-center text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff auf die Scan-Ansicht. Bitte das Recht <strong className="mx-1">PICKUP_PICK</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  return (
    // pb-24: Raum unter der Liste, damit der schwebende „↑ Nach oben"-Knopf die
    // letzte Karte nicht verdeckt — man kann sie darüber hinausscrollen.
    <div className="space-y-2 pb-24">
      <style jsx>{`
        .pickup-pulse { border-radius: 0.75rem; animation: pickupPulse 0.6s ease-out; }
        @keyframes pickupPulse {
          0%   { box-shadow: 0 0 0 0 var(--pulse, #00bcd4); }
          70%  { box-shadow: 0 0 0 10px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        .colli-toast { animation: colliToastIn 0.25s ease-out; }
        @keyframes colliToastIn {
          0%   { opacity: 0; transform: translate(-50%, -12px) scale(0.94); }
          100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
      `}</style>

      {/* "Colli/Stellplatz komplett"-Toast — nicht-blockierend, verschwindet von selbst. */}
      {colliToast && (
        <div
          role="status"
          aria-live="assertive"
          className="colli-toast fixed top-3 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md rounded-2xl border-2 px-5 py-4 shadow-2xl flex items-center gap-3"
          style={{ borderColor: "#04B475", background: "#04B475", color: "#fff" }}
        >
          <span className="text-3xl" aria-hidden>🎉</span>
          <div className="min-w-0">
            <div className="font-black text-base leading-tight">
              {istColli ? "Stellplatz" : "Colli"} {formatLogId(colliToast.key)} komplett!
            </div>
            <div className="text-sm opacity-90">
              Alle {colliToast.anzahl} {colliToast.anzahl === 1 ? "Gerät" : "Geräte"} gefunden.
            </div>
          </div>
        </div>
      )}

      {/* „Stellplatz fertig → weiter zu …" — ersetzt in diesem Moment den Colli-Toast. */}
      {haltToast && (
        <div
          role="status"
          aria-live="assertive"
          className="colli-toast fixed top-3 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md rounded-2xl border-2 px-5 py-4 shadow-2xl flex items-center gap-3"
          style={{ borderColor: "#04B475", background: "#04B475", color: "#fff" }}
        >
          <span className="text-3xl" aria-hidden>➡️</span>
          <div className="min-w-0">
            <div className="font-black text-base leading-tight">{haltToast.fertig || "Ohne Stellplatz"} erledigt</div>
            <div className="text-lg font-black font-mono">Weiter zu {haltToast.weiter || "ohne Stellplatz"}</div>
          </div>
        </div>
      )}

      {/* ── KOPF — scrollt mit der Seite mit (nicht mehr gepinnt) ── */}
      <div className="space-y-2">
        {/* Zeile: Zurück · Auftragsname · Aktion.
            Zurück stand vorher in einer eigenen 56-px-Zeile — Platz, der auf dem
            Handgerät für den nächsten Halt fehlt. Es bleibt BESCHRIFTET (ein
            „←" allein ging früher neben dem Titel unter).
            ⚠️ Das Ziel hängt am Recht: Wer verwaltet, will in die Admin-
            Übersicht; wer nur pickt, hätte dort keinen Zutritt (PICKUP_MANAGE). */}
        <div className="flex items-center gap-2">
          <Link
            href={has("PICKUP_MANAGE") ? "/admin/pickup" : "/pickup"}
            className="inline-flex items-center gap-1 px-3 rounded-lg border-2 border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#202F61] dark:text-[#e4e6eb] text-sm font-bold hover:border-[#008BD2] hover:text-[#008BD2] transition-colors min-h-[44px] flex-shrink-0"
          >
            <span aria-hidden>←</span> Liste
          </Link>
          <h1 className="flex-1 min-w-0 text-base font-black text-[#202F61] dark:text-[#e4e6eb] truncate">
            {isLoading ? "Lade…" : (data?.name ?? "Pickup")}
          </h1>
          {data && vollstaendig ? (
            <button
              onClick={() => setAbschlussDialog(true)}
              className="inline-flex items-center gap-1 px-4 rounded-lg bg-[#037A4F] text-white text-sm font-bold hover:bg-[#039c64] transition-colors min-h-[44px] flex-shrink-0"
            >
              ✓ Abschließen
            </button>
          ) : data && offen > 0 ? (
            <button
              onClick={() => setUnvollDialog(true)}
              className="inline-flex items-center px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-xs font-bold hover:bg-white dark:hover:bg-[#3e4042] transition-colors min-h-[44px] flex-shrink-0"
            >
              Nicht komplett
            </button>
          ) : null}
        </div>

        {data && (
          <>
            {data.bemerkung && (
              <div className="flex items-center gap-2 px-3 rounded-lg bg-[#008BD2]/10 text-[#202F61] dark:text-[#e4e6eb] text-sm font-semibold min-h-[44px]" title={data.bemerkung}>
                <span aria-hidden>📝</span>
                <span className="min-w-0 truncate">{data.bemerkung}</span>
              </div>
            )}

            {/* Fortschritt — dünn (keine große Karte) */}
            <div>
              <div className="flex items-baseline justify-between text-xs font-bold">
                <span style={vollstaendig ? { color: "#04713f" } : undefined} className={vollstaendig ? "" : "text-[#65676b] dark:text-[#b0b3b8]"}>
                  {vollstaendig ? "✓ Alles gefunden" : `${data.gefunden} von ${data.gesamt} gefunden`}
                </span>
                <span className="text-[#65676b] dark:text-[#b0b3b8]">{data.gesamt > 0 ? Math.round((data.gefunden / data.gesamt) * 100) : 0}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-[#e4e6eb] dark:bg-[#3e4042] overflow-hidden mt-1" role="progressbar" aria-label="Fortschritt" aria-valuenow={data.gefunden} aria-valuemin={0} aria-valuemax={data.gesamt}>
                <div className="h-full rounded-full transition-all" style={{ width: `${data.gesamt > 0 ? Math.round((data.gefunden / data.gesamt) * 100) : 0}%`, background: "#04B475" }} />
              </div>
            </div>

            {/* Nächster Halt — beantwortet zuerst „Wo gehe ich hin?". */}
            {!vollstaendig && aktuellerHalt !== null && (
              <NaechsterHaltKarte
                halt={aktuellerHalt}
                items={halteMap.get(aktuellerHalt) ?? []}
                istColli={!!istColli}
                anzahlHalte={weg.length}
                hauptOffen={weg.filter((k) => runden.haupt.has(k) && (offenJeHalt.get(k) ?? 0) > 0).length}
                restOffen={weg.filter((k) => !runden.haupt.has(k) && (offenJeHalt.get(k) ?? 0) > 0).length}
                inHauptrunde={runden.haupt.has(aktuellerHalt)}
                danach={danachHalt}
                farbe={aktivFarbe}
              />
            )}

          </>
        )}

            {/* Scan-Feld — IMMER da, auch während der Auftrag noch lädt (Scans
                werden dann gemerkt statt verloren). */}
            <form onSubmit={(e) => { e.preventDefault(); handleScan(); }} className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label htmlFor="scan-input" className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">
                  {istColli ? "Colli scannen" : "LogID scannen"}
                </label>
                <button
                  type="button"
                  onClick={() => { setVonHand((v) => !v); inputRef.current?.focus({ preventScroll: true }); }}
                  aria-pressed={vonHand}
                  className={`inline-flex items-center gap-1 px-3 rounded-lg border text-xs font-bold min-h-[44px] transition-colors ${
                    vonHand ? "text-white" : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"
                  }`}
                  style={vonHand ? { borderColor: aktivFarbe, background: aktivFarbe } : undefined}
                >
                  <span aria-hidden>⌨</span> {vonHand ? "Tastatur an" : "Von Hand"}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  id="scan-input"
                  ref={inputRef}
                  value={eingabe}
                  onChange={(e) => setEingabe(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  inputMode={tastatur ? "numeric" : "none"}
                  enterKeyHint="done"
                  spellCheck={false}
                  placeholder={istColli ? "Colli scannen…" : "Colli oder LogID scannen…"}
                  className="flex-1 min-w-0 px-4 rounded-xl border-2 bg-white dark:bg-[#18191a] text-2xl font-mono font-bold text-[#202F61] dark:text-[#e4e6eb] outline-none transition-colors min-h-[56px]"
                  style={{ borderColor: aktivFarbe }}
                />
                {tastatur && (
                  <button
                    type="submit"
                    disabled={!eingabe.trim()}
                    className="px-6 rounded-xl text-white text-base font-bold disabled:opacity-40 transition-colors min-h-[56px] min-w-[72px]"
                    style={{ background: aktivFarbe }}
                  >
                    OK
                  </button>
                )}
              </div>
              {/* Hilfe — standardmäßig eingeklappt, kostet so keinen Dauer-Platz */}
              {(hauptcolliMap.size > 0 || !istColli) && (
                <div>
                  <button
                    type="button"
                    onClick={() => setHilfeAuf((v) => !v)}
                    aria-expanded={hilfeAuf}
                    className="inline-flex items-center gap-1 min-h-[56px] px-2 text-xs font-bold text-[#008BD2] dark:text-[#45bdff] hover:underline"
                  >
                    <span aria-hidden>ⓘ</span> Hilfe <span aria-hidden>{hilfeAuf ? "▾" : "▸"}</span>
                  </button>
                  {hilfeAuf && (
                    <div className="space-y-1 pb-1">
                      {hauptcolliMap.size > 0 && (
                        <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                          🚛 Reihenfolge am Wagen: <strong>Hauptcolli</strong> scannen → du siehst, welche gesuchten Collis im Wagen liegen (hakt nichts ab) →
                          {istColli ? " diese Collis scannen." : " Colli öffnen, dann die LogIDs (9 Stellen) scannen."}
                        </p>
                      )}
                      {!istColli && (
                        <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                          ℹ️ Colli scannen (6–7 Stellen): Du hörst und siehst, ob ein gesuchtes Gerät drin ist.
                          Wenn ja, die LogIDs (9 Stellen) darin scannen. Die Prüfung nutzt die Daten dieses Auftrags.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </form>

            {/* „Zuletzt gescannt" — kompakte Statuszeile, pulst bei jedem Scan auf. */}
            <div
              key={pulseKey}
              className={pulseKey > 0 ? "pickup-pulse" : undefined}
              style={{ ["--pulse" as string]: pulseColor } as React.CSSProperties}
            >
              <ErgebnisBanner fb={feedback} istColli={!!istColli} />
            </div>

            {/* Noch nicht gespeichert — erst zeigen, wenn es wirklich hakt (sonst
                flackerte bei jedem Scan kurz „wird gespeichert"). */}
            {schlange.length > 0 && (sendeStatus !== "ok" || schlange.length >= 3) && (
              <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border-2 px-3 py-2 min-h-[56px]" style={{ borderColor: "#BA7517", background: "rgba(186,117,23,0.12)" }}>
                <span className="text-2xl" aria-hidden>⏳</span>
                <span className="text-base font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {sendeStatus === "anmelden"
                    ? `Abgemeldet — ${schlange.length} ${schlange.length === 1 ? "Scan wartet" : "Scans warten"}. Bitte neu anmelden, dann gehen sie raus.`
                    : `${schlange.length} ${schlange.length === 1 ? "Scan" : "Scans"} noch nicht gespeichert — wird wiederholt. Einfach weiterscannen.`}
                </span>
              </div>
            )}
            {speicherFehler && (
              <div role="alert" className="flex items-center gap-3 rounded-xl border-2 px-3 py-2 min-h-[56px]" style={{ borderColor: "#fa3e3e", background: "rgba(250,62,62,0.12)" }}>
                <span className="text-2xl" aria-hidden>✗</span>
                <span className="flex-1 min-w-0 text-base font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{speicherFehler}</span>
                <button
                  type="button"
                  onClick={() => setSpeicherFehler(null)}
                  className="px-4 rounded-lg border-2 border-[#fa3e3e] text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] min-h-[48px] flex-shrink-0"
                >
                  OK
                </button>
              </div>
            )}

        {data && (
          <>

            {/* Drei Bereiche — kompakt umschaltbar (Segmented Control) */}
            <div role="group" aria-label="Listen umschalten" className="grid grid-cols-3 gap-1.5">
              {([
                { k: "offen",    label: "Noch suchen",      n: offenePositionen.length,   farbe: "#BA7517" },
                { k: "gefunden", label: "Gefunden",         n: gefundenePositionen.length, farbe: "#04713f" },
                { k: "fremd",    label: "Gehört nicht dazu", n: nichtDazu.length,           farbe: "#b3261e" },
              ] as const).map(({ k, label, n, farbe }) => {
                const aktiv = ansicht === k;
                return (
                  <button
                    key={k}
                    aria-pressed={aktiv}
                    aria-label={`${label}: ${n}`}
                    onClick={() => setAnsicht(k)}
                    className={`rounded-xl border-2 px-2 py-2 min-h-[56px] flex flex-col items-center justify-center transition-colors ${aktiv ? "bg-white dark:bg-[#242526]" : "bg-transparent"}`}
                    style={{ borderColor: aktiv ? farbe : "#ced4da" }}
                  >
                    <span className="text-lg font-black leading-none" style={{ color: farbe }}>{n}</span>
                    <span className="text-[11px] font-bold text-center leading-tight mt-0.5 text-[#1a1a1a] dark:text-[#e4e6eb]">{label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── LISTE — normale Blockliste, scrollt mit dem Seiten-Body. Den Fokus
          aufs Scan-Feld holt der Fokus-Wächter oben zurück. */}
      <div>
        {error || (!isLoading && !data) ? (
          <div className="p-6 text-center space-y-3 bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042]">
            {/* ⚠️ Vorher stand bei JEDEM Ladefehler „Auftrag nicht gefunden." —
                auch wenn nur das WLAN weg war. */}
            {!error || error.data?.code === "NOT_FOUND" ? (
              <p className="text-base text-[#65676b] dark:text-[#b0b3b8]">Auftrag nicht gefunden.</p>
            ) : (
              <>
                <p className="text-lg font-black text-[#202F61] dark:text-[#e4e6eb]">Keine Verbindung zum Server.</p>
                <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb]">Scans werden gemerkt und später gespeichert.</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="px-6 rounded-xl bg-[#008BD2] text-white text-base font-bold min-h-[56px]"
                >
                  Nochmal laden
                </button>
              </>
            )}
          </div>
        ) : data ? (
          <>
            {ansicht === "offen" && (
              <>
                <HalteListe
                  weg={weg}
                  halte={halteMap}
                  aktuell={aktuellerHalt}
                  haupt={runden.haupt}
                  mitRunden={runden.haupt.size > 0 && runden.haupt.size < weg.length}
                  istColli={!!istColli}
                  leerText="Nichts zu picken."
                  onDetail={setDetail}
                />
              </>
            )}
            {ansicht === "gefunden" && (
              <PositionsListe gruppen={gruppenGefunden} istColli={!!istColli} leerText="Noch nichts gefunden." onDetail={setDetail} zeigeReset
                onReset={(positionId) => zuruecksetzen.mutate({ positionId })} resetBusy={zuruecksetzen.isPending} />
            )}
            {ansicht === "fremd" && (
              <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-3">
                {nichtDazu.length === 0 ? (
                  <p className="text-center text-[#65676b] dark:text-[#b0b3b8] py-4">Nichts Falsches gescannt.</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-[#b3261e]">✗ Gehört nicht dazu: {nichtDazu.length}</span>
                      <button onClick={() => setNichtDazu([])} className="text-xs text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e] min-h-[44px] px-2">Liste leeren</button>
                    </div>
                    <ul className="space-y-1.5">
                      {nichtDazu.slice(0, 30).map((f, i) => (
                        <li key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#fa3e3e]/10 text-[#b3261e]">
                          <span aria-hidden>{f.art === "colli" ? "🧭" : "🏷️"}</span>
                          <span className="font-mono font-bold">{f.wert ? formatLogId(f.wert) : "—"}</span>
                          <span className="text-xs ml-auto">{f.zeit.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Erfolgsmeldung → Redirect */}
      {abschlussErgebnis && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div role="status" aria-live="assertive" className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md px-6 py-8 text-center space-y-3">
            {abschlussErgebnis.nichtGefunden === 0 ? (
              <>
                <div className="text-5xl" aria-hidden>✅</div>
                <h2 className="font-black text-xl text-[#202F61] dark:text-[#e4e6eb]">Auftrag abgeschlossen</h2>
                <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb]">Alle {abschlussErgebnis.gesamt} Geräte gescannt.</p>
              </>
            ) : (
              <>
                <div className="text-5xl" aria-hidden>⚠️</div>
                <h2 className="font-black text-xl" style={{ color: "#BA7517" }}>Als nicht komplett gemeldet</h2>
                <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb]">{abschlussErgebnis.nichtGefunden} von {abschlussErgebnis.gesamt} fehlen.</p>
              </>
            )}
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Weiter zur Auftragsliste…</p>
          </div>
        </div>
      )}

      {/* Bestätigung: vollständig abschließen */}
      {abschlussDialog && !abschlussErgebnis && data && (
        <div role="dialog" aria-modal="true" aria-labelledby="pickup-voll-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => { if (!abschliessen.isPending) setAbschlussDialog(false); }}>
          <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 text-center space-y-3">
              <div className="text-4xl" aria-hidden>✓</div>
              <h2 id="pickup-voll-title" className="font-black text-lg text-[#202F61] dark:text-[#e4e6eb]">Auftrag abschließen?</h2>
              <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                <strong>{data.gefunden}</strong> von <strong>{data.gesamt}</strong> Geräten gefunden.
              </div>
            </div>
            <AbschlussHinweis offen={schlange.length} fehler={abschlussFehler} />
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setAbschlussDialog(false)} disabled={abschliessen.isPending}
                className="flex-1 text-sm text-[#65676b] dark:text-[#b0b3b8] font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[56px] disabled:opacity-50">
                Abbrechen
              </button>
              <button onClick={() => abschliessen.mutate({ id })} disabled={abschliessen.isPending || schlange.length > 0}
                className="flex-1 bg-[#037A4F] text-white text-sm font-bold rounded-xl hover:bg-[#039c64] disabled:opacity-50 transition-colors min-h-[56px]">
                {schlange.length > 0 ? "Speichere noch…" : abschliessen.isPending ? "Schließe ab…" : "Ja, abschließen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bestätigung: als nicht komplett melden */}
      {unvollDialog && !abschlussErgebnis && data && (() => {
        const fehlende = data.positionen
          .filter((p) => p.status !== "GEFUNDEN")
          .sort((a, b) => {
            const c = (a.colli ?? "").localeCompare(b.colli ?? "", "de", { numeric: true });
            if (c !== 0) return c;
            const s = (a.stellplatz ?? "").localeCompare(b.stellplatz ?? "", "de", { numeric: true });
            return s !== 0 ? s : a.logId.localeCompare(b.logId, "de", { numeric: true });
          });
        return (
          <div role="dialog" aria-modal="true" aria-labelledby="pickup-unvoll-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => { if (!abschliessen.isPending) setUnvollDialog(false); }}>
            <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-6 pb-3 space-y-2">
                <div className="text-4xl text-center" aria-hidden>⚠️</div>
                <h2 id="pickup-unvoll-title" className="font-black text-lg text-center text-[#202F61] dark:text-[#e4e6eb]">Auftrag als nicht komplett melden?</h2>
                <p className="text-sm text-center text-[#65676b] dark:text-[#b0b3b8]">Die fehlenden Geräte werden für den Admin festgehalten.</p>
                <div className="text-sm font-bold text-[#b3261e] pt-1">Diese {fehlende.length} Geräte fehlen:</div>
              </div>
              <div className="px-6 overflow-y-auto flex-1 min-h-[80px]">
                <div className="rounded-xl border border-[#fa3e3e]/30 overflow-hidden divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                  {fehlende.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2 flex-wrap gap-y-0.5 text-sm">
                      <span className="font-mono font-bold text-[#202F61] dark:text-[#e4e6eb] min-w-[100px]">{formatLogId(p.logId)}</span>
                      <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Colli {p.colli ?? "—"}</span>
                      <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{p.stellplatz ?? "—"}</span>
                      <span className="flex-1 min-w-0 truncate text-[#1a1a1a] dark:text-[#e4e6eb]" title={p.bezeichnung ?? ""}>{p.bezeichnung ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
              <AbschlussHinweis offen={schlange.length} fehler={abschlussFehler} />
              <div className="flex gap-3 px-6 py-5">
                <button onClick={() => setUnvollDialog(false)} disabled={abschliessen.isPending}
                  className="flex-1 text-sm text-[#65676b] dark:text-[#b0b3b8] font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[56px] disabled:opacity-50">
                  Abbrechen
                </button>
                <button onClick={() => abschliessen.mutate({ id })} disabled={abschliessen.isPending || schlange.length > 0}
                  className="flex-1 bg-[#BA7517] text-white text-sm font-bold rounded-xl hover:bg-[#9c6213] disabled:opacity-50 transition-colors min-h-[56px]">
                  {schlange.length > 0 ? "Speichere noch…" : abschliessen.isPending ? "Melde…" : "Als nicht komplett melden"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {weitUnten && !dialogOffen && (
        <button
          type="button"
          onClick={nachOben}
          aria-label="Nach oben zum Scan-Feld"
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-1.5 px-5 rounded-full text-white text-base font-black shadow-2xl min-h-[56px]"
          style={{ background: "#202F61", border: "2px solid #ffffff" }}
        >
          <span aria-hidden className="text-xl">↑</span> Nach oben
        </button>
      )}

      {/* Gerätedetails samt Bild — geöffnet durch Antippen einer Zeile. */}
      {detail && (
        <GeraetDetail pos={detail as PickupPos} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}

// ── Gruppierte Positions-Liste (für „Noch suchen" + „Gefunden") ────────────────
function PositionsListe({
  gruppen, istColli, leerText, zeigeReset, onReset, resetBusy, onDetail,
}: {
  gruppen: { key: string; items: ScanPos[] }[];
  istColli: boolean;
  leerText: string;
  zeigeReset?: boolean;
  onReset?: (positionId: number) => void;
  resetBusy?: boolean;
  /** Tippen auf eine Zeile öffnet die Gerätedetails samt Bild. */
  onDetail?: (p: ScanPos) => void;
}) {
  if (gruppen.length === 0) {
    return (
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-6 text-center text-[#65676b] dark:text-[#b0b3b8]">
        {leerText}
      </div>
    );
  }
  const leer = istColli ? "— (ohne Stellplatz)" : "— (ohne Colli)";
  return (
    <div className="space-y-3">
      {gruppen.map((g) => (
        <div key={g.key || "__ohne__"} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042]">
            <h2 className="font-black text-sm text-[#202F61] dark:text-[#e4e6eb]">{istColli ? "🧭 Stellplatz" : "📦 Colli"} {g.key || leer}</h2>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff]">{g.items.length}</span>
          </div>
          <div className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
            {g.items.map((p) => {
              const ok = p.status === "GEFUNDEN";
              return (
                <div key={p.id} className={`flex items-start gap-3 px-4 py-3 ${ok ? "bg-[#04B475]/5" : ""}`}>
                  <span className="text-lg w-6 text-center pt-0.5" aria-hidden>{ok ? "✓" : "○"}</span>
                  {/* LogID oben, Gerät DARUNTER in voller Breite. Vorher stand
                      die Bezeichnung daneben und war abgeschnitten — im Regal
                      ist aber genau sie das, wonach gesucht wird. */}
                  <button
                    onClick={() => onDetail?.(p)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="font-mono font-black text-base" style={{ color: ok ? "#04713f" : undefined }}>
                      {formatLogId(p.logId)}
                    </div>
                    <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] break-words leading-snug">
                      {p.bezeichnung ?? "—"}
                    </div>
                    <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                      {p.stellplatz ?? "ohne Stellplatz"} · Details ansehen ›
                    </div>
                  </button>
                  {ok && zeigeReset ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#04713f] font-semibold whitespace-nowrap">
                        {p.gefundenVonName ?? ""}{p.gefundenAm ? ` · ${fmtZeit(p.gefundenAm)}` : ""}
                      </span>
                      <button
                        onClick={() => onReset?.(p.id)}
                        disabled={resetBusy}
                        className="text-xs text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e] underline disabled:opacity-50 min-h-[44px] px-1"
                        aria-label={`Treffer ${formatLogId(p.logId)} zurücksetzen`}
                      >
                        Zurücksetzen
                      </button>
                    </div>
                  ) : !ok ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#65676b]/10 text-[#65676b] dark:text-[#b0b3b8]">Offen</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Karte „Nächster Halt" — die EINE Antwort auf „Wo gehe ich hin?" ──────────
function NaechsterHaltKarte({
  halt, items, istColli, anzahlHalte, hauptOffen, restOffen, inHauptrunde, danach, farbe,
}: {
  halt: string;
  items: ScanPos[];
  istColli: boolean;
  anzahlHalte: number;
  hauptOffen: number;
  restOffen: number;
  inHauptrunde: boolean;
  danach: string | null;
  farbe: string;
}) {
  const offene = items.filter((p) => p.status !== "GEFUNDEN");
  // Was liegt hier? Bei LogID-Aufträgen die Collis (mit Anzahl Geräte), bei
  // Colli-Aufträgen die gesuchten Collis selbst.
  const chips: { key: string; text: string; anzahl: number }[] = [];
  if (istColli) {
    for (const p of offene) chips.push({ key: p.logId, text: formatLogId(p.logId), anzahl: 1 });
  } else {
    const m = new Map<string, number>();
    for (const p of offene) m.set(p.colli ?? "", (m.get(p.colli ?? "") ?? 0) + 1);
    for (const [c, n] of [...m.entries()].sort((x, y) => x[0].localeCompare(y[0], "de", { numeric: true }))) {
      chips.push({ key: c || "__ohne__", text: c ? (formatLogId(nurZiffern(c)) || c) : "ohne Colli", anzahl: n });
    }
  }
  const einPlatz  = anzahlHalte === 1;
  const mitRunden = hauptOffen + restOffen > 0 && anzahlHalte >= 4;
  const ZEIGE = 8;

  return (
    <section
      aria-label="Nächster Halt"
      className="rounded-2xl border-2 bg-white dark:bg-[#242526] px-4 py-3"
      style={{ borderColor: farbe }}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] font-black uppercase tracking-wide">
        <span style={{ color: farbe }}>{einPlatz ? "Alles an einem Platz" : "Nächster Halt"}</span>
        {mitRunden && (
          <span className="text-[#65676b] dark:text-[#b0b3b8] normal-case tracking-normal font-bold text-xs">
            {inHauptrunde
              ? `Hauptrunde · noch ${hauptOffen} ${hauptOffen === 1 ? "Platz" : "Plätze"}`
              : `Restrunde · noch ${restOffen} ${restOffen === 1 ? "Platz" : "Plätze"}`}
          </span>
        )}
      </div>
      <div className="font-mono font-black text-3xl leading-tight text-[#202F61] dark:text-[#e4e6eb] break-all">
        📍 {halt || "ohne Stellplatz"}
      </div>
      <div className="text-base font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
        {istColli
          ? `${offene.length} ${offene.length === 1 ? "Colli" : "Collis"} hier holen`
          : `${chips.length} ${chips.length === 1 ? "Colli" : "Collis"} · ${offene.length} ${offene.length === 1 ? "Gerät" : "Geräte"}`}
      </div>
      {einPlatz && !istColli && chips.length === 1 && (
        <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">Einfach alles aus diesem Colli durchscannen.</div>
      )}
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={istColli ? "Gesuchte Collis hier" : "Collis an diesem Platz"}>
        {chips.slice(0, ZEIGE).map((c) => (
          <li key={c.key} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 bg-[#f0f2f5] dark:bg-[#18191a] font-mono font-bold text-base text-[#202F61] dark:text-[#e4e6eb]">
            <span aria-hidden>📦</span>{c.text}
            {!istColli && c.anzahl > 1 && <span className="font-sans text-xs text-[#65676b] dark:text-[#b0b3b8]">×{c.anzahl}</span>}
          </li>
        ))}
        {chips.length > ZEIGE && (
          <li className="inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-bold text-[#65676b] dark:text-[#b0b3b8]">
            +{chips.length - ZEIGE} weitere
          </li>
        )}
      </ul>
      {!einPlatz && (
        <div className="mt-2 text-xs font-bold text-[#65676b] dark:text-[#b0b3b8]">
          {danach !== null ? <>Danach: <span className="font-mono">{danach || "ohne Stellplatz"}</span></> : "Letzter Platz"}
          {" · "}Woanders anfangen? Einfach dort scannen.
        </div>
      )}
    </section>
  );
}

// ── Liste „Noch suchen" — Stellplätze in LAUFreihenfolge (nicht nach Menge). ──
//    Der aktuelle Halt ist aufgeklappt, alle anderen zu; fertige gedimmt. Die
//    Reihenfolge ist fest, beim Scannen springt nichts weg.
function HalteListe({
  weg, halte, aktuell, haupt, mitRunden, istColli, leerText, onDetail,
}: {
  weg: string[];
  halte: Map<string, ScanPos[]>;
  aktuell: string | null;
  haupt: Set<string>;
  mitRunden: boolean;
  istColli: boolean;
  leerText: string;
  onDetail?: (p: ScanPos) => void;
}) {
  if (halte.size === 0) {
    return (
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-6 text-center text-[#65676b] dark:text-[#b0b3b8]">
        {leerText}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {weg.map((key) => {
        const items = halte.get(key);
        if (!items || items.length === 0) return null;
        return (
          <HaltKarte
            key={key || "__ohne__"}
            halt={key}
            items={items}
            istAktuell={key === aktuell}
            restrunde={mitRunden && !haupt.has(key)}
            istColli={istColli}
            onDetail={onDetail}
          />
        );
      })}
    </div>
  );
}

function HaltKarte({
  halt, items, istAktuell, restrunde, istColli, onDetail,
}: {
  halt: string;
  items: ScanPos[];
  istAktuell: boolean;
  restrunde: boolean;
  istColli: boolean;
  onDetail?: (p: ScanPos) => void;
}) {
  const offen    = items.filter((p) => p.status !== "GEFUNDEN").length;
  const komplett = offen === 0;
  const [auf, setAuf] = useState(istAktuell);
  // Wird der Platz zum aktuellen Halt → aufklappen; ist er fertig → zuklappen.
  useEffect(() => { if (istAktuell) setAuf(true); }, [istAktuell]);
  const prevKomplett = useRef(komplett);
  useEffect(() => {
    if (komplett && !prevKomplett.current) setAuf(false);
    prevKomplett.current = komplett;
  }, [komplett]);

  const collis = useMemo(() => {
    if (istColli) return [];
    const m = new Map<string, ScanPos[]>();
    for (const p of items) {
      const k = p.colli ?? "";
      const arr = m.get(k);
      if (arr) arr.push(p); else m.set(k, [p]);
    }
    return [...m.entries()].sort((a, b) => {
      if (a[0] === "" || b[0] === "") return a[0] === "" ? 1 : -1;
      return a[0].localeCompare(b[0], "de", { numeric: true });
    });
  }, [items, istColli]);

  return (
    // ⚠️ Rahmenfarbe NICHT fest als Hellgrau setzen: Im dunklen Modus (Zebra)
    // wurden alle Karten dadurch fast weiß umrandet und der aktuelle Halt
    // stach nicht mehr heraus (Foto Frank, 23.09.2026).
    <div
      className={`rounded-2xl overflow-hidden transition-opacity ${
        istAktuell ? "border-2" : komplett ? "border opacity-60" : "border border-[#ced4da] dark:border-[#3e4042]"
      }`}
      style={istAktuell ? { borderColor: "#008BD2" } : komplett ? { borderColor: "rgba(4,180,117,0.4)" } : undefined}
    >
      <button
        type="button"
        onClick={() => setAuf((v) => !v)}
        aria-expanded={auf}
        className={`w-full flex items-center justify-between gap-2 px-4 min-h-[56px] py-2.5 text-left ${istAktuell ? "bg-[#008BD2]/10" : komplett ? "bg-[#04B475]/5" : "bg-[#f0f2f5] dark:bg-[#18191a]"}`}
      >
        <h2 className="font-black text-base text-[#202F61] dark:text-[#e4e6eb] flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-mono">📍 {halt || "ohne Stellplatz"}</span>
          {istAktuell && !komplett && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#008BD2] text-white">jetzt hier</span>
          )}
          {restrunde && !komplett && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#65676b]/15 text-[#65676b] dark:text-[#b0b3b8]">Rest</span>
          )}
          {komplett ? (
            <span className="text-sm text-[#04713f] font-bold whitespace-nowrap">✓ fertig</span>
          ) : (
            <span className="text-sm text-[#8A5A00] dark:text-[#f7b928] font-bold whitespace-nowrap">— {offen} offen</span>
          )}
        </h2>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff] whitespace-nowrap">
          {auf ? "▾" : "▸"} {items.length}
        </span>
      </button>
      {auf && (
        istColli ? (
          <div className="bg-white dark:bg-[#242526] divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
            {items.map((p) => <PositionZeile key={p.id} p={p} onDetail={onDetail} />)}
          </div>
        ) : (
          <div className="bg-white dark:bg-[#242526] p-2 space-y-2">
            {collis.map(([c, its]) => (
              <ColliKarte key={c || "__ohne__"} colliKey={c} items={its} istColli={false} onDetail={onDetail} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// Eine Geräte-/Colli-Zeile — von ColliKarte und HaltKarte gemeinsam genutzt.
function PositionZeile({ p, onDetail }: { p: ScanPos; onDetail?: (p: ScanPos) => void }) {
  const ok = p.status === "GEFUNDEN";
  return (
    <div className={`flex items-start gap-3 px-4 min-h-[56px] py-2.5 ${ok ? "bg-[#04B475]/5" : ""}`}>
      <span className="text-xl w-6 text-center pt-0.5" aria-hidden style={{ color: ok ? "#04713f" : undefined }}>{ok ? "✓" : "○"}</span>
      <button onClick={() => onDetail?.(p)} className="flex-1 min-w-0 text-left">
        <div className="font-mono font-black text-lg" style={{ color: ok ? "#04713f" : undefined }}>
          {formatLogId(p.logId)}
        </div>
        <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] break-words leading-snug">
          {p.bezeichnung ?? "—"}
        </div>
        <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
          {p.stellplatz ?? "ohne Stellplatz"} · Details ansehen ›
        </div>
      </button>
      {!ok && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#65676b]/10 text-[#65676b] dark:text-[#b0b3b8]">Offen</span>
      )}
    </div>
  );
}

function ColliKarte({ colliKey, items, istColli, onDetail }: { colliKey: string; items: ScanPos[]; istColli: boolean; onDetail?: (p: ScanPos) => void }) {
  const offen    = items.filter((p) => p.status !== "GEFUNDEN").length;
  const komplett = offen === 0;
  const [auf, setAuf] = useState(() => !komplett); // fertige Collis starten eingeklappt
  // Wird ein Colli beim Scannen fertig → automatisch einklappen (springt NICHT weg).
  const prevKomplett = useRef(komplett);
  useEffect(() => {
    if (komplett && !prevKomplett.current) setAuf(false);
    prevKomplett.current = komplett;
  }, [komplett]);

  const leer  = istColli ? "— (ohne Stellplatz)" : "— (ohne Colli)";
  const titel = istColli ? "🧭 Stellplatz" : "📦 Colli";

  return (
    <div className={`bg-white dark:bg-[#242526] rounded-2xl border shadow-sm overflow-hidden transition-opacity ${komplett ? "opacity-60 border-[#04B475]/40" : "border-[#ced4da] dark:border-[#3e4042]"}`}>
      <button
        type="button"
        onClick={() => setAuf((v) => !v)}
        aria-expanded={auf}
        className={`w-full flex items-center justify-between gap-2 px-4 min-h-[56px] py-2.5 border-b text-left ${komplett ? "bg-[#04B475]/5 border-[#04B475]/30" : "bg-[#f0f2f5] dark:bg-[#18191a] border-[#ced4da] dark:border-[#3e4042]"}`}
      >
        <h2 className="font-black text-sm text-[#202F61] dark:text-[#e4e6eb] flex items-center gap-2 min-w-0">
          <span className="truncate">{titel} {colliKey || leer}</span>
          {komplett ? (
            <span className="text-[#04713f] font-bold whitespace-nowrap">· ✓ komplett</span>
          ) : (
            <span className="text-[#BA7517] font-bold whitespace-nowrap">— {offen} offen</span>
          )}
        </h2>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff] whitespace-nowrap">
          {auf ? "▾" : "▸"} {items.length}
        </span>
      </button>
      {auf && (
        <div className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
          {items.map((p) => <PositionZeile key={p.id} p={p} onDetail={onDetail} />)}
        </div>
      )}
    </div>
  );
}

// Warum „Abschließen" gerade nicht geht — ungespeicherte Scans würden beim
// Abschließen verloren gehen (der Server nimmt danach nichts mehr an).
function AbschlussHinweis({ offen, fehler }: { offen: number; fehler: string | null }) {
  if (offen === 0 && !fehler) return null;
  return (
    <div className="px-6 pb-2 space-y-1" role="status" aria-live="polite">
      {offen > 0 && (
        <p className="text-sm font-bold text-[#8A5A00] dark:text-[#f7b928]">
          ⏳ {offen} {offen === 1 ? "Scan wird" : "Scans werden"} noch gespeichert — gleich geht es.
        </p>
      )}
      {fehler && <p className="text-sm font-bold text-[#b3261e] dark:text-[#ff6b6b]">✗ {fehler}</p>}
    </div>
  );
}
