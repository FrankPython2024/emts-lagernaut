"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/trpc/react";
import { formatLogId } from "@/lib/pickup/logId";
import { nurZiffern } from "@/lib/format/ziffern";
import { playScanSound, playComplete, playNegativeSound, playWagenTreffer, playWagenLeer, type ScanResult } from "@/lib/pickup/scanSound";
import { useScannerMode } from "@/lib/pickup/useScannerMode";
import { GeraeteUmschalter } from "@/components/pickup/ModusBanner";

// Farben wie ModusBanner: Blau = LogID-Auftrag, Violett = Colli-Auftrag.
// Status nie NUR über Farbe — immer zusätzlich Icon + Klartext.
const BLAU    = "#008BD2";
const VIOLETT = "#7c3aed";

// Auto-Erkennung der Scan-Art an der Ziffernlänge (kein Überlapp: LogIDs sind
// einheitlich 9-stellig, Collis 6–7-stellig). Leicht anpassbar.
const LOGID_LEN = 9;
const COLLI_MIN = 6;
const COLLI_MAX = 7;

type ScanPos = {
  id: number; logId: string; colli: string | null; stellplatz: string | null;
  bezeichnung: string | null; status: string; gefundenVonName: string | null; gefundenAm: Date | string | null;
};

// Einheitliches Ergebnis des letzten Scans — LogID-Scan ODER Colli-Prüfung.
type Feedback =
  | { kind: "logid"; result: ScanResult; logId: string; position: ScanPos | null }
  | { kind: "colli"; colliNummer: string; colliBekannt: boolean; treffer: { logId: string; bezeichnung: string | null }[]; anzahlTreffer: number }
  | { kind: "vorabscan"; hauptcolli: string; stellplatz: string | null; kartons: { karton: string; anzahl: number }[] }
  | { kind: "unbekannt"; wert: string };

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
              <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">Colli {formatLogId(fb.colliNummer)}</div>
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
              Colli {fb.colliNummer ? formatLogId(fb.colliNummer) : "—"}
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
  const [colliBusy, setColliBusy] = useState(false);
  // Sortierrichtung der Colli-Liste — in localStorage gemerkt (Default: meiste zuerst).
  const [sortDir, setSortDir]       = useState<"most" | "least">("most");
  // Eingefrorene Reihenfolge der Colli-Karten (nur bei Laden/Toggle/Typ neu).
  const [colliOrder, setColliOrder] = useState<string[]>([]);
  // Pulse-Trigger des „Zuletzt gescannt"-Banners (steigt bei jedem Scan).
  const [pulseKey, setPulseKey]     = useState(0);
  // Hilfe-Texte standardmäßig eingeklappt — kosten sonst dauerhaft Platz im Kopf.
  const [hilfeAuf, setHilfeAuf]     = useState(false);

  const { mode, setMode, onInputKeyDown } = useScannerMode();
  const tastatur = mode === "mobil";

  const [abschlussDialog, setAbschlussDialog] = useState(false);
  const [unvollDialog, setUnvollDialog]       = useState(false);
  const [abschlussErgebnis, setAbschlussErgebnis] = useState<{ name: string; gesamt: number; gefunden: number; nichtGefunden: number } | null>(null);
  const prevVollRef = useRef<boolean | null>(null);

  const abschliessen = api.pickup.abschliessen.useMutation({
    onSuccess: (r) => {
      setAbschlussErgebnis({ name: r.name, gesamt: r.gesamt, gefunden: r.gefunden, nichtGefunden: r.nichtGefunden });
      setTimeout(() => router.push("/pickup"), 1800);
    },
  });

  const { data, isLoading, error } = api.pickup.pickDetails.useQuery(
    { id },
    { enabled: !permsLoading && darfPick && Number.isInteger(id) && id > 0 },
  );

  const scan = api.pickup.scan.useMutation({
    onSuccess: (res, vars) => {
      setFeedback({ kind: "logid", result: res.result, logId: res.logId, position: res.position as ScanPos | null });
      playScanSound(res.result);
      if (res.result === "FREMD") {
        setNichtDazu((prev) => [{ art: "logid" as const, wert: res.logId || vars.logIdRaw, zeit: new Date() }, ...prev].slice(0, 50));
      }
      void utils.pickup.pickDetails.invalidate({ id });
    },
    onSettled: () => { setEingabe(""); inputRef.current?.focus(); },
  });

  const zuruecksetzen = api.pickup.treffersZuruecksetzen.useMutation({
    onSuccess: () => { void utils.pickup.pickDetails.invalidate({ id }); inputRef.current?.focus(); },
  });

  // Nach jedem Ergebnis Fokus zurück ins Scan-Feld (Handheld-tauglich).
  useEffect(() => { inputRef.current?.focus(); }, [feedback]);

  // Sortierrichtung beim Start aus localStorage laden, danach jede Änderung sichern.
  useEffect(() => {
    try {
      const v = localStorage.getItem("pickup_sort_dir");
      if (v === "least" || v === "most") setSortDir(v);
    } catch { /* localStorage nicht verfügbar */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("pickup_sort_dir", sortDir); } catch { /* ignore */ }
  }, [sortDir]);

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

  // Signatur der Colli-Schlüsselmenge — ändert sich NICHT beim bloßen Abhaken,
  // nur wenn Collis hinzukommen/wegfallen (Lade-/Typ-Wechsel).
  const colliKeysSig = useMemo(() => [...colliGruppen.keys()].sort().join("|"), [colliGruppen]);

  // Ref auf die aktuelle Gruppierung, damit der Order-Effekt die offenen Anzahlen
  // lesen kann, OHNE bei jedem Scan neu zu feuern.
  const colliGruppenRef = useRef(colliGruppen);
  colliGruppenRef.current = colliGruppen;

  // STABILE Reihenfolge: nur bei Laden, Toggle-Wechsel oder Auftragstyp-Wechsel
  // neu berechnen — NICHT live beim Scannen (Karten dürfen nicht wegspringen).
  // Fertige Collis (0 offen) wandern hier ans Ende.
  useEffect(() => {
    const m   = colliGruppenRef.current;
    const dir = sortDir === "most" ? -1 : 1;
    const offenVon = (k: string) => (m.get(k) ?? []).filter((p) => p.status !== "GEFUNDEN").length;
    const keys = [...m.keys()].sort((a, b) => {
      const oa = offenVon(a), ob = offenVon(b);
      const aDone = oa === 0, bDone = ob === 0;
      if (aDone !== bDone) return aDone ? 1 : -1;          // fertige Collis ans Ende
      if (oa !== ob)       return (oa - ob) * dir;          // nach Anzahl offener LogIDs
      if (a === "" || b === "") return a === "" ? 1 : -1;   // „ohne Colli" zuletzt
      return a.localeCompare(b, "de", { numeric: true });   // stabiler Tiebreak
    });
    setColliOrder(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colliKeysSig, sortDir, istColli]);

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

  async function pruefeColli(raw: string) {
    if (colliBusy) return;
    setColliBusy(true);
    try {
      const res = await utils.pickup.colliPruefen.fetch({ auftragId: id, colliNummer: raw });
      setFeedback({ kind: "colli", colliNummer: res.colliZiffern, colliBekannt: res.colliBekannt, treffer: res.treffer, anzahlTreffer: res.anzahlTreffer });
      if (res.anzahlTreffer > 0) {
        playScanSound("GEFUNDEN");
      } else {
        playNegativeSound();
        setNichtDazu((prev) => [{ art: "colli" as const, wert: res.colliZiffern || raw, zeit: new Date() }, ...prev].slice(0, 50));
      }
    } catch {
      playNegativeSound();
    } finally {
      setColliBusy(false);
      setEingabe("");
      inputRef.current?.focus();
    }
  }

  // Lokales Negativ-Feedback ohne Server (z. B. falsche Länge, klar fremd).
  function meldeUnbekannt(wert: string) {
    setFeedback({ kind: "unbekannt", wert });
    playNegativeSound();
    setEingabe("");
    inputRef.current?.focus();
  }
  function meldeNichtDazu(wert: string, art: "logid" | "colli") {
    setFeedback({ kind: "logid", result: "FREMD", logId: wert, position: null });
    playScanSound("FREMD");
    setNichtDazu((prev) => [{ art, wert, zeit: new Date() }, ...prev].slice(0, 50));
    setEingabe("");
    inputRef.current?.focus();
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
    inputRef.current?.focus();
  }

  // Auto-Routing: Scan-Art an der Ziffernlänge erkennen.
  function handleScan() {
    const v = eingabe.trim();
    if (!v) return;
    const ziffern = nurZiffern(v);
    const len = ziffern.length;

    if (istColli) {
      // Hauptcolli zuerst (Wagen-Vorabscan): Haupt- und Untercolli sind beide
      // 7-stellig → Unterscheidung NUR über die Lagerwagen-Tabelle, nie über die
      // Länge. Bekannter Hauptcolli → Wegweisung, hakt nichts ab.
      if (hauptcolliMap.has(ziffern)) { handleVorabscan(ziffern); return; }
      // Colli-Auftrag: 6–7 → Position-Match; 9 → gehört nicht dazu; sonst nicht erkannt.
      if (len >= COLLI_MIN && len <= COLLI_MAX) {
        if (!scan.isPending) scan.mutate({ auftragId: id, logIdRaw: v });
      } else if (len === LOGID_LEN) {
        meldeNichtDazu(ziffern, "logid");
      } else {
        meldeUnbekannt(ziffern);
      }
      return;
    }

    // LogID-Auftrag: 9 → LogID-Match; 6–7 → Hauptcolli-Vorabscan ODER Colli-Prüfung;
    // sonst nicht erkannt.
    if (len === LOGID_LEN) {
      if (!scan.isPending) scan.mutate({ auftragId: id, logIdRaw: v });
    } else if (len >= COLLI_MIN && len <= COLLI_MAX) {
      // Hauptcolli zuerst: Haupt- und Untercolli sind beide ~7-stellig → Unter-
      // scheidung NUR über die Lagerwagen-Tabelle. Bekannter Hauptcolli → Wagen-
      // Vorabscan (hakt nichts ab); sonst bisherige Colli-/Karton-Prüfung.
      if (hauptcolliMap.has(ziffern)) { handleVorabscan(ziffern); return; }
      pruefeColli(v);
    } else {
      meldeUnbekannt(ziffern);
    }
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
    <div className="flex flex-col h-[calc(100svh-4rem)] -mx-4 sm:-mx-6 -my-4 sm:-my-6">
      <style jsx>{`
        .pickup-pulse { border-radius: 0.75rem; animation: pickupPulse 0.6s ease-out; }
        @keyframes pickupPulse {
          0%   { box-shadow: 0 0 0 0 var(--pulse, #00bcd4); }
          70%  { box-shadow: 0 0 0 10px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>

      {/* ── FIXER KOPF (scrollt nicht) — so niedrig wie möglich ── */}
      <div className="shrink-0 px-4 sm:px-6 pt-3 pb-2 space-y-2 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042]">
        {/* Zeile: Zurück · Auftragsname · Aktion */}
        <div className="flex items-center gap-2">
          <Link href="/pickup" aria-label="Zurück zur Auftragsliste" className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-xl font-bold text-[#65676b] dark:text-[#b0b3b8] hover:text-[#008BD2] hover:bg-white dark:hover:bg-[#3e4042] transition-colors">←</Link>
          <h1 className="flex-1 min-w-0 text-base font-black text-[#202F61] dark:text-[#e4e6eb] truncate">
            {isLoading ? "Lade…" : (data?.name ?? "Pickup")}
          </h1>
          {data && vollstaendig ? (
            <button
              onClick={() => setAbschlussDialog(true)}
              className="inline-flex items-center gap-1 px-4 rounded-lg bg-[#04B475] text-white text-sm font-bold hover:bg-[#039c64] transition-colors min-h-[44px] flex-shrink-0"
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

            {/* Scan-Feld: Eingabe-Toggle (Handscanner/Mobil) + Feld + OK */}
            <form onSubmit={(e) => { e.preventDefault(); handleScan(); }} className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label htmlFor="scan-input" className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">
                  {istColli ? "Colli scannen" : "LogID scannen"}
                </label>
                <GeraeteUmschalter device={mode} onChange={(d) => { setMode(d); inputRef.current?.focus(); }} />
              </div>
              <div className="flex gap-2">
                <input
                  id="scan-input"
                  ref={inputRef}
                  value={eingabe}
                  onChange={(e) => setEingabe(e.target.value)}
                  onKeyDown={onInputKeyDown}
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
                    disabled={!eingabe.trim() || scan.isPending || colliBusy}
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
                          Wenn ja, die LogIDs (9 Stellen) darin scannen. Die Colli-Prüfung nutzt die Lagerfuchs-Daten (Stand: letzter Import).
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </form>

            {/* Sortierrichtung der Colli-Liste — Auswahl in localStorage gemerkt. */}
            <div role="group" aria-label="Sortierrichtung der Colli-Liste" className="grid grid-cols-2 gap-1.5">
              {([
                { k: "most",  label: "Meiste LogIDs zuerst" },
                { k: "least", label: "Wenigste zuerst" },
              ] as const).map(({ k, label }) => {
                const aktiv = sortDir === k;
                return (
                  <button
                    key={k}
                    aria-pressed={aktiv}
                    onClick={() => { setSortDir(k); inputRef.current?.focus(); }}
                    className={`rounded-xl border-2 px-3 min-h-[56px] text-xs font-bold transition-colors ${aktiv ? "bg-white dark:bg-[#242526] text-[#202F61] dark:text-[#e4e6eb]" : "bg-transparent text-[#65676b] dark:text-[#b0b3b8]"}`}
                    style={{ borderColor: aktiv ? "#008BD2" : "#ced4da" }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* „Zuletzt gescannt" — kompakte Statuszeile, pulst bei jedem Scan auf. */}
            <div
              key={pulseKey}
              className={pulseKey > 0 ? "pickup-pulse" : undefined}
              style={{ ["--pulse" as string]: pulseColor } as React.CSSProperties}
            >
              <ErgebnisBanner fb={feedback} istColli={!!istColli} />
            </div>

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

      {/* ── SCROLLENDE LISTE (füllt den Rest — nur sie scrollt) ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-3">
        {error || (!isLoading && !data) ? (
          <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8] bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042]">
            Auftrag nicht gefunden.
          </div>
        ) : data ? (
          <>
            {ansicht === "offen" && (
              <ColliListe order={colliOrder} groups={colliGruppen} istColli={!!istColli} leerText="Nichts zu picken." />
            )}
            {ansicht === "gefunden" && (
              <PositionsListe gruppen={gruppenGefunden} istColli={!!istColli} leerText="Noch nichts gefunden." zeigeReset
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
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setAbschlussDialog(false)} disabled={abschliessen.isPending}
                className="flex-1 text-sm text-[#65676b] dark:text-[#b0b3b8] font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[56px] disabled:opacity-50">
                Abbrechen
              </button>
              <button onClick={() => abschliessen.mutate({ id })} disabled={abschliessen.isPending}
                className="flex-1 bg-[#04B475] text-white text-sm font-bold rounded-xl hover:bg-[#039c64] disabled:opacity-50 transition-colors min-h-[56px]">
                {abschliessen.isPending ? "Schließe ab…" : "Ja, abschließen"}
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
              <div className="flex gap-3 px-6 py-5">
                <button onClick={() => setUnvollDialog(false)} disabled={abschliessen.isPending}
                  className="flex-1 text-sm text-[#65676b] dark:text-[#b0b3b8] font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[56px] disabled:opacity-50">
                  Abbrechen
                </button>
                <button onClick={() => abschliessen.mutate({ id })} disabled={abschliessen.isPending}
                  className="flex-1 bg-[#BA7517] text-white text-sm font-bold rounded-xl hover:bg-[#9c6213] disabled:opacity-50 transition-colors min-h-[56px]">
                  {abschliessen.isPending ? "Melde…" : "Als nicht komplett melden"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Gruppierte Positions-Liste (für „Noch suchen" + „Gefunden") ────────────────
function PositionsListe({
  gruppen, istColli, leerText, zeigeReset, onReset, resetBusy,
}: {
  gruppen: { key: string; items: ScanPos[] }[];
  istColli: boolean;
  leerText: string;
  zeigeReset?: boolean;
  onReset?: (positionId: number) => void;
  resetBusy?: boolean;
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
                <div key={p.id} className={`flex items-center gap-3 px-4 py-3 flex-wrap gap-y-1 ${ok ? "bg-[#04B475]/5" : ""}`}>
                  <span className="text-lg w-6 text-center" aria-hidden>{ok ? "✓" : "○"}</span>
                  <div className="font-mono font-black text-base min-w-[120px]" style={{ color: ok ? "#04713f" : undefined }}>
                    {formatLogId(p.logId)}
                  </div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[80px]">{p.stellplatz ?? "—"}</div>
                  <div className="flex-1 min-w-0 text-sm truncate" title={p.bezeichnung ?? ""}>{p.bezeichnung ?? "—"}</div>
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

// ── Colli-Liste für „Noch suchen" — gruppiert nach Colli (LogID-Auftrag) bzw.
//    Stellplatz (Colli-Auftrag), in der eingefrorenen `order`-Reihenfolge. Zeigt
//    ALLE Geräte eines Collis (gescannte grün abgehakt). Vollständig gepickte
//    Collis werden eingeklappt + abgedunkelt (Reihenfolge bleibt stabil). ──────
function ColliListe({
  order, groups, istColli, leerText,
}: {
  order: string[];
  groups: Map<string, ScanPos[]>;
  istColli: boolean;
  leerText: string;
}) {
  if (groups.size === 0) {
    return (
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-6 text-center text-[#65676b] dark:text-[#b0b3b8]">
        {leerText}
      </div>
    );
  }
  // `order` kann hinterherhängen (Erst-Render): fehlende/neue Keys ergänzen.
  const keys = order.filter((k) => groups.has(k));
  for (const k of groups.keys()) if (!keys.includes(k)) keys.push(k);
  return (
    <div className="space-y-3">
      {keys.map((key) => {
        const items = groups.get(key);
        if (!items || items.length === 0) return null;
        return <ColliKarte key={key || "__ohne__"} colliKey={key} items={items} istColli={istColli} />;
      })}
    </div>
  );
}

function ColliKarte({ colliKey, items, istColli }: { colliKey: string; items: ScanPos[]; istColli: boolean }) {
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
          {items.map((p) => {
            const ok = p.status === "GEFUNDEN";
            return (
              <div key={p.id} className={`flex items-center gap-3 px-4 min-h-[56px] py-2 flex-wrap gap-y-1 ${ok ? "bg-[#04B475]/5" : ""}`}>
                <span className="text-xl w-6 text-center" aria-hidden style={{ color: ok ? "#04713f" : undefined }}>{ok ? "✓" : "○"}</span>
                <div className="font-mono font-black text-lg min-w-[120px]" style={{ color: ok ? "#04713f" : undefined }}>
                  {formatLogId(p.logId)}
                </div>
                <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[80px]">{p.stellplatz ?? "—"}</div>
                <div className="flex-1 min-w-0 text-sm truncate" title={p.bezeichnung ?? ""}>{p.bezeichnung ?? "—"}</div>
                {!ok && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#65676b]/10 text-[#65676b] dark:text-[#b0b3b8]">Offen</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
