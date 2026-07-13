"use client";

import { useState, useEffect, useRef, type ChangeEvent } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { printVerbrauchsmaterialEtiketten } from "@/lib/print/verbrauchsmaterialEtikett";
import { printLagerplatzSchild } from "@/lib/print/lagerplatzSchild";

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
  hatBild:          boolean;
  bildStand:        number | null; // ms-Zeitstempel als Cache-Buster (null = kein Foto)
};

// Ausliefer-URL des TITELBILDs (kleinste position) inkl. Cache-Buster. null, wenn
// kein Foto hinterlegt ist. Für Liste-Thumbnail, A5-Schild, Info-Vorschau.
function bildUrl(a: Pick<Artikel, "id" | "hatBild" | "bildStand">): string | null {
  return a.hatBild ? `/api/verbrauchsmaterial/bild/${a.id}?v=${a.bildStand ?? 0}` : null;
}

// Ausliefer-URL eines EINZELNEN Galerie-Fotos (nach fotoId) inkl. Cache-Buster.
function fotoUrl(fotoId: number, stand: number): string {
  return `/api/verbrauchsmaterial/foto/${fotoId}?v=${stand}`;
}

// Ein Foto im Formular-Galerie-Zustand: entweder schon in der DB („vorhanden")
// oder frisch gewählt/aufgenommen und verkleinert („neu", noch nicht hochgeladen).
type FotoItem =
  | { key: string; kind: "vorhanden"; fotoId: number; stand: number }
  | { key: string; kind: "neu"; base64: string; mime: string; dataUrl: string };

function fotoItemSrc(f: FotoItem): string {
  return f.kind === "neu" ? f.dataUrl : fotoUrl(f.fotoId, f.stand);
}

// Foto client-seitig verkleinern (spart DB-Platz + Upload-Zeit): auf max. Kanten-
// länge skalieren, als JPEG exportieren. Liefert base64 (ohne data:-Präfix) für
// setzeBild + dataUrl für die sofortige Vorschau.
async function verkleinereBild(
  file: File, maxKante = 1600, qualitaet = 0.82,
): Promise<{ base64: string; mime: string; dataUrl: string }> {
  const bild = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild konnte nicht geladen werden")); };
    img.src = url;
  });
  const skala = Math.min(1, maxKante / Math.max(bild.width, bild.height));
  const w = Math.max(1, Math.round(bild.width * skala));
  const h = Math.max(1, Math.round(bild.height * skala));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas nicht verfügbar");
  ctx.drawImage(bild, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", qualitaet);
  const base64  = dataUrl.split(",")[1] ?? "";
  return { base64, mime: "image/jpeg", dataUrl };
}

export default function VerbrauchsmaterialPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfVerwalten = has("MATERIAL_MANAGE");

  const [suche, setSuche]         = useState("");
  const [kategorie, setKategorie] = useState("");
  const [standort, setStandort]   = useState("");
  const [zeigeInaktive, setZeigeInaktive] = useState(false);
  const [nurOhneFoto, setNurOhneFoto]     = useState(false);
  const [editArtikel, setEditArtikel]     = useState<Artikel | null>(null);
  const [infoArtikel, setInfoArtikel]     = useState<Artikel | null>(null);
  const [formOffen, setFormOffen]         = useState(false);
  const [auswahl, setAuswahl]             = useState<Set<number>>(new Set());

  const listeQ = api.verbrauchsmaterial.liste.useQuery(
    {
      suche:       suche.trim() || undefined,
      kategorie:   kategorie || undefined,
      standort:    standort || undefined,
      nurAktive:   !zeigeInaktive,
      nurOhneFoto,
    },
    { enabled: !permsLoading && has("MATERIAL_VIEW") },
  );
  const optionenQ = api.verbrauchsmaterial.filterOptionen.useQuery(undefined, {
    enabled: !permsLoading && has("MATERIAL_VIEW"),
  });
  const nachbQ = api.verbrauchsmaterial.nachbestellen.useQuery(undefined, {
    enabled: !permsLoading && has("MATERIAL_VIEW"),
  });
  const nachbestellAnzahl = nachbQ.data?.length ?? 0;
  const ohneFotoQ = api.verbrauchsmaterial.ohneFotoAnzahl.useQuery(undefined, {
    enabled: !permsLoading && has("MATERIAL_VIEW"),
  });
  const ohneFotoAnzahl = ohneFotoQ.data ?? 0;

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
  // A5-Lagerplatz-Schild (Foto + AAN + Beschreibung + Scan-QR) zum Aushängen.
  function schildDaten(a: Artikel) {
    return {
      code: a.code, name: a.name, merkmale: a.merkmale, aan: a.aan,
      standort: a.standort, kategorie: a.kategorie, bildUrl: bildUrl(a),
    };
  }
  function druckeSchild(a: Artikel) {
    void printLagerplatzSchild([schildDaten(a)]);
  }
  function druckeSchilderAuswahl() {
    const gewaehlt = artikel.filter((a) => auswahl.has(a.id));
    if (gewaehlt.length === 0) return;
    void printLagerplatzSchild(gewaehlt.map(schildDaten));
  }

  return (
    <div className="space-y-5">
      {/* Kopf */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb]">📦 Verbrauchsmaterial</h1>
            {nachbestellAnzahl > 0 && (
              <Link
                href="/admin/verbrauchsmaterial/auswertung"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-[#EF4444]/15 text-[#b3261e] hover:bg-[#EF4444]/25 transition-colors"
                title="Zur Nachbestell-Warnung"
              >
                ⚠️ {nachbestellAnzahl} nachzubestellen
              </Link>
            )}
            {ohneFotoAnzahl > 0 && (
              <button
                onClick={() => setNurOhneFoto((v) => !v)}
                aria-pressed={nurOhneFoto}
                title={nurOhneFoto ? "Filter aufheben" : "Nur Artikel ohne Foto zeigen"}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black transition-colors ${
                  nurOhneFoto
                    ? "bg-[#008BD2] text-white"
                    : "bg-[#008BD2]/15 text-[#0064d2] dark:text-[#45bdff] hover:bg-[#008BD2]/25"
                }`}
              >
                📷 {ohneFotoAnzahl} ohne Foto
              </button>
            )}
          </div>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Bestandsführung für Verbrauchsmaterial &amp; Kartonage. Status warnt bei Unterschreitung des Mindestbestands.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/admin/verbrauchsmaterial/auswertung"
            className="inline-flex items-center gap-2 px-4 rounded-lg font-bold text-[#202F61] dark:text-[#e4e6eb] border-2 border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[44px]"
          >
            📊 Auswertung
          </Link>
        {darfVerwalten && (
          <>
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
          </>
        )}
        </div>
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
        <label className="flex items-center gap-2 min-h-[44px] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={nurOhneFoto}
            onChange={(e) => setNurOhneFoto(e.target.checked)}
            className="w-5 h-5 accent-[#008BD2]"
          />
          <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Nur ohne Foto</span>
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
              onClick={druckeSchilderAuswahl}
              className="inline-flex items-center gap-2 px-5 rounded-lg font-bold text-[#202F61] dark:text-[#e4e6eb] border-2 border-[#008BD2]/40 hover:bg-[#008BD2]/10 min-h-[44px]"
            >
              📄 A5-Schilder ({auswahl.size})
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
                  <th scope="col" className="text-left py-2.5 px-4 font-bold">Foto</th>
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
                      <button
                        onClick={() => setInfoArtikel(a)}
                        title="Info anzeigen (AAN kopieren …)"
                        aria-label={`Info zu ${a.name} anzeigen`}
                        className="block rounded-lg hover:ring-2 hover:ring-[#008BD2]/40 focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
                      >
                        {a.hatBild ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={bildUrl(a) ?? ""}
                            alt={`Foto ${a.name}`}
                            loading="lazy"
                            className="w-11 h-11 rounded-lg object-cover border border-[#ced4da] dark:border-[#3e4042]"
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-[#b3261e]/15 text-[#b3261e] whitespace-nowrap">
                            📷 Kein Foto
                          </span>
                        )}
                      </button>
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
                        <button
                          onClick={() => druckeSchild(a)}
                          title="A5-Lagerplatz-Schild drucken (Foto, AAN, Beschreibung, Scan-Code)"
                          aria-label={`A5-Schild für ${a.name} drucken`}
                          className="px-3 rounded-lg text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] font-semibold min-h-[40px]"
                        >
                          📄 Schild
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
          onSaved={() => { setFormOffen(false); void listeQ.refetch(); void optionenQ.refetch(); void ohneFotoQ.refetch(); }}
        />
      )}

      {infoArtikel && (
        <ArtikelInfo
          artikel={infoArtikel}
          darfVerwalten={darfVerwalten}
          onClose={() => setInfoArtikel(null)}
          onBearbeiten={(a) => { setInfoArtikel(null); bearbeiten(a); }}
          onSchild={druckeSchild}
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

  // Foto-Galerie (Reihenfolge = Anzeige; erstes = Titelbild). Bestehende Fotos
  // werden beim Öffnen geladen; `ursprungIds` merkt sich, was in der DB war, um
  // beim Speichern Löschungen zu erkennen.
  const [fotos, setFotos]       = useState<FotoItem[]>([]);
  const [fotoBusy, setFotoBusy] = useState(false);
  const ursprungIds = useRef<number[]>([]);
  const neuCounter  = useRef(0);
  const geladen     = useRef(false);

  const fotosQ = api.verbrauchsmaterial.fotos.useQuery(
    { artikelId: artikel?.id ?? 0 },
    { enabled: !!artikel },
  );
  // Einmalig aus der DB in den Bearbeitungszustand übernehmen.
  useEffect(() => {
    if (geladen.current) return;
    if (!artikel) { geladen.current = true; return; } // neuer Artikel → leer
    if (fotosQ.data) {
      setFotos(fotosQ.data.map((f) => ({ key: `v${f.id}`, kind: "vorhanden" as const, fotoId: f.id, stand: f.stand })));
      ursprungIds.current = fotosQ.data.map((f) => f.id);
      geladen.current = true;
    }
  }, [artikel, fotosQ.data]);

  const anlegen        = api.verbrauchsmaterial.anlegen.useMutation();
  const bearbeiten     = api.verbrauchsmaterial.bearbeiten.useMutation();
  const fotoHinzufuegen = api.verbrauchsmaterial.fotoHinzufuegen.useMutation();
  const fotoLoeschen   = api.verbrauchsmaterial.fotoLoeschen.useMutation();
  const fotosNeuOrdnen = api.verbrauchsmaterial.fotosNeuOrdnen.useMutation();
  const isPending = anlegen.isPending || bearbeiten.isPending || fotoBusy
    || fotoHinzufuegen.isPending || fotoLoeschen.isPending || fotosNeuOrdnen.isPending;

  function toNum(s: string): number { const n = parseInt(s, 10); return Number.isFinite(n) && n > 0 ? n : 0; }

  // Eine oder mehrere Dateien wählen/aufnehmen → verkleinern → hinten anhängen.
  async function onDateienGewaehlt(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // erlaubt erneutes Wählen derselben Datei
    if (files.length === 0) return;
    setFotoBusy(true);
    try {
      for (const file of files) {
        const { base64, mime, dataUrl } = await verkleinereBild(file);
        neuCounter.current += 1;
        const key = `n${neuCounter.current}`;
        setFotos((prev) => [...prev, { key, kind: "neu", base64, mime, dataUrl }]);
      }
    } catch {
      show("Ein Bild konnte nicht verarbeitet werden.", "error");
    } finally {
      setFotoBusy(false);
    }
  }

  function fotoEntferne(idx: number) {
    setFotos((prev) => prev.filter((_, i) => i !== idx));
  }
  function fotoVerschiebe(idx: number, delta: number) {
    setFotos((prev) => {
      const j = idx + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }
  function fotoAlsTitel(idx: number) {
    setFotos((prev) => {
      if (idx <= 0) return prev;
      const next = [...prev];
      const [it] = next.splice(idx, 1);
      next.unshift(it);
      return next;
    });
  }

  async function speichern() {
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
    try {
      // 1) Stammdaten speichern (für „Neu" brauchen wir die frische id fürs Foto).
      let id: number;
      let msg: string;
      if (artikel) {
        await bearbeiten.mutateAsync({ id: artikel.id, ...felder });
        id = artikel.id; msg = "✅ Gespeichert";
      } else {
        const r = await anlegen.mutateAsync(felder);
        id = r.id; msg = `✅ Angelegt — Code ${r.code}`;
      }
      // 2) Fotos abgleichen:
      //    a) gelöschte bestehende Fotos entfernen
      const behalten = new Set(fotos.filter((f) => f.kind === "vorhanden").map((f) => f.fotoId));
      for (const del of ursprungIds.current) {
        if (!behalten.has(del)) await fotoLoeschen.mutateAsync({ fotoId: del });
      }
      //    b) finale Reihenfolge bauen; neue Fotos hochladen (in Reihenfolge)
      const finalIds: number[] = [];
      for (const f of fotos) {
        if (f.kind === "vorhanden") finalIds.push(f.fotoId);
        else {
          const r = await fotoHinzufuegen.mutateAsync({ id, mimeType: f.mime, dataBase64: f.base64 });
          finalIds.push(r.fotoId);
        }
      }
      //    c) Positionen 0..n setzen (erstes = Titelbild)
      if (finalIds.length > 0) await fotosNeuOrdnen.mutateAsync({ artikelId: id, reihenfolge: finalIds });

      show(msg, "success");
      onSaved();
    } catch (e) {
      show(e instanceof Error ? e.message : "Fehler beim Speichern", "error");
    }
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
          {/* Foto-Galerie — erstes Foto = Titelbild (Liste/A5-Schild). Kamera auf Handheld/Handy. */}
          <div className="sm:col-span-2">
            <span className={labelCls}>
              Fotos <span className="normal-case font-normal text-[#65676b] dark:text-[#b0b3b8]">— erstes = Titelbild</span>
            </span>
            <div className="flex flex-wrap gap-3">
              {fotos.map((f, idx) => (
                <div key={f.key} className="w-28">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fotoItemSrc(f)} alt="" className="w-28 h-28 rounded-lg object-cover border border-[#ced4da] dark:border-[#3e4042]" />
                    {idx === 0 && (
                      <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-black text-white" style={{ background: "#04B475" }}>★ Titel</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-center gap-1">
                    <button type="button" onClick={() => fotoAlsTitel(idx)} disabled={idx === 0} title="Als Titelbild"
                      className="w-8 h-8 rounded-md text-sm disabled:opacity-30 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">★</button>
                    <button type="button" onClick={() => fotoVerschiebe(idx, -1)} disabled={idx === 0} title="nach vorne"
                      className="w-8 h-8 rounded-md text-sm disabled:opacity-30 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">←</button>
                    <button type="button" onClick={() => fotoVerschiebe(idx, 1)} disabled={idx === fotos.length - 1} title="nach hinten"
                      className="w-8 h-8 rounded-md text-sm disabled:opacity-30 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">→</button>
                    <button type="button" onClick={() => fotoEntferne(idx)} title="entfernen"
                      className="w-8 h-8 rounded-md text-sm text-[#b3261e] hover:bg-[#b3261e]/10">✕</button>
                  </div>
                </div>
              ))}
              {/* Hinzufügen-Kachel (mehrere Dateien möglich) */}
              <label className={`w-28 h-28 rounded-lg border-2 border-dashed border-[#008BD2]/50 flex flex-col items-center justify-center cursor-pointer text-[#0064d2] dark:text-[#45bdff] hover:bg-[#008BD2]/5 ${fotoBusy ? "opacity-50 pointer-events-none" : ""}`}>
                <span className="text-3xl" aria-hidden>📷</span>
                <span className="text-xs font-bold mt-1">{fotoBusy ? "verkleinere…" : "Hinzufügen"}</span>
                <input type="file" accept="image/*" capture="environment" multiple onChange={onDateienGewaehlt} disabled={fotoBusy} className="sr-only" />
              </label>
            </div>
          </div>
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

// ── Artikel-Info (Klick aufs Foto) ───────────────────────────────────────────
// Kurz-Info mit großem Foto + Feldern; AAN und Code direkt per Klick in die
// Zwischenablage kopierbar. Rein Anzeige (alle Daten kommen aus der Listen-Zeile).

function ArtikelInfo({
  artikel, darfVerwalten, onClose, onBearbeiten, onSchild,
}: {
  artikel: Artikel;
  darfVerwalten: boolean;
  onClose: () => void;
  onBearbeiten: (a: Artikel) => void;
  onSchild: (a: Artikel) => void;
}) {
  const { show } = useToast();
  const fotosQ = api.verbrauchsmaterial.fotos.useQuery({ artikelId: artikel.id });
  const fotos = fotosQ.data ?? [];
  const [vollbildIdx, setVollbildIdx] = useState<number | null>(null);

  async function kopiere(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      show(`${label} kopiert: ${text}`, "success");
    } catch {
      show("Kopieren nicht möglich (Zwischenablage gesperrt)", "error");
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#ced4da] dark:border-[#3e4042] sticky top-0 bg-white dark:bg-[#242526]">
          <h2 className="font-black text-lg text-[#202F61] dark:text-[#e4e6eb]">Artikel-Info</h2>
          <button onClick={onClose} aria-label="Schließen" className="w-10 h-10 rounded-lg text-[#65676b] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">×</button>
        </div>

        <div className="p-5 space-y-4">
          {fotos.length > 0 ? (
            <div className="space-y-2">
              {/* Titelbild groß (Klick → bildschirmfüllend) */}
              <button
                type="button"
                onClick={() => setVollbildIdx(0)}
                title="Foto bildschirmfüllend anzeigen"
                className="block w-full cursor-zoom-in rounded-lg focus:outline-none focus:ring-2 focus:ring-[#008BD2]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fotoUrl(fotos[0].id, fotos[0].stand)} alt={`Foto ${artikel.name}`} className="w-full max-h-56 object-contain rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a]" />
              </button>
              {/* Weitere Fotos als Miniatur-Streifen */}
              {fotos.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {fotos.map((f, i) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setVollbildIdx(i)}
                      title={i === 0 ? "Titelbild" : "Foto anzeigen"}
                      className={`w-14 h-14 rounded-md overflow-hidden border-2 focus:outline-none focus:ring-2 focus:ring-[#008BD2] ${i === 0 ? "border-[#04B475]" : "border-[#ced4da] dark:border-[#3e4042]"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fotoUrl(f.id, f.stand)} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full h-28 rounded-lg border-2 border-dashed border-[#ced4da] dark:border-[#3e4042] flex items-center justify-center text-sm font-bold text-[#b3261e]">
              📷 Kein Foto hinterlegt
            </div>
          )}

          <div>
            <div className="text-xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">{artikel.name}</div>
            {artikel.merkmale && <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{artikel.merkmale}</div>}
          </div>

          <div className="space-y-2">
            <KopierZeile label="AAN"  wert={artikel.aan}  onKopiere={kopiere} />
            <KopierZeile label="Code" wert={artikel.code} onKopiere={kopiere} mono />
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <InfoFeld label="Kategorie"      wert={artikel.kategorie} />
            <InfoFeld label="Standort"       wert={artikel.standort} />
            <InfoFeld label="Bestand"        wert={String(artikel.aktuellerBestand)} />
            <InfoFeld label="Mindestbestand" wert={String(artikel.mindestbestand)} />
          </dl>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#ced4da] dark:border-[#3e4042] sticky bottom-0 bg-white dark:bg-[#242526]">
          <button
            onClick={() => onSchild(artikel)}
            className="px-4 rounded-lg border-2 border-[#008BD2]/40 text-[#0064d2] dark:text-[#45bdff] font-bold hover:bg-[#008BD2]/10 min-h-[44px]"
          >
            📄 Schild
          </button>
          {darfVerwalten && (
            <button
              onClick={() => onBearbeiten(artikel)}
              className="px-5 rounded-lg text-white font-bold min-h-[44px]"
              style={{ background: CYAN }}
            >
              Bearbeiten
            </button>
          )}
        </div>
      </div>
    </div>

    {/* Bildschirmfüllende Foto-Ansicht mit Blättern — Klick auf den Rand (oder ×) schließt. */}
    {vollbildIdx !== null && fotos[vollbildIdx] && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
        onClick={() => setVollbildIdx(null)}
        role="dialog"
        aria-label="Foto in voller Größe"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={fotoUrl(fotos[vollbildIdx].id, fotos[vollbildIdx].stand)}
          alt={`Foto ${artikel.name}`}
          className="max-w-full max-h-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />

        {fotos.length > 1 && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setVollbildIdx((i) => (i === null ? null : (i - 1 + fotos.length) % fotos.length)); }}
              aria-label="Vorheriges Foto"
              className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 text-white text-2xl font-bold hover:bg-white/25"
            >‹</button>
            <button
              onClick={(e) => { e.stopPropagation(); setVollbildIdx((i) => (i === null ? null : (i + 1) % fotos.length)); }}
              aria-label="Nächstes Foto"
              className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 text-white text-2xl font-bold hover:bg-white/25"
            >›</button>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/15 text-white text-sm font-bold">
              {vollbildIdx + 1} / {fotos.length}
            </div>
          </>
        )}

        <button
          onClick={() => setVollbildIdx(null)}
          aria-label="Schließen"
          className="absolute top-4 right-4 w-12 h-12 rounded-full bg-white/15 text-white text-2xl font-bold hover:bg-white/25"
        >
          ×
        </button>
      </div>
    )}
    </>
  );
}

// Feld mit Wert + „Kopieren"-Knopf (Zwischenablage). Ohne Wert: „—", kein Knopf.
function KopierZeile({
  label, wert, onKopiere, mono,
}: {
  label: string;
  wert: string | null;
  onKopiere: (text: string, label: string) => void;
  mono?: boolean;
}) {
  const t = wert?.trim() ?? "";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-[#f0f2f5] dark:bg-[#18191a] px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">{label}</div>
        <div className={`text-base font-bold text-[#1a1a1a] dark:text-[#e4e6eb] truncate ${mono ? "font-mono" : ""}`}>{t || "—"}</div>
      </div>
      {t && (
        <button
          onClick={() => onKopiere(t, label)}
          title={`${label} kopieren`}
          className="shrink-0 inline-flex items-center gap-1 px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#0064d2] dark:text-[#45bdff] font-semibold min-h-[40px] hover:bg-[#008BD2]/10"
        >
          📋 Kopieren
        </button>
      )}
    </div>
  );
}

function InfoFeld({ label, wert }: { label: string; wert: string | null }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">{label}</dt>
      <dd className="text-[#1a1a1a] dark:text-[#e4e6eb] mt-0.5">{wert && wert.trim() ? wert : "—"}</dd>
    </div>
  );
}
