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

// ── „Zuletzt gescannt" — großer Block, IMMER Icon + Text + Farbe zugleich ──────
function ErgebnisBanner({ fb, istColli }: { fb: Feedback | null; istColli: boolean }) {
  if (!fb) {
    return (
      <div role="status" className="rounded-2xl border-2 border-dashed border-[#ced4da] dark:border-[#3e4042] p-5 text-center text-[#65676b] dark:text-[#b0b3b8] text-lg">
        Bereit zum Scannen…
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

  // ── LogID-Scan ──
  const p = fb.position;
  if (fb.result === "GEFUNDEN") {
    return (
      <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#04B475", background: "rgba(4,180,117,0.10)" }}>
        <div className="flex items-center gap-4">
          <span className="text-5xl" aria-hidden>✓</span>
          <div className="min-w-0">
            <div className="text-2xl font-black" style={{ color: "#04713f" }}>Gefunden</div>
            <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">{formatLogId(fb.logId)}</div>
            <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              {p?.bezeichnung ?? "—"} · Colli {p?.colli ?? "—"} · Stellplatz {p?.stellplatz ?? "—"}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (fb.result === "SCHON") {
    return (
      <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#BA7517", background: "rgba(186,117,23,0.10)" }}>
        <div className="flex items-center gap-4">
          <span className="text-5xl" aria-hidden>⚠</span>
          <div className="min-w-0">
            <div className="text-2xl font-black" style={{ color: "#BA7517" }}>Schon gefunden</div>
            <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">{formatLogId(fb.logId)}</div>
            <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              von {p?.gefundenVonName ?? "—"}{p?.gefundenAm ? `, ${fmtZeit(p.gefundenAm)}` : ""}
            </div>
          </div>
        </div>
      </div>
    );
  }
  // FREMD
  return (
    <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-5" style={{ borderColor: "#fa3e3e", background: "rgba(250,62,62,0.10)" }}>
      <div className="flex items-center gap-4">
        <span className="text-5xl" aria-hidden>✗</span>
        <div className="min-w-0">
          <div className="text-2xl font-black" style={{ color: "#b3261e" }}>Gehört nicht dazu</div>
          <div className="text-base font-bold text-[#202F61] dark:text-[#e4e6eb] font-mono">{fb.logId ? formatLogId(fb.logId) : "—"}</div>
        </div>
      </div>
    </div>
  );
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
  const gruppenOffen    = useMemo(() => gruppiere(offenePositionen, !!istColli), [offenePositionen, istColli]);
  const gruppenGefunden = useMemo(() => gruppiere(gefundenePositionen, !!istColli), [gefundenePositionen, istColli]);

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
    <div className="space-y-3">
      {/* Kopf — kompakt */}
      <div className="flex items-center justify-between gap-2">
        <Link href="/pickup" className="inline-flex items-center gap-1 text-[#65676b] dark:text-[#b0b3b8] hover:text-[#008BD2] text-sm font-semibold min-h-[44px]">← Aufträge</Link>
        {data && !vollstaendig && offen > 0 && (
          <button
            onClick={() => setUnvollDialog(true)}
            className="inline-flex items-center px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-xs font-bold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[44px]"
          >
            Nicht komplett melden
          </button>
        )}
      </div>

      <h1 className="text-xl font-black text-[#202F61] dark:text-[#e4e6eb] truncate">
        {isLoading ? "Lade…" : (data?.name ?? "Pickup")}
      </h1>
      {data?.bemerkung && (
        <div className="inline-flex items-start gap-2 px-3 py-2 rounded-xl bg-[#008BD2]/10 text-[#202F61] dark:text-[#e4e6eb] text-base font-semibold w-full">
          <span aria-hidden>📝</span>
          <span className="whitespace-pre-wrap break-words">{data.bemerkung}</span>
        </div>
      )}

      {error || (!isLoading && !data) ? (
        <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8] bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042]">
          Auftrag nicht gefunden.
        </div>
      ) : data ? (
        <>
          {/* Fortschritt — kompakt: „X von N gefunden" + Balken */}
          <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">
                {data.gefunden} <span className="text-[#65676b] dark:text-[#b0b3b8]">von</span> {data.gesamt}
              </span>
              <span className="text-sm font-bold uppercase tracking-wide text-[#65676b] dark:text-[#b0b3b8]">gefunden</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden mt-2" role="progressbar" aria-valuenow={data.gefunden} aria-valuemin={0} aria-valuemax={data.gesamt}>
              <div className="h-full rounded-full transition-all" style={{ width: `${data.gesamt > 0 ? Math.round((data.gefunden / data.gesamt) * 100) : 0}%`, background: "#04B475" }} />
            </div>
          </div>

          {/* Vollständig-Banner */}
          {vollstaendig && (
            <div role="status" aria-live="assertive" className="rounded-2xl border-2 p-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: "#04B475", background: "rgba(4,180,117,0.12)" }}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-4xl" aria-hidden>✅</span>
                <div className="min-w-0">
                  <div className="text-lg font-black" style={{ color: "#04713f" }}>Alles gefunden</div>
                  <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">Alle {data.gesamt} Geräte gescannt.</div>
                </div>
              </div>
              <button
                onClick={() => setAbschlussDialog(true)}
                className="inline-flex items-center gap-2 px-5 rounded-xl bg-[#04B475] text-white text-base font-bold hover:bg-[#039c64] transition-colors shadow-sm min-h-[56px] flex-shrink-0"
              >
                ✓ Auftrag abschließen
              </button>
            </div>
          )}

          {/* Modus-Indikator — Auftragstyp, Farbe + Icon + Text (nie nur Farbe) */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-white font-bold text-sm" style={{ background: aktivFarbe }} role="status">
            <span aria-hidden>{istColli ? "🧭" : "🏷️"}</span>
            <span>{istColli ? "Colli-Auftrag" : "LogID-Auftrag"}</span>
          </div>

          {/* Scan-Feld — eine Eingabe, Art wird automatisch erkannt */}
          <form onSubmit={(e) => { e.preventDefault(); handleScan(); }} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label htmlFor="scan-input" className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">
                {istColli ? "Colli scannen" : "Scannen"}
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
                className="flex-1 min-w-0 px-4 rounded-xl border-2 bg-[#f0f2f5] dark:bg-[#18191a] text-2xl font-mono font-bold text-[#202F61] dark:text-[#e4e6eb] outline-none transition-colors min-h-[56px]"
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
          </form>

          {/* „Zuletzt gescannt" */}
          <ErgebnisBanner fb={feedback} istColli={!!istColli} />

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

          {/* Bereich-Inhalt */}
          {ansicht === "offen" && (
            <PositionsListe gruppen={gruppenOffen} istColli={!!istColli} leerText="Nichts mehr offen – alles gefunden!" />
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
