"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { printVerbrauchsmaterialEtiketten } from "@/lib/print/verbrauchsmaterialEtikett";

const CYAN = "#008BD2";

type Artikel = {
  id:               number;
  code:             string;
  name:             string;
  merkmale:         string | null;
  kategorie:        string | null;
  mindestbestand:   number;
  aktuellerBestand: number;
  aan:              string | null;
  gebindegroesse:   number | null;
  standort:         string | null;
  bemerkung:        string | null;
  aktiv:            boolean;
  status:           "OK" | "NACHBESTELLEN";
};

export default function VerbrauchsmaterialPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfVerwalten = has("MATERIAL_MANAGE");

  const [suche, setSuche]         = useState("");
  const [kategorie, setKategorie] = useState("");
  const [standort, setStandort]   = useState("");
  const [zeigeInaktive, setZeigeInaktive] = useState(false);
  const [editArtikel, setEditArtikel]     = useState<Artikel | null>(null);
  const [formOffen, setFormOffen]         = useState(false);
  const [auswahl, setAuswahl]             = useState<Set<number>>(new Set());

  const listeQ = api.verbrauchsmaterial.liste.useQuery(
    {
      suche:     suche.trim() || undefined,
      kategorie: kategorie || undefined,
      standort:  standort || undefined,
      nurAktive: !zeigeInaktive,
    },
    { enabled: !permsLoading && has("MATERIAL_VIEW") },
  );
  const optionenQ = api.verbrauchsmaterial.filterOptionen.useQuery(undefined, {
    enabled: !permsLoading && has("MATERIAL_VIEW"),
  });

  if (permsLoading) return <PageLoader />;
  if (!has("MATERIAL_VIEW")) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>MATERIAL_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  const artikel = (listeQ.data ?? []) as Artikel[];

  function neu() { setEditArtikel(null); setFormOffen(true); }
  function bearbeiten(a: Artikel) { setEditArtikel(a); setFormOffen(true); }

  function toggle(id: number) {
    setAuswahl((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const alleGewaehlt = artikel.length > 0 && artikel.every((a) => auswahl.has(a.id));
  function toggleAlle() {
    setAuswahl(alleGewaehlt ? new Set() : new Set(artikel.map((a) => a.id)));
  }
  function druckeEinzeln(a: Artikel) {
    void printVerbrauchsmaterialEtiketten([{ code: a.code, name: a.name }]);
  }
  function druckeAuswahl() {
    const gewaehlt = artikel.filter((a) => auswahl.has(a.id));
    if (gewaehlt.length === 0) return;
    void printVerbrauchsmaterialEtiketten(gewaehlt.map((a) => ({ code: a.code, name: a.name })));
  }

  return (
    <div className="space-y-5">
      {/* Kopf */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">📦 Verbrauchsmaterial</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Bestandsführung für Verbrauchsmaterial &amp; Kartonage. Status warnt bei Unterschreitung des Mindestbestands.
          </p>
        </div>
        {darfVerwalten && (
          <div className="flex items-center gap-2">
            <Link
              href="/admin/verbrauchsmaterial/zaehlen"
              className="inline-flex items-center gap-2 px-4 rounded-lg font-bold text-white transition-colors min-h-[44px]"
              style={{ background: "#04B475" }}
            >
              📲 Zählen
            </Link>
            <Link
              href="/admin/verbrauchsmaterial/import"
              className="inline-flex items-center gap-2 px-4 rounded-lg font-bold text-[#008BD2] border-2 border-[#008BD2]/40 hover:bg-[#008BD2]/10 transition-colors min-h-[44px]"
            >
              📥 Excel-Import
            </Link>
            <button
              onClick={neu}
              className="inline-flex items-center gap-2 px-4 rounded-lg font-bold text-white transition-colors min-h-[44px]"
              style={{ background: CYAN }}
            >
              ＋ Neuer Artikel
            </button>
          </div>
        )}
      </div>

      {/* Filterleiste */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[200px] block">
          <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Suche</span>
          <input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Name, Merkmale, Code, AAN…"
            className="w-full px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[44px]"
          />
        </label>
        <label className="block w-44">
          <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Kategorie</span>
          <select
            value={kategorie}
            onChange={(e) => setKategorie(e.target.value)}
            className="w-full px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[44px]"
          >
            <option value="">Alle</option>
            {(optionenQ.data?.kategorien ?? []).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="block w-44">
          <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Standort</span>
          <select
            value={standort}
            onChange={(e) => setStandort(e.target.value)}
            className="w-full px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[44px]"
          >
            <option value="">Alle</option>
            {(optionenQ.data?.standorte ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 min-h-[44px] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={zeigeInaktive}
            onChange={(e) => setZeigeInaktive(e.target.checked)}
            className="w-5 h-5 accent-[#008BD2]"
          />
          <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Inaktive zeigen</span>
        </label>
      </div>

      {/* Bulk-Aktionen */}
      {auswahl.size > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-2xl border border-[#008BD2]/40 bg-[#008BD2]/5 px-4 py-3">
          <span className="text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">
            {auswahl.size} {auswahl.size === 1 ? "Artikel" : "Artikel"} gewählt
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAuswahl(new Set())}
              className="px-4 rounded-lg text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] min-h-[44px]"
            >
              Auswahl aufheben
            </button>
            <button
              onClick={druckeAuswahl}
              className="inline-flex items-center gap-2 px-5 rounded-lg font-bold text-white min-h-[44px]"
              style={{ background: CYAN }}
            >
              🏷️ Etiketten drucken ({auswahl.size})
            </button>
          </div>
        </div>
      )}

      {/* Tabelle */}
      <div className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
        {listeQ.isLoading ? (
          <div className="px-5 py-10 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lädt…</div>
        ) : artikel.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Keine Artikel gefunden. {darfVerwalten && "Neu anlegen oder per Excel importieren."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8]">
                <tr className="border-b border-[#ced4da] dark:border-[#3e4042]">
                  <th scope="col" className="w-10 py-2.5 px-4">
                    <input
                      type="checkbox"
                      checked={alleGewaehlt}
                      onChange={toggleAlle}
                      aria-label="Alle auswählen"
                      className="w-5 h-5 accent-[#008BD2] align-middle"
                    />
                  </th>
                  <th scope="col" className="text-left py-2.5 px-4 font-bold">Name</th>
                  <th scope="col" className="text-left py-2.5 px-4 font-bold">Kategorie</th>
                  <th scope="col" className="text-left py-2.5 px-4 font-bold">Standort</th>
                  <th scope="col" className="text-right py-2.5 px-4 font-bold">Bestand</th>
                  <th scope="col" className="text-right py-2.5 px-4 font-bold">Mindest</th>
                  <th scope="col" className="text-left py-2.5 px-4 font-bold">Status</th>
                  <th scope="col" className="text-left py-2.5 px-4 font-bold">Code</th>
                  <th scope="col" className="text-right py-2.5 px-4 font-bold">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {artikel.map((a) => (
                  <tr
                    key={a.id}
                    className={`border-b border-[#f0f2f5] dark:border-[#3e4042] ${a.aktiv ? "" : "opacity-50"} ${auswahl.has(a.id) ? "bg-[#008BD2]/5" : ""}`}
                  >
                    <td className="py-2.5 px-4">
                      <input
                        type="checkbox"
                        checked={auswahl.has(a.id)}
                        onChange={() => toggle(a.id)}
                        aria-label={`${a.name} auswählen`}
                        className="w-5 h-5 accent-[#008BD2] align-middle"
                      />
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{a.name}</div>
                      {a.merkmale && <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{a.merkmale}</div>}
                    </td>
                    <td className="py-2.5 px-4 text-[#65676b] dark:text-[#b0b3b8]">{a.kategorie ?? "—"}</td>
                    <td className="py-2.5 px-4 text-[#65676b] dark:text-[#b0b3b8]">{a.standort ?? "—"}</td>
                    <td className="py-2.5 px-4 text-right font-bold text-[#1a1a1a] dark:text-[#e4e6eb] tabular-nums">{a.aktuellerBestand}</td>
                    <td className="py-2.5 px-4 text-right text-[#65676b] dark:text-[#b0b3b8] tabular-nums">{a.mindestbestand}</td>
                    <td className="py-2.5 px-4"><StatusBadge status={a.status} /></td>
                    <td className="py-2.5 px-4 font-mono text-xs text-[#008BD2] dark:text-[#45bdff]">{a.code}</td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => druckeEinzeln(a)}
                          title="Etikett drucken"
                          aria-label={`Etikett für ${a.name} drucken`}
                          className="px-3 rounded-lg text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] font-semibold min-h-[40px]"
                        >
                          🏷️ Etikett
                        </button>
                        {darfVerwalten && (
                          <button
                            onClick={() => bearbeiten(a)}
                            className="px-3 rounded-lg text-[#0064d2] hover:bg-[#0064d2]/10 font-semibold min-h-[40px]"
                          >
                            Bearbeiten
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOffen && (
        <ArtikelForm
          artikel={editArtikel}
          onClose={() => setFormOffen(false)}
          onSaved={() => { setFormOffen(false); void listeQ.refetch(); void optionenQ.refetch(); }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: "OK" | "NACHBESTELLEN" }) {
  if (status === "OK") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-[#04B475]/15 text-[#04B475]">
        ✓ OK
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-[#b3261e]/15 text-[#b3261e]">
      ⚠ Nachbestellen
    </span>
  );
}

// ── Anlegen / Bearbeiten ─────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[56px]";
const labelCls = "block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider";

function ArtikelForm({
  artikel, onClose, onSaved,
}: {
  artikel: Artikel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { show } = useToast();
  const istNeu = !artikel;

  const [name, setName]                 = useState(artikel?.name ?? "");
  const [merkmale, setMerkmale]         = useState(artikel?.merkmale ?? "");
  const [kategorie, setKategorie]       = useState(artikel?.kategorie ?? "");
  const [standort, setStandort]         = useState(artikel?.standort ?? "");
  const [aan, setAan]                   = useState(artikel?.aan ?? "");
  const [mindestbestand, setMindest]    = useState(String(artikel?.mindestbestand ?? 0));
  const [aktuellerBestand, setBestand]  = useState(String(artikel?.aktuellerBestand ?? 0));
  const [gebindegroesse, setGebinde]    = useState(artikel?.gebindegroesse != null ? String(artikel.gebindegroesse) : "");
  const [bemerkung, setBemerkung]       = useState(artikel?.bemerkung ?? "");

  const anlegen = api.verbrauchsmaterial.anlegen.useMutation({
    onSuccess: (r) => { show(`✅ Angelegt — Code ${r.code}`, "success"); onSaved(); },
    onError:   (e) => show(e.message, "error"),
  });
  const bearbeiten = api.verbrauchsmaterial.bearbeiten.useMutation({
    onSuccess: () => { show("✅ Gespeichert", "success"); onSaved(); },
    onError:   (e) => show(e.message, "error"),
  });
  const isPending = anlegen.isPending || bearbeiten.isPending;

  function toNum(s: string): number { const n = parseInt(s, 10); return Number.isFinite(n) && n > 0 ? n : 0; }

  function speichern() {
    if (!name.trim()) { show("Name ist Pflicht.", "error"); return; }
    const felder = {
      name:             name.trim(),
      merkmale:         merkmale.trim() || null,
      kategorie:        kategorie.trim() || null,
      standort:         standort.trim() || null,
      aan:              aan.trim() || null,
      mindestbestand:   toNum(mindestbestand),
      aktuellerBestand: toNum(aktuellerBestand),
      gebindegroesse:   gebindegroesse.trim() ? toNum(gebindegroesse) : null,
      bemerkung:        bemerkung.trim() || null,
    };
    if (artikel) bearbeiten.mutate({ id: artikel.id, ...felder });
    else anlegen.mutate(felder);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#ced4da] dark:border-[#3e4042] sticky top-0 bg-white dark:bg-[#242526]">
          <h2 className="font-black text-lg text-[#202F61] dark:text-[#e4e6eb]">
            {istNeu ? "Neuer Artikel" : `Bearbeiten — ${artikel?.code}`}
          </h2>
          <button onClick={onClose} aria-label="Schließen" className="w-10 h-10 rounded-lg text-[#65676b] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">×</button>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="sm:col-span-2 block">
            <span className={labelCls}>Name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="z. B. Karton 600×400×400" />
          </label>
          <label className="sm:col-span-2 block">
            <span className={labelCls}>Merkmale</span>
            <input value={merkmale} onChange={(e) => setMerkmale(e.target.value)} className={inputCls} placeholder="z. B. doppelwellig" />
          </label>
          <label className="block">
            <span className={labelCls}>Kategorie</span>
            <input value={kategorie} onChange={(e) => setKategorie(e.target.value)} className={inputCls} placeholder="z. B. Kartonage" />
          </label>
          <label className="block">
            <span className={labelCls}>Standort</span>
            <input value={standort} onChange={(e) => setStandort(e.target.value)} className={inputCls} placeholder="z. B. Regal A3" />
          </label>
          <label className="block">
            <span className={labelCls}>Aktueller Bestand</span>
            <input type="number" inputMode="numeric" min={0} value={aktuellerBestand} onChange={(e) => setBestand(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Mindestbestand</span>
            <input type="number" inputMode="numeric" min={0} value={mindestbestand} onChange={(e) => setMindest(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>AAN</span>
            <input value={aan} onChange={(e) => setAan(e.target.value)} className={inputCls} placeholder="Artikelnummer" />
          </label>
          <label className="block">
            <span className={labelCls}>Gebindegröße (Stückzahl)</span>
            <input type="number" inputMode="numeric" min={0} value={gebindegroesse} onChange={(e) => setGebinde(e.target.value)} className={inputCls} placeholder="optional" />
          </label>
          <label className="sm:col-span-2 block">
            <span className={labelCls}>Bemerkung</span>
            <textarea value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} rows={3} className={inputCls.replace("min-h-[56px]", "min-h-[80px] py-2")} placeholder="optional" />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#ced4da] dark:border-[#3e4042] sticky bottom-0 bg-white dark:bg-[#242526]">
          <button onClick={onClose} className="px-5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] min-h-[48px]">
            Abbrechen
          </button>
          <button
            onClick={speichern}
            disabled={!name.trim() || isPending}
            className="px-6 rounded-lg text-white font-bold disabled:opacity-40 min-h-[48px]"
            style={{ background: CYAN }}
          >
            {isPending ? "Speichere…" : istNeu ? "Anlegen" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
