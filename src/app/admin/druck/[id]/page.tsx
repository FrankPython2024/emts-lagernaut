"use client";

// ── 3D-Druck: Vorlage anlegen / bearbeiten ───────────────────────────────────
// /admin/druck/neu legt an (optional vorbelegt aus der Druckliste:
// ?key=&anzeige=&teiltyp=), /admin/druck/<id> bearbeitet.
// Foto und Dateien gibt es erst nach dem ersten Speichern — sie hängen an der Id.
//
// Paket 2: „Druck fertig" bucht die gedruckten Stück als EINGANG (3D-Druck) auf
// einen Artikel der zugeordneten Geräte; das Druckprotokoll steht darunter.
//
// ⚠️ Formular-Falle 1 (CLAUDE.md): Nachgeladene Daten füllen das Formular nur
// EINMAL. Danach gehört es dem Menschen — ein Neuladen nach dem Hochladen einer
// Datei darf keine halb getippte Eingabe überschreiben.

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { DATEI_ART_TEXT, DATEI_MAX_BYTES, dateiArt, type DateiArt } from "@/lib/druck/druckliste";
import { DruckenKnopf } from "@/components/druck/DruckenKnopf";
import { DruckerStatus } from "@/components/druck/DruckerStatus";

type Modell = { key: string; anzeige: string };

const feld = "w-full px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#202F61] dark:text-[#e4e6eb] text-base outline-none focus:border-[#008BD2] min-h-[56px]";
const label = "block text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] mb-1";
const karte = "bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-5 space-y-4";
const knopfBlau = "inline-flex items-center justify-center gap-2 px-5 rounded-xl bg-[#008BD2] text-white text-sm font-bold hover:bg-[#0077b5] transition-colors min-h-[56px] disabled:opacity-50";
const knopfRand = "inline-flex items-center justify-center gap-2 px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] text-sm font-bold hover:border-[#008BD2] transition-colors min-h-[48px] disabled:opacity-50";
const MATERIALIEN = ["PETG", "PLA", "TPU", "ASA", "ABS"];
const ART_FARBE: Record<DateiArt, string> = {
  DRUCK:   "bg-[#04B475]/15 text-[#037A4F] dark:text-[#3ddc97]",
  PROJEKT: "bg-[#008BD2]/10 text-[#0064d2] dark:text-[#45bdff]",
  QUELLE:  "bg-[#65676b]/15 text-[#4b4f56] dark:text-[#b0b3b8]",
};

function fmtGroesse(b: number): string {
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}
function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
const zahlOderNull = (s: string): number | null => {
  const n = Number(s.replace(",", "."));
  return s.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** Foto im Browser verkleinern (max 1600 px, JPEG) → base64 ohne Präfix. */
async function fotoAlsBase64(datei: File): Promise<string> {
  const bild = await createImageBitmap(datei);
  const f = Math.min(1, 1600 / Math.max(bild.width, bild.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bild.width * f);
  c.height = Math.round(bild.height * f);
  c.getContext("2d")!.drawImage(bild, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).replace(/^data:[^;]+;base64,/, "");
}

export default function DruckVorlageSeite() {
  return (
    <Suspense fallback={<div className="p-6 text-[#65676b] dark:text-[#b0b3b8]">Lade…</div>}>
      <DruckVorlageInhalt />
    </Suspense>
  );
}

function DruckVorlageInhalt() {
  const params = useParams<{ id: string }>();
  const neu = params?.id === "neu";
  const id = neu ? null : Number(params?.id);
  const router = useRouter();
  const sp = useSearchParams();
  const { show } = useToast();
  const utils = api.useUtils();
  const { has, isLoading: permsLoading } = usePermissions();
  const darfPflegen = has("ARTIKEL_EDIT");
  const darfEinbuchen = has("ARTIKEL_EINLAGERN");

  const details = api.druck.details.useQuery({ id: id ?? 0 }, { enabled: !!id && !permsLoading });
  const teiltypenQ = api.druck.teiltypen.useQuery(undefined, { enabled: !permsLoading, staleTime: 300_000 });

  const [name, setName] = useState("");
  const [teiltypen, setTeiltypen] = useState<string[]>(["Füße vorne"]);
  const [stueck, setStueck] = useState("");
  const [stunden, setStunden] = useState("");
  const [minuten, setMinuten] = useState("");
  const [material, setMaterial] = useState("");
  const [notiz, setNotiz] = useState("");
  const [aktiv, setAktiv] = useState(true);
  const [modelle, setModelle] = useState<Modell[]>([]);
  const [geaendert, setGeaendert] = useState(false);
  const befuellt = useRef(false);

  // Einmal befüllen: aus der DB (bearbeiten) oder aus der Druckliste (neu).
  useEffect(() => {
    if (befuellt.current) return;
    if (neu) {
      const key = sp?.get("key");
      const anzeige = sp?.get("anzeige");
      const teiltyp = sp?.get("teiltyp");
      if (key && anzeige) {
        setModelle([{ key, anzeige }]);
        setName(`${anzeige} ${teiltyp ?? "Füße"}`.slice(0, 191));
      }
      if (teiltyp) setTeiltypen([teiltyp]);
      befuellt.current = true;
      return;
    }
    const d = details.data;
    if (!d) return;
    setName(d.name);
    setTeiltypen(d.teiltypen);
    setStueck(d.stueckProPlatte ? String(d.stueckProPlatte) : "");
    setStunden(d.druckzeitMin ? String(Math.floor(d.druckzeitMin / 60)) : "");
    setMinuten(d.druckzeitMin ? String(d.druckzeitMin % 60) : "");
    setMaterial(d.material ?? "");
    setNotiz(d.notiz ?? "");
    setAktiv(d.aktiv);
    setModelle(d.modelle.map((m) => ({ key: m.modellKey, anzeige: m.anzeige })));
    befuellt.current = true;
  }, [neu, sp, details.data]);

  const aendere = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setGeaendert(true); };

  const speichern = api.druck.speichern.useMutation({
    onSuccess: (r) => {
      show("✅ Gespeichert", "success");
      setGeaendert(false);
      void utils.druck.liste.invalidate();
      void utils.druck.druckliste.invalidate();
      void utils.druck.zielArtikel.invalidate();
      if (neu) router.replace(`/admin/druck/${r.id}`);
      else void utils.druck.details.invalidate({ id: r.id });
    },
    onError: (e) => show(e.message, "error"),
  });

  function speichereJetzt() {
    const h = zahlOderNull(stunden) ?? 0;
    const m = zahlOderNull(minuten) ?? 0;
    speichern.mutate({
      id: id ?? undefined,
      name: name.trim(),
      teiltypen,
      stueckProPlatte: zahlOderNull(stueck),
      druckzeitMin: h * 60 + m > 0 ? h * 60 + m : null,
      material: material.trim() || null,
      notiz: notiz.trim() || null,
      aktiv,
      modelle,
    });
  }

  if (permsLoading || (!neu && details.isLoading)) {
    return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade…</div>;
  }
  if (!neu && (details.isError || !details.data)) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        {details.error?.message ?? "Vorlage nicht gefunden."} <Link href="/admin/druck" className="text-[#008BD2] font-semibold">Zurück</Link>
      </div>
    );
  }

  const alleTeiltypen = teiltypenQ.data ?? ["Füße vorne", "Füße hinten"];
  const schnellTeiltypen = alleTeiltypen.slice(0, 2);
  const weitere = alleTeiltypen.filter((t) => !schnellTeiltypen.includes(t) && !teiltypen.includes(t));
  const kannSpeichern = darfPflegen && name.trim().length > 0 && teiltypen.length > 0 && !speichern.isPending;

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link href="/admin/druck" className="text-[#65676b] hover:text-[#008BD2] text-sm">← 3D-Druck</Link>
        <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb] mt-1">
          {neu ? "Neue Druckvorlage" : details.data?.name}
        </h1>
        {!neu && details.data && (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">angelegt {fmtDatum(details.data.createdAt)} · {details.data.erstelltVon}</p>
        )}
      </div>

      <fieldset disabled={!darfPflegen} className={karte}>
        <div>
          <label htmlFor="dv-name" className={label}>Name</label>
          <input id="dv-name" className={feld} value={name} maxLength={191} onChange={(e) => aendere(setName)(e.target.value)} placeholder="z. B. ThinkPad E14 Gen 4 Fuß vorne" />
        </div>

        <div>
          <span className={label}>Teiltyp</span>
          <div className="flex flex-wrap gap-2">
            {[...new Set([...schnellTeiltypen, ...teiltypen])].map((t) => {
              const an = teiltypen.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={an}
                  onClick={() => aendere(setTeiltypen)(an ? teiltypen.filter((x) => x !== t) : [...teiltypen, t])}
                  className={`px-4 rounded-xl text-sm font-bold min-h-[48px] border-2 ${an ? "border-[#008BD2] bg-[#008BD2]/10 text-[#0064d2] dark:text-[#45bdff]" : "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"}`}
                >
                  {an ? "✓ " : ""}{t}
                </button>
              );
            })}
            {weitere.length > 0 && (
              <select
                className="px-3 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-sm text-[#202F61] dark:text-[#e4e6eb] min-h-[48px]"
                value=""
                onChange={(e) => { if (e.target.value) aendere(setTeiltypen)([...teiltypen, e.target.value]); }}
              >
                <option value="">＋ anderer Teiltyp…</option>
                {weitere.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">Sind vorne und hinten baugleich, beide wählen.</p>
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <div>
            <label htmlFor="dv-stueck" className={label}>Stück je Platte</label>
            <input id="dv-stueck" inputMode="numeric" className={feld} value={stueck} onChange={(e) => aendere(setStueck)(e.target.value)} placeholder="z. B. 40" />
          </div>
          <div>
            <label htmlFor="dv-h" className={label}>Druckzeit Std.</label>
            <input id="dv-h" inputMode="numeric" className={feld} value={stunden} onChange={(e) => aendere(setStunden)(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label htmlFor="dv-m" className={label}>Minuten</label>
            <input id="dv-m" inputMode="numeric" className={feld} value={minuten} onChange={(e) => aendere(setMinuten)(e.target.value)} placeholder="0" />
          </div>
        </div>

        <div>
          <label htmlFor="dv-material" className={label}>Material</label>
          <input id="dv-material" className={feld} value={material} maxLength={100} onChange={(e) => aendere(setMaterial)(e.target.value)} placeholder="z. B. TPU schwarz" />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {MATERIALIEN.map((m) => (
              <button key={m} type="button" onClick={() => aendere(setMaterial)(m)}
                className="px-3 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] min-h-[36px]">
                {m}
              </button>
            ))}
          </div>
        </div>

        <ModellWahl modelle={modelle} onChange={aendere(setModelle)} />

        <div>
          <label htmlFor="dv-notiz" className={label}>Notiz</label>
          <textarea id="dv-notiz" rows={3} className={`${feld} py-3`} value={notiz} maxLength={5000} onChange={(e) => aendere(setNotiz)(e.target.value)} placeholder="Druckhinweise, Filamentfarbe, Nacharbeit …" />
        </div>

        <label className="flex items-center gap-3 min-h-[48px] text-sm font-bold text-[#202F61] dark:text-[#e4e6eb]">
          <input type="checkbox" className="w-5 h-5" checked={aktiv} onChange={(e) => aendere(setAktiv)(e.target.checked)} />
          Aktiv (zählt in der Druckliste)
        </label>

        {darfPflegen && (
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" className={knopfBlau} disabled={!kannSpeichern} onClick={speichereJetzt}>
              {speichern.isPending ? "Speichere…" : neu ? "Anlegen" : "Speichern"}
            </button>
            {geaendert && !neu && <span className="text-sm font-bold text-[#BA7517]">Ungespeicherte Änderungen</span>}
            {neu && <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Foto und Druckdatei danach hinzufügen.</span>}
          </div>
        )}
      </fieldset>

      {!neu && details.data && (
        <>
          <DruckerStatus />
          <DruckFertigKarte
            id={details.data.id}
            stueckProPlatte={details.data.stueckProPlatte}
            protokoll={details.data.protokoll}
            darfEinbuchen={darfEinbuchen}
          />
          <FotoKarte id={details.data.id} fotoAm={details.data.fotoAm} darfPflegen={darfPflegen} />
          <DateienKarte id={details.data.id} titel={details.data.name} material={details.data.material} dateien={details.data.dateien} darfPflegen={darfPflegen} />
          {darfPflegen && <LoeschenKnopf id={details.data.id} name={details.data.name} />}
        </>
      )}
    </div>
  );
}

// Gerätemodelle wählen — Suche über GeraeteModell, gruppiert nach Modellschlüssel.
function ModellWahl({ modelle, onChange }: { modelle: Modell[]; onChange: (m: Modell[]) => void }) {
  const [suche, setSuche] = useState("");
  const [begriff, setBegriff] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setBegriff(suche.trim()), 300);
    return () => clearTimeout(t);
  }, [suche]);
  const q = api.druck.modellSuche.useQuery({ suche: begriff }, { enabled: begriff.length >= 2 });
  const gewaehlt = new Set(modelle.map((m) => m.key));

  return (
    <div>
      <span className={label}>Passt für diese Geräte</span>
      {modelle.length === 0 ? (
        <p className="text-sm font-bold text-[#BA7517] mb-2">⚠ Noch kein Gerät — ohne Zuordnung taucht die Vorlage nicht in der Druckliste auf.</p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-2">
          {modelle.map((m) => (
            <span key={m.key} className="inline-flex items-center gap-1 pl-3 rounded-xl bg-[#008BD2]/10 text-sm font-bold text-[#0064d2] dark:text-[#45bdff]">
              {m.anzeige}
              <button type="button" aria-label={`${m.anzeige} entfernen`} onClick={() => onChange(modelle.filter((x) => x.key !== m.key))}
                className="px-3 min-h-[40px] text-[#65676b] dark:text-[#b0b3b8] hover:text-[#fa3e3e]">✕</button>
            </span>
          ))}
        </div>
      )}
      <input className={feld} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Gerät suchen, z. B. E14 Gen 4" aria-label="Gerät suchen" />
      {begriff.length >= 2 && (
        <div className="mt-2 rounded-xl border border-[#ced4da] dark:border-[#3e4042] max-h-72 overflow-y-auto divide-y divide-[#ced4da] dark:divide-[#3e4042]">
          {q.isLoading ? <p className="p-3 text-sm text-[#65676b] dark:text-[#b0b3b8]">Suche…</p>
            : (q.data ?? []).length === 0 ? <p className="p-3 text-sm text-[#65676b] dark:text-[#b0b3b8]">Kein Gerätemodell gefunden.</p>
            : (q.data ?? []).map((m) => {
              const drin = gewaehlt.has(m.key);
              return (
                <button key={m.key} type="button" disabled={drin}
                  onClick={() => onChange([...modelle, { key: m.key, anzeige: m.anzeige }])}
                  className="w-full text-left px-4 min-h-[48px] flex items-center justify-between gap-2 text-sm text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] disabled:opacity-50">
                  <span><strong>{m.anzeige}</strong>{m.varianten > 1 && <span className="text-[#65676b] dark:text-[#b0b3b8]"> · {m.varianten} Varianten</span>}</span>
                  <span className="font-black">{drin ? "✓" : "＋"}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

function FotoKarte({ id, fotoAm, darfPflegen }: { id: number; fotoAm: Date | string | null; darfPflegen: boolean }) {
  const { show } = useToast();
  const utils = api.useUtils();
  const [laeuft, setLaeuft] = useState(false);
  const fertig = () => { void utils.druck.details.invalidate({ id }); void utils.druck.liste.invalidate(); };
  const setzen = api.druck.fotoSetzen.useMutation({ onSuccess: fertig, onError: (e) => show(e.message, "error") });
  const entfernen = api.druck.fotoEntfernen.useMutation({ onSuccess: fertig, onError: (e) => show(e.message, "error") });

  async function waehle(datei: File | undefined) {
    if (!datei) return;
    setLaeuft(true);
    try {
      await setzen.mutateAsync({ id, dataBase64: await fotoAlsBase64(datei) });
    } catch (e) {
      if (!(e instanceof Error && "data" in e)) show("Foto konnte nicht gelesen werden", "error");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div className={karte}>
      <h2 className="font-black text-[#202F61] dark:text-[#e4e6eb]">📷 Foto</h2>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-40 h-40 rounded-xl bg-[#f0f2f5] dark:bg-[#18191a] flex items-center justify-center overflow-hidden">
          {fotoAm ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/druck/foto/${id}?v=${new Date(fotoAm).getTime()}`} alt="Foto der Vorlage" className="w-full h-full object-contain" />
          ) : <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Kein Foto</span>}
        </div>
        {darfPflegen && (
          <div className="flex flex-col gap-2">
            <label className={`${knopfRand} cursor-pointer ${laeuft ? "opacity-50 pointer-events-none" : ""}`}>
              {laeuft ? "Lade hoch…" : fotoAm ? "Foto ersetzen" : "Foto aufnehmen / wählen"}
              <input type="file" accept="image/*" capture="environment" className="sr-only"
                onChange={(e) => { void waehle(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {fotoAm && (
              <button type="button" className={knopfRand} disabled={entfernen.isPending} onClick={() => entfernen.mutate({ id })}>Foto entfernen</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type DateiMeta = { id: number; art: string; dateiname: string; groesse: number; hochgeladenVon: string; createdAt: Date | string };

function DateienKarte({ id, titel, material, dateien, darfPflegen }: {
  id: number; titel: string; material: string | null; dateien: DateiMeta[]; darfPflegen: boolean;
}) {
  const { show } = useToast();
  const utils = api.useUtils();
  const [laden, setLaden] = useState<string | null>(null);
  const [loeschId, setLoeschId] = useState<number | null>(null);
  const loeschen = api.druck.dateiLoeschen.useMutation({
    onSuccess: () => { setLoeschId(null); void utils.druck.details.invalidate({ id }); void utils.druck.liste.invalidate(); },
    onError: (e) => show(e.message, "error"),
  });

  // Je Datei ein eigener try — eine abgelehnte Datei darf die übrigen nicht mitreißen.
  async function hochladen(liste: FileList | null) {
    if (!liste?.length) return;
    let ok = 0;
    for (const f of Array.from(liste)) {
      if (!dateiArt(f.name)) { show(`„${f.name}": nur .gcode.3mf, .3mf, STEP, STL …`, "error"); continue; }
      if (f.size > DATEI_MAX_BYTES) { show(`„${f.name}" ist zu groß (max. ${DATEI_MAX_BYTES / 1024 / 1024} MB)`, "error"); continue; }
      setLaden(f.name);
      try {
        const r = await fetch(`/api/druck/datei?vorlageId=${id}&name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
        if (!r.ok) {
          const j = (await r.json().catch(() => null)) as { error?: string } | null;
          show(`„${f.name}": ${j?.error ?? `Fehler ${r.status}`}`, "error");
        } else ok++;
      } catch {
        show(`„${f.name}": Verbindung unterbrochen`, "error");
      }
    }
    setLaden(null);
    if (ok) show(`✅ ${ok} ${ok === 1 ? "Datei" : "Dateien"} hochgeladen`, "success");
    void utils.druck.details.invalidate({ id });
    void utils.druck.liste.invalidate();
  }

  const hatDruck = dateien.some((d) => d.art === "DRUCK");

  return (
    <div className={karte}>
      <h2 className="font-black text-[#202F61] dark:text-[#e4e6eb]">📁 Dateien</h2>
      {!hatDruck && (
        <div className="rounded-xl bg-[#BA7517]/10 px-4 py-3 text-sm text-[#1a1a1a] dark:text-[#e4e6eb] space-y-1">
          <div className="font-bold text-[#8A5A00] dark:text-[#f7b928]">Noch keine fertige Druckdatei</div>
          <p>
            In Bambu Studio die Platte belegen und slicen, dann die geslicte Platte exportieren
            (Menü „Datei → Exportieren“, englisch „Export plate sliced file“). Es entsteht eine
            Datei <strong>.gcode.3mf</strong> — die geht später ohne Slicer an den Drucker.
          </p>
        </div>
      )}
      {dateien.length > 0 && (
        <ul className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
          {dateien.map((d) => {
            const art = (d.art in DATEI_ART_TEXT ? d.art : "QUELLE") as DateiArt;
            return (
              <li key={d.id} className="py-3 flex items-center gap-3 flex-wrap">
                <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold ${ART_FARBE[art]}`}>{DATEI_ART_TEXT[art]}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-[#202F61] dark:text-[#e4e6eb] break-all">{d.dateiname}</div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{fmtGroesse(d.groesse)} · {fmtDatum(d.createdAt)} · {d.hochgeladenVon}</div>
                </div>
                {art === "DRUCK" && <DruckenKnopf klein vorlageId={id} titel={titel} dateiId={d.id} dateiname={d.dateiname} material={material} />}
                <a href={`/api/druck/datei/${d.id}`} className={knopfRand}>⬇ Herunterladen</a>
                {darfPflegen && (
                  <button type="button" className={`${knopfRand} text-[#fa3e3e]`} onClick={() => setLoeschId(d.id)} aria-label={`${d.dateiname} löschen`}>🗑</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {darfPflegen && (
        <label className={`${knopfBlau} cursor-pointer ${laden ? "opacity-50 pointer-events-none" : ""}`}>
          {laden ? `Lade „${laden}" hoch…` : "＋ Dateien hochladen"}
          <input type="file" multiple className="sr-only" accept=".3mf,.gcode,.step,.stp,.stl,.obj,.f3d,.scad,.fcstd,.iges,.igs"
            onChange={(e) => { void hochladen(e.target.files); e.target.value = ""; }} />
        </label>
      )}
      <Modal open={loeschId != null} onClose={() => setLoeschId(null)} title="Datei löschen?">
        <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">
          „{dateien.find((d) => d.id === loeschId)?.dateiname}" wird endgültig gelöscht.
        </p>
        <div className="flex gap-3">
          <button type="button" className={`${knopfRand} flex-1`} onClick={() => setLoeschId(null)}>Abbrechen</button>
          <button type="button" disabled={loeschen.isPending} onClick={() => loeschId && loeschen.mutate({ id: loeschId })}
            className="flex-1 rounded-xl bg-[#fa3e3e] text-white text-sm font-bold min-h-[48px] disabled:opacity-50">Löschen</button>
        </div>
      </Modal>
    </div>
  );
}

function LoeschenKnopf({ id, name }: { id: number; name: string }) {
  const router = useRouter();
  const { show } = useToast();
  const utils = api.useUtils();
  const [auf, setAuf] = useState(false);
  const loeschen = api.druck.loeschen.useMutation({
    onSuccess: () => {
      show("Vorlage gelöscht", "success");
      void utils.druck.liste.invalidate();
      void utils.druck.druckliste.invalidate();
      router.push("/admin/druck");
    },
    onError: (e) => show(e.message, "error"),
  });
  return (
    <>
      <button type="button" onClick={() => setAuf(true)}
        className="inline-flex items-center gap-2 px-4 rounded-xl border border-[#fa3e3e]/40 text-[#fa3e3e] text-sm font-bold hover:bg-[#fa3e3e]/10 min-h-[48px]">
        🗑️ Vorlage löschen
      </button>
      <Modal open={auf} onClose={() => setAuf(false)} title="Vorlage löschen?">
        <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-2">„{name}" samt Foto und allen Dateien wird endgültig gelöscht.</p>
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-4">Wird sie nur gerade nicht gebraucht: lieber „Aktiv“ abhaken.</p>
        <div className="flex gap-3">
          <button type="button" className={`${knopfRand} flex-1`} onClick={() => setAuf(false)}>Abbrechen</button>
          <button type="button" disabled={loeschen.isPending} onClick={() => loeschen.mutate({ id })}
            className="flex-1 rounded-xl bg-[#fa3e3e] text-white text-sm font-bold min-h-[48px] disabled:opacity-50">Endgültig löschen</button>
        </div>
      </Modal>
    </>
  );
}

type ProtokollEintrag = {
  id: number; artikel: string; teiltyp: string; platten: number | null; stueck: number;
  gedrucktVon: string; createdAt: Date | string; zurueckgenommenAm: Date | string | null;
  zurueckgenommenVon: string | null; zuruecknehmbar: boolean;
};

// „Druck fertig" + Druckprotokoll. Stückzahl = Platten × Stück je Platte,
// überschreibbar (eine Platte kann auch mal nicht voll sein).
function DruckFertigKarte({ id, stueckProPlatte, protokoll, darfEinbuchen }: {
  id: number; stueckProPlatte: number | null; protokoll: ProtokollEintrag[]; darfEinbuchen: boolean;
}) {
  const { show } = useToast();
  const utils = api.useUtils();
  const ziel = api.druck.zielArtikel.useQuery({ id }, { enabled: darfEinbuchen });
  const [artikelId, setArtikelId] = useState<number | null>(null);
  const [platten, setPlatten] = useState("1");
  const [stueckEigen, setStueckEigen] = useState<string | null>(null);
  const [zurueckId, setZurueckId] = useState<number | null>(null);
  const karteRef = useRef<HTMLDivElement>(null);

  // Aus der Übersicht mit #fertig hierher gesprungen → Karte zeigen, sobald sie steht.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#fertig") {
      karteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [ziel.data]);

  const artikel = ziel.data?.artikel ?? [];
  const gewaehlt = artikel.find((a) => a.id === artikelId) ?? artikel[0] ?? null;
  const plattenZahl = zahlOderNull(platten);
  const stueckVorschlag = plattenZahl && stueckProPlatte ? plattenZahl * stueckProPlatte : null;
  const stueckText = stueckEigen ?? (stueckVorschlag != null ? String(stueckVorschlag) : "");
  const stueck = zahlOderNull(stueckText);

  const fertig = () => {
    void utils.druck.details.invalidate({ id });
    void utils.druck.zielArtikel.invalidate({ id });
    void utils.druck.liste.invalidate();
    void utils.druck.druckliste.invalidate();
  };
  const einbuchen = api.druck.einbuchen.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.stueck} Stück auf „${r.artikel}" eingebucht — Bestand jetzt ${r.neuerBestand}`, "success");
      setPlatten("1");
      setStueckEigen(null);
      fertig();
    },
    onError: (e) => show(e.message, "error"),
  });
  const zuruecknehmen = api.druck.zuruecknehmen.useMutation({
    onSuccess: () => { show("Buchung zurückgenommen", "success"); setZurueckId(null); fertig(); },
    onError: (e) => { show(e.message, "error"); setZurueckId(null); },
  });

  return (
    <div ref={karteRef} id="fertig" className={karte}>
      <h2 className="font-black text-[#202F61] dark:text-[#e4e6eb]">✓ Druck fertig — einbuchen</h2>

      {!darfEinbuchen ? (
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Einbuchen braucht das Recht zum Einlagern.</p>
      ) : ziel.isLoading ? (
        <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Suche passende Artikel…</p>
      ) : ziel.isError ? (
        <p className="text-sm text-[#fa3e3e]">Fehler: {ziel.error.message}</p>
      ) : artikel.length === 0 ? (
        <div className="rounded-xl bg-[#BA7517]/10 px-4 py-3 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
          <div className="font-bold text-[#8A5A00] dark:text-[#f7b928]">Kein passender Artikel</div>
          Für die zugeordneten Geräte gibt es noch keinen Artikel dieses Teiltyps. Erst Gerät zuordnen bzw.
          Kompatibilität pflegen — dann erscheint er hier.
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <span className={label}>Auf welchen Artikel?</span>
            <div className="space-y-2" role="radiogroup">
              {artikel.slice(0, 8).map((a) => {
                const an = gewaehlt?.id === a.id;
                return (
                  <button key={a.id} type="button" role="radio" aria-checked={an} onClick={() => setArtikelId(a.id)}
                    className={`w-full text-left px-4 min-h-[56px] rounded-xl border-2 flex items-center justify-between gap-3 ${an ? "border-[#008BD2] bg-[#008BD2]/10" : "border-[#ced4da] dark:border-[#3e4042]"}`}>
                    <span className="text-sm text-[#202F61] dark:text-[#e4e6eb]">
                      <strong>{a.bezeichnung}</strong>
                      <span className="text-[#65676b] dark:text-[#b0b3b8]"> · {a.geraete} {a.geraete === 1 ? "Gerät" : "Geräte"}</span>
                    </span>
                    <span className="text-sm font-black text-[#202F61] dark:text-[#e4e6eb] whitespace-nowrap">Bestand {a.bestand}</span>
                  </button>
                );
              })}
            </div>
            {artikel.length > 8 && (
              <select className={`${feld} mt-2`} value={gewaehlt?.id ?? ""} onChange={(e) => setArtikelId(Number(e.target.value))} aria-label="Weitere Artikel">
                {artikel.map((a) => <option key={a.id} value={a.id}>{a.bezeichnung} · Bestand {a.bestand}</option>)}
              </select>
            )}
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <div>
              <label htmlFor="df-platten" className={label}>Platten</label>
              <input id="df-platten" inputMode="numeric" className={feld} value={platten}
                onChange={(e) => { setPlatten(e.target.value); setStueckEigen(null); }} />
            </div>
            <div>
              <label htmlFor="df-stueck" className={label}>Stück gesamt</label>
              <input id="df-stueck" inputMode="numeric" className={feld} value={stueckText}
                onChange={(e) => setStueckEigen(e.target.value)} placeholder={stueckProPlatte ? "" : "Stück eintragen"} />
            </div>
          </div>
          {!stueckProPlatte && (
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Tipp: Mit „Stück je Platte“ oben rechnet Lagernaut die Stückzahl selbst aus.</p>
          )}

          <button type="button" className={`${knopfBlau} w-full`}
            disabled={!gewaehlt || !stueck || einbuchen.isPending}
            onClick={() => gewaehlt && stueck && einbuchen.mutate({ vorlageId: id, artikelId: gewaehlt.id, platten: plattenZahl, stueck })}>
            {einbuchen.isPending ? "Buche ein…" : stueck ? `${stueck} Stück einbuchen` : "Stückzahl eintragen"}
          </button>
        </div>
      )}

      <div>
        <h3 className="text-sm font-black uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-2">Druckprotokoll</h3>
        {protokoll.length === 0 ? (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Noch nichts über diese Vorlage eingebucht.</p>
        ) : (
          <ul className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
            {protokoll.map((p) => (
              <li key={p.id} className={`py-2 flex items-center gap-3 flex-wrap ${p.zurueckgenommenAm ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                  <strong className={p.zurueckgenommenAm ? "line-through" : ""}>{p.stueck} Stück</strong>
                  {p.platten ? ` · ${p.platten} ${p.platten === 1 ? "Platte" : "Platten"}` : ""} · {p.artikel}
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
                    {fmtDatum(p.createdAt)} · {p.gedrucktVon}
                    {p.zurueckgenommenAm && <> · zurückgenommen {fmtDatum(p.zurueckgenommenAm)} · {p.zurueckgenommenVon}</>}
                  </div>
                </div>
                {darfEinbuchen && p.zuruecknehmbar && (
                  <button type="button" className={knopfRand} onClick={() => setZurueckId(p.id)}>↩ Zurücknehmen</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={zurueckId != null} onClose={() => setZurueckId(null)} title="Einbuchung zurücknehmen?">
        <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">
          Die Buchung über {protokoll.find((p) => p.id === zurueckId)?.stueck} Stück wird gelöscht und der Bestand neu berechnet.
          Für Tippfehler gedacht — geht nur in den ersten 24 Stunden.
        </p>
        <div className="flex gap-3">
          <button type="button" className={`${knopfRand} flex-1`} onClick={() => setZurueckId(null)}>Abbrechen</button>
          <button type="button" disabled={zuruecknehmen.isPending} onClick={() => zurueckId && zuruecknehmen.mutate({ protokollId: zurueckId })}
            className="flex-1 rounded-xl bg-[#fa3e3e] text-white text-sm font-bold min-h-[48px] disabled:opacity-50">Zurücknehmen</button>
        </div>
      </Modal>
    </div>
  );
}
