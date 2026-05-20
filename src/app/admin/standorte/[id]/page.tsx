"use client";
import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/trpc/react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";

// ── Typen ─────────────────────────────────────────────────────────────────────

type Regal = { name: string; ebenen: number; faecherProEbene: number };

const INPUT = "w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-cyan-400 transition";
const INPUT_SM = "px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-cyan-400 transition w-20 text-center";

// ── Regal-Zeile ───────────────────────────────────────────────────────────────

function RegalRow({
  regal, idx, kurzname, onChange, onRemove,
}: {
  regal:    Regal;
  idx:      number;
  kurzname: string;
  onChange: (idx: number, field: keyof Regal, val: string | number) => void;
  onRemove: (idx: number) => void;
}) {
  const total    = regal.ebenen * regal.faecherProEbene;
  const preview  = regal.name
    ? [`${kurzname}-${regal.name}-1-1`, `${kurzname}-${regal.name}-1-2`, `${kurzname}-${regal.name}-2-1`]
    : [];

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
            Regal-Name *
          </label>
          <input
            value={regal.name}
            onChange={(e) => onChange(idx, "name", e.target.value)}
            placeholder="7"
            maxLength={10}
            className={INPUT}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
            Ebenen
          </label>
          <input
            type="number"
            min={1} max={20}
            value={regal.ebenen}
            onChange={(e) => onChange(idx, "ebenen", Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
            className={INPUT_SM}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
            Fächer/Ebene
          </label>
          <input
            type="number"
            min={1} max={50}
            value={regal.faecherProEbene}
            onChange={(e) => onChange(idx, "faecherProEbene", Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
            className={INPUT_SM}
          />
        </div>
        <div className="flex items-end pb-0.5">
          <button
            onClick={() => onRemove(idx)}
            className="px-3 py-2.5 rounded-lg text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition min-h-[44px]"
          >
            Entfernen
          </button>
        </div>
      </div>

      {regal.name && (
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
          <div>
            <span className="font-semibold text-gray-700 dark:text-gray-300">→ {total} Lagerplätze</span>
            {preview.length > 0 && (
              <span className="ml-2 font-mono">{preview.join(", ")}…</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lagerstruktur-Tab ─────────────────────────────────────────────────────────

function LagerstrukturTab({ standortId, kurzname }: { standortId: number; kurzname: string }) {
  const { show } = useToast();
  const utils    = api.useUtils();

  const [regale,        setRegale]        = useState<Regal[]>([{ name: "", ebenen: 5, faecherProEbene: 5 }]);
  const [ueberschreiben, setUeberschreiben] = useState(false);
  const [bestaetigen,   setBestaetigen]   = useState(false);
  const [vorlageOpen,   setVorlageOpen]   = useState(false);

  // Bestehende Lagerplätze
  const vorhandenQ = api.lagerplatz.getRegalKonfig.useQuery({ standortId });
  const vorhanden  = vorhandenQ.data;

  // Andere Standorte für Vorlage
  const standorteQ = api.standort.list.useQuery();

  const total = useMemo(
    () => regale.reduce((s, r) => s + r.ebenen * r.faecherProEbene, 0),
    [regale],
  );

  const hatDoppelteNamen = useMemo(() => {
    const names = regale.map((r) => r.name.trim()).filter(Boolean);
    return names.length !== new Set(names).size;
  }, [regale]);

  const kannGenerieren =
    regale.length > 0 &&
    regale.every((r) => r.name.trim().length > 0) &&
    !hatDoppelteNamen &&
    total > 0 &&
    (vorhanden?.total === 0 || ueberschreiben);

  const generate = api.lagerplatz.generateForStandort.useMutation({
    onSuccess: (res) => {
      show(`✅ ${res.angelegt} Lagerplätze angelegt (z.B. ${res.beispielCodes.join(", ")})`, "success");
      setBestaetigen(false);
      void vorhandenQ.refetch();
      void utils.lagerplatz.uebersicht.invalidate();
    },
    onError: (e) => { show(`❌ ${e.message}`, "error"); setBestaetigen(false); },
  });

  const vorlage = api.lagerplatz.getRegalKonfig.useQuery(
    { standortId: vorlageOpen ? (standorteQ.data?.[0]?.id ?? 0) : 0 },
    { enabled: false },
  );

  function addRegal() {
    setRegale((r) => [...r, { name: "", ebenen: 5, faecherProEbene: 5 }]);
  }

  function changeRegal(idx: number, field: keyof Regal, val: string | number) {
    setRegale((r) => r.map((row, i) => i === idx ? { ...row, [field]: val } : row));
  }

  function removeRegal(idx: number) {
    setRegale((r) => r.filter((_, i) => i !== idx));
  }

  async function ladeVorlage(fromStandortId: number) {
    const res = await utils.lagerplatz.getRegalKonfig.fetch({ standortId: fromStandortId });
    if (res.regale.length > 0) {
      setRegale(res.regale);
      setVorlageOpen(false);
      show(`Vorlage geladen: ${res.regale.length} Regale`, "success");
    } else {
      show("Dieser Standort hat noch keine Lagerstruktur", "info");
    }
  }

  return (
    <div className="space-y-6">
      {/* Bestehende Struktur */}
      {vorhanden && vorhanden.total > 0 && (
        <div className={`p-4 rounded-xl border ${ueberschreiben ? "bg-orange-50 dark:bg-orange-900/10 border-orange-300 dark:border-orange-800" : "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800"}`}>
          <div className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-1">
            {vorhanden.total} Lagerplätze in {vorhanden.regale.length} Regalen vorhanden
          </div>
          <div className="text-xs text-blue-600 dark:text-blue-400 mb-3">
            {vorhanden.regale.map((r) => `Regal ${r.name}: ${r.ebenen} Ebenen × ${r.faecherProEbene} Fächer`).join(" · ")}
          </div>
          <label className="flex items-center gap-2 text-sm text-orange-700 dark:text-orange-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ueberschreiben}
              onChange={(e) => setUeberschreiben(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            Bestehende freie Plätze löschen und neu generieren (belegte Plätze werden geschützt)
          </label>
        </div>
      )}

      {/* Vorlage laden */}
      {standorteQ.data && standorteQ.data.filter(s => s.id !== standortId).length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">Vorlage von:</span>
          <select
            className="px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-cyan-400 transition"
            defaultValue=""
            onChange={(e) => { if (e.target.value) ladeVorlage(Number(e.target.value)); }}
          >
            <option value="">— Vorlage laden —</option>
            {standorteQ.data.filter(s => s.id !== standortId).map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.kurzname})</option>
            ))}
          </select>
        </div>
      )}

      {/* Regal-Editor */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Regale konfigurieren
          </h3>
          <button
            onClick={addRegal}
            className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 hover:text-cyan-700 dark:hover:text-cyan-300 transition min-h-[44px]"
          >
            + Regal hinzufügen
          </button>
        </div>

        {regale.length === 0 && (
          <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">
            Noch keine Regale konfiguriert. Klicke „+ Regal hinzufügen".
          </div>
        )}

        {regale.map((regal, idx) => (
          <RegalRow
            key={idx}
            regal={regal}
            idx={idx}
            kurzname={kurzname}
            onChange={changeRegal}
            onRemove={removeRegal}
          />
        ))}
      </div>

      {hatDoppelteNamen && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          ⚠️ Doppelte Regal-Namen — bitte eindeutige Namen vergeben.
        </div>
      )}

      {/* Gesamt-Info */}
      {regale.length > 0 && (
        <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Gesamt: <span className="text-cyan-600 dark:text-cyan-400">{total.toLocaleString("de-DE")}</span> Lagerplätze werden erzeugt
          </div>
          {total > 10_000 && (
            <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              ⚠️ Sehr viele Plätze — bitte Konfiguration prüfen.
            </div>
          )}
        </div>
      )}

      {/* Generieren-Button */}
      {!bestaetigen ? (
        <button
          disabled={!kannGenerieren}
          onClick={() => setBestaetigen(true)}
          className="w-full px-4 py-3 rounded-xl text-sm font-bold bg-cyan-500 hover:bg-cyan-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition min-h-[48px]"
        >
          Lagerstruktur generieren
        </button>
      ) : (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-300 dark:border-amber-700 space-y-3">
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            {total.toLocaleString("de-DE")} Lagerplätze werden angelegt. Fortfahren?
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => generate.mutate({ standortId, regale, ueberschreiben })}
              disabled={generate.isPending}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold bg-cyan-500 hover:bg-cyan-600 text-white disabled:opacity-50 transition min-h-[44px]"
            >
              {generate.isPending ? "Generiert…" : "Ja, generieren"}
            </button>
            <button
              onClick={() => setBestaetigen(false)}
              className="px-4 py-2.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition min-h-[44px]"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Allgemein-Tab ─────────────────────────────────────────────────────────────

function AllgemeinTab({ standort }: { standort: { id: number; name: string; kurzname: string; aktiv: boolean; adresse?: string | null } }) {
  const { show } = useToast();
  const utils    = api.useUtils();

  const [form, setForm] = useState({
    name:    standort.name,
    kurzname: standort.kurzname,
    adresse: standort.adresse ?? "",
  });

  const update = api.standort.update.useMutation({
    onSuccess: () => { show("✅ Gespeichert", "success"); void utils.standort.list.invalidate(); },
    onError:   (e) => show(`❌ ${e.message}`, "error"),
  });

  const INPUT_CLS = "w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-cyan-400 transition";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate({ id: standort.id, name: form.name.trim(), kurzname: form.kurzname.trim().toUpperCase(), adresse: form.adresse.trim() || undefined });
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-lg">
      <div>
        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Name *</label>
        <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required maxLength={100} className={INPUT_CLS} />
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Kurzname * (2–10 Zeichen)</label>
        <input value={form.kurzname} onChange={(e) => setForm(f => ({ ...f, kurzname: e.target.value.toUpperCase() }))} required minLength={2} maxLength={10} className={INPUT_CLS} />
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Adresse</label>
        <input value={form.adresse} onChange={(e) => setForm(f => ({ ...f, adresse: e.target.value }))} maxLength={500} placeholder="Musterstraße 1" className={INPUT_CLS} />
      </div>
      <button type="submit" disabled={update.isPending} className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-cyan-500 hover:bg-cyan-600 text-white disabled:opacity-50 transition min-h-[44px]">
        {update.isPending ? "Speichert…" : "Speichern"}
      </button>
    </form>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StandortDetailPage() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const standortId  = Number(params?.id);
  const [tab, setTab] = useState<"allgemein" | "lagerstruktur">("lagerstruktur");

  const { data: standort, isLoading } = api.standort.byId.useQuery(
    { id: standortId },
    { enabled: !isNaN(standortId) },
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse bg-gray-100 dark:bg-gray-800 rounded" />
        <div className="h-64 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-xl" />
      </div>
    );
  }

  if (!standort) {
    return (
      <div className="text-center py-20 text-gray-400">
        <div className="text-4xl mb-4">🏭</div>
        <div className="font-semibold">Standort nicht gefunden</div>
        <Link href="/admin/standorte" className="mt-4 inline-block text-cyan-500 hover:underline text-sm">← Zurück zur Übersicht</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={standort.name}
        subtitle={`Kurzname: ${standort.kurzname}${(standort as { adresse?: string | null }).adresse ? ` · ${(standort as { adresse?: string | null }).adresse}` : ""}`}
        action={
          <Link href="/admin/standorte" className="px-4 py-2.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition min-h-[44px] inline-flex items-center">
            ← Zurück
          </Link>
        }
      />

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800">
        {(["lagerstruktur", "allgemein"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition ${
              tab === t
                ? "border-cyan-500 text-cyan-600 dark:text-cyan-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {t === "lagerstruktur" ? "Lagerstruktur" : "Allgemein"}
          </button>
        ))}
      </div>

      <div>
        {tab === "allgemein" && (
          <AllgemeinTab standort={standort as { id: number; name: string; kurzname: string; aktiv: boolean; adresse?: string | null }} />
        )}
        {tab === "lagerstruktur" && (
          <LagerstrukturTab standortId={standortId} kurzname={standort.kurzname} />
        )}
      </div>
    </div>
  );
}
