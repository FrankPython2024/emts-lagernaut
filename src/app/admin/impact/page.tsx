"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";

const GRUEN = "#04B475";
const CYAN  = "#008BD2";

// Zur Veranschaulichung: kg CO2e ≈ km Autofahrt (grober Durchschnitt PKW).
const KG_CO2_PRO_KM_AUTO = 0.12;

const ZEITRAEUME: { label: string; tage: number | null }[] = [
  { label: "30 Tage",  tage: 30 },
  { label: "90 Tage",  tage: 90 },
  { label: "365 Tage", tage: 365 },
  { label: "Gesamt",   tage: null },
];

function fmt(n: number, dez = 0): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: dez, maximumFractionDigits: dez });
}
function euro(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}
// kg schön darstellen: ab 1000 kg in Tonnen.
function masse(kg: number): string {
  return kg >= 1000 ? `${fmt(kg / 1000, 2)} t` : `${fmt(kg, kg < 10 ? 1 : 0)} kg`;
}
function parseDe(s: string): number | null {
  const t = s.trim().replace(/\s/g, "");
  if (t === "") return null;
  const n = parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return isFinite(n) && n >= 0 ? n : NaN;
}
function fmtDe(n: number): string {
  return String(n).replace(".", ",");
}

export default function ImpactPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen = has("STATISTIK_VIEW");
  const { data: session } = useSession();
  const istAdmin = (session?.user as { rolle?: string } | undefined)?.rolle === "ADMIN";

  const [tage, setTage] = useState<number | null>(365);

  const kpiQ  = api.impact.kennzahlen.useQuery({ tage, standortId: null }, { enabled: darfSehen });
  const wertQ = api.preise.wertAusgegeben.useQuery({ tage, standortId: null }, { enabled: darfSehen });

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Kein Zugriff (Recht STATISTIK_VIEW fehlt).</div>;
  }

  const k = kpiQ.data;
  const materialwert = wertQ.data?.teileWert ?? 0;
  const kmAuto = k ? k.co2Kg / KG_CO2_PRO_KM_AUTO : 0;

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">🌱 Impact &amp; Nachhaltigkeit</h1>
        <p className="mt-1 text-base text-[#65676b] dark:text-[#b0b3b8]">
          Was eure Wiederverwendung von Ersatzteilen bewirkt: statt neu zu kaufen werden Teile aus
          Altgeräten weiterverwendet. Zahlen sind Schätzungen auf Basis <strong>anpassbarer Annahmen</strong>.
        </p>
      </header>

      {/* Zeitraum */}
      <div className="mb-5 flex flex-wrap gap-2">
        {ZEITRAEUME.map((z) => {
          const aktiv = z.tage === tage;
          return (
            <button
              key={z.label}
              onClick={() => setTage(z.tage)}
              className={`px-4 min-h-[44px] rounded-lg font-bold transition-colors ${
                aktiv ? "text-white" : "text-[#65676b] dark:text-[#b0b3b8] border-2 border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
              }`}
              style={aktiv ? { background: GRUEN } : undefined}
            >
              {z.label}
            </button>
          );
        })}
      </div>

      {kpiQ.isLoading || !k ? (
        <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Kennzahlen…</div>
      ) : (
        <>
          {/* Kacheln */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Kachel icon="🌍" akzent={GRUEN} wert={masse(k.co2Kg)} label="CO₂ eingespart"
              sub={k.co2Kg > 0 ? `≈ ${fmt(kmAuto)} km Autofahrt vermieden` : "—"} />
            <Kachel icon="♻️" akzent={CYAN} wert={masse(k.ewasteKg)} label="Elektroschrott vermieden"
              sub="durch Wiederverwendung statt Neukauf" />
            <Kachel icon="💶" akzent="#00a400" wert={euro(materialwert)} label="Eingesparter Materialwert"
              sub={wertQ.isLoading ? "…" : "über Kategorie-Preise"} />
            <Kachel icon="🔧" akzent="#202F61" wert={fmt(k.reusedParts)} label="Wiederverwendete Teile"
              sub="ausgegebene Ersatzteile (Ausgang + Direkt)" />
            <Kachel icon="💻" akzent="#f97316" wert={fmt(k.geraete)} label="Versorgte Geräte"
              sub="Geräte mit erledigter Anfrage" />
          </div>

          <p className="mt-4 text-xs text-[#90939a]">
            Grundlage: {fmt(k.reusedParts)} wiederverwendete Teile × Annahme {fmtDe(k.faktoren.co2ProTeilKg)} kg CO₂
            bzw. {fmtDe(k.faktoren.gewichtProTeilKg)} kg je Teil. Die km-Angabe dient nur der Veranschaulichung.
          </p>

          {/* Annahmen bearbeiten (nur Admin) */}
          <FaktorenBox
            istAdmin={istAdmin}
            co2={k.faktoren.co2ProTeilKg}
            gewicht={k.faktoren.gewichtProTeilKg}
            onGespeichert={() => { void kpiQ.refetch(); }}
          />
        </>
      )}
    </div>
  );
}

function Kachel({ icon, akzent, wert, label, sub }: {
  icon: string; akzent: string; wert: string; label: string; sub: string;
}) {
  return (
    <div className="rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl" aria-hidden>{icon}</span>
        <span className="text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">{label}</span>
      </div>
      <div className="text-3xl font-black tabular-nums" style={{ color: akzent }}>{wert}</div>
      <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">{sub}</div>
    </div>
  );
}

function FaktorenBox({ istAdmin, co2, gewicht, onGespeichert }: {
  istAdmin: boolean; co2: number; gewicht: number; onGespeichert: () => void;
}) {
  const { show } = useToast();
  const [co2Str, setCo2Str]         = useState(fmtDe(co2));
  const [gewichtStr, setGewichtStr] = useState(fmtDe(gewicht));
  useEffect(() => { setCo2Str(fmtDe(co2)); setGewichtStr(fmtDe(gewicht)); }, [co2, gewicht]);

  const setzen = api.impact.setFaktoren.useMutation({
    onSuccess: () => { show("✅ Annahmen gespeichert", "success"); onGespeichert(); },
    onError:   (e) => show(e.message, "error"),
  });

  const inputCls =
    "w-32 min-h-[44px] text-right rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#3a3b3c] px-3 py-2 text-base font-semibold text-[#202F61] dark:text-[#e4e6eb] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#04B475] disabled:opacity-50";

  function speichern() {
    const c = parseDe(co2Str);
    const g = parseDe(gewichtStr);
    if (c == null || Number.isNaN(c) || g == null || Number.isNaN(g)) {
      show("Bitte gültige Zahlen ≥ 0 eingeben (z.B. 5 oder 0,15).", "error");
      return;
    }
    setzen.mutate({ co2ProTeilKg: c, gewichtProTeilKg: g });
  }

  return (
    <div className="mt-6 rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] p-5">
      <h2 className="font-black text-base text-[#202F61] dark:text-[#e4e6eb]">⚙️ Annahmen je wiederverwendetem Teil</h2>
      <p className="mt-1 text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Diese Pauschal-Werte fließen in CO₂ und Elektroschrott ein. Setzt hier eure eigenen, belastbaren
        Zahlen ein — sie gelten rückwirkend für alle Auswertungen.
      </p>

      <div className="mt-4 flex flex-wrap gap-6">
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-1">CO₂ je Teil (kg)</span>
          <input type="text" inputMode="decimal" className={inputCls} value={co2Str} disabled={!istAdmin}
            onChange={(e) => setCo2Str(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-1">Gewicht je Teil (kg)</span>
          <input type="text" inputMode="decimal" className={inputCls} value={gewichtStr} disabled={!istAdmin}
            onChange={(e) => setGewichtStr(e.target.value)} />
        </label>
      </div>

      {istAdmin ? (
        <button
          onClick={speichern}
          disabled={setzen.isPending}
          className="mt-4 inline-flex items-center justify-center rounded-xl px-6 min-h-[48px] text-base font-black text-white shadow-sm disabled:opacity-40"
          style={{ background: GRUEN }}
        >
          {setzen.isPending ? "Speichert…" : "Annahmen speichern"}
        </button>
      ) : (
        <p className="mt-4 text-sm text-[#90939a]">Nur Admins dürfen die Annahmen ändern.</p>
      )}
    </div>
  );
}
