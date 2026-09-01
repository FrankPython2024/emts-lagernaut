"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import { kopiereText } from "@/lib/mobil/export";

const AKZENT = "#008BD2";
const HERSTELLER = ["Apple", "Samsung", "Google", "Xiaomi"] as const;

type MobilBereich = "STANDARD" | "DIGITAL_EDUCATION";
const BEREICH_TABS: { key: MobilBereich; label: string }[] = [
  { key: "STANDARD",          label: "Standard" },
  { key: "DIGITAL_EDUCATION", label: "digital Education" },
];

export default function MobilReviewPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfSehen     = has("MOBIL_VIEW");
  const darfVerwalten = has("MOBIL_MANAGE");

  // Bereich aus ?bereich= (vom Reiter/Link mitgegeben), clientseitig gelesen.
  const [bereich, setBereich] = useState<MobilBereich>("STANDARD");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("bereich") === "DIGITAL_EDUCATION") {
      setBereich("DIGITAL_EDUCATION");
    }
  }, []);

  const listeQ = api.mobil.reviewListe.useQuery({ bereich }, { enabled: darfSehen });

  if (permsLoading) {
    return <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfSehen) {
    return (
      <div className="p-8 text-center text-base text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff. Bitte das Recht <strong>MOBIL_VIEW</strong> bei der Rolle aktivieren.
      </div>
    );
  }

  const gruppen = listeQ.data?.gruppen ?? [];
  const offenGesamt = gruppen.reduce((s, g) => s + g.anzahl, 0);

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <Link href="/admin/mobil" className="text-base text-[#65676b] hover:text-[#008BD2] dark:text-[#b0b3b8]">← Zur Übersicht</Link>
        <h1 className="mt-1 text-3xl font-black text-[#202F61] dark:text-[#e4e6eb]">🔍 Review: Teile zuordnen</h1>
        <p className="mt-2 text-base text-[#65676b] dark:text-[#b0b3b8]">
          Beim Import unklar gebliebene Teile. Ordne jeder Zeile Hersteller, Modell und Teiltyp
          zu. Danach erscheinen die Teile ganz normal in der Ersatzteil-Liste. Gleiche Wortlaute
          sind zusammengefasst und werden in einem Rutsch zugeordnet.
        </p>
      </header>

      {/* Reiter: Kostenstelle/Bereich */}
      <div className="flex gap-1 rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-1 w-fit">
        {BEREICH_TABS.map(({ key, label }) => {
          const aktiv = bereich === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={aktiv}
              onClick={() => setBereich(key)}
              className={`px-4 min-h-[44px] rounded-lg text-base font-bold transition-colors ${aktiv ? "text-white" : "text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c]"}`}
              style={aktiv ? { background: AKZENT } : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>

      {listeQ.isLoading ? (
        <div role="status" className="text-base text-[#65676b] dark:text-[#b0b3b8] py-3">⏳ Lade…</div>
      ) : gruppen.length === 0 ? (
        <div className="rounded-xl border border-[#2e7d32]/40 bg-[#2e7d32]/10 dark:bg-[#7bc67e]/10 p-5 text-base text-[#2e7d32] dark:text-[#7bc67e]">
          ✓ Nichts zu prüfen. In diesem Bereich sind alle Teile zugeordnet.
        </div>
      ) : (
        <>
          <div className="text-base font-semibold text-[#b25e00] dark:text-[#ffb74d]">
            {offenGesamt} {offenGesamt === 1 ? "Teil" : "Teile"} in {gruppen.length}{" "}
            {gruppen.length === 1 ? "Wortlaut" : "Wortlauten"} offen.
          </div>
          {!darfVerwalten && (
            <div className="rounded-xl border border-dashed border-[#ced4da] dark:border-[#3e4042] p-4 text-sm text-[#65676b] dark:text-[#b0b3b8]">
              Zum Zuordnen wird das Recht <strong>MOBIL_MANAGE</strong> benötigt. Du siehst die Liste,
              kannst aber (noch) nicht speichern.
            </div>
          )}
          <div className="space-y-4">
            {gruppen.map((g) => (
              <ReviewKarte
                key={g.bezeichnung}
                gruppe={g}
                modelle={listeQ.data!.modelle}
                teiltypen={listeQ.data!.teiltypen}
                darfVerwalten={darfVerwalten}
                bereich={bereich}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type Gruppe = {
  bezeichnung: string;
  anzahl:      number;
  logIds:      string[];
  beispiel:    { colli: string | null; stellplatz: string | null; ek: number | null; aan: string | null; lieferant: string | null; farbe: string | null };
  vorschlag:   { hersteller: string | null; modelle: string[]; teiltyp: string | null };
};

function ReviewKarte({
  gruppe, modelle, teiltypen, darfVerwalten, bereich,
}: {
  gruppe:        Gruppe;
  modelle:       { id: number; hersteller: string; modell: string }[];
  teiltypen:     string[];
  darfVerwalten: boolean;
  bereich:       MobilBereich;
}) {
  const { show } = useToast();
  const utils = api.useUtils();

  // Prefill aus dem Parser-Vorschlag (soweit vorhanden).
  const [hersteller, setHersteller] = useState<string>(gruppe.vorschlag.hersteller ?? "");
  const [modell, setModell]         = useState<string>(gruppe.vorschlag.modelle[0] ?? "");
  const [teiltyp, setTeiltyp]       = useState<string>(gruppe.vorschlag.teiltyp ?? "");
  const [bezeichnung, setBezeichnung] = useState<string>(gruppe.bezeichnung);
  const [aliasLernen, setAliasLernen] = useState(true);
  const [neuTeiltyp, setNeuTeiltyp]   = useState(false); // "➕ Neuer Teiltyp…" gewählt
  const [logsOffen, setLogsOffen]     = useState(false);
  const bezeichnungGeaendert = bezeichnung.trim() !== gruppe.bezeichnung.trim();

  async function copyEinzeln(logId: string) {
    const ok = await kopiereText(logId);
    show(ok ? `${logId} kopiert` : "Kopieren fehlgeschlagen.", ok ? "success" : "error");
  }
  async function copyAlle() {
    const ok = await kopiereText(gruppe.logIds.join("\n"));
    show(ok ? `${gruppe.logIds.length} LogIDs kopiert` : "Kopieren fehlgeschlagen.", ok ? "success" : "error");
  }

  // Modell-Vorschläge (Autovervollständigung) für den gewählten Hersteller —
  // vermeidet Tippfehler-Duplikate; neuer Name bleibt trotzdem erlaubt.
  const modellVorschlaege = useMemo(
    () => modelle.filter((m) => !hersteller || m.hersteller === hersteller).map((m) => m.modell),
    [modelle, hersteller],
  );

  const zuordnen = api.mobil.reviewZuordnen.useMutation({
    onSuccess: (r) => {
      show(
        `✅ ${r.zugeordnet} Teil(e) zugeordnet` + (r.aliasGelernt > 0 ? ` · Wortlaut gemerkt` : ""),
        "success",
      );
      void utils.mobil.reviewListe.invalidate({ bereich });
      void utils.mobil.stats.invalidate({ bereich });
      void utils.mobil.hersteller.invalidate({ bereich });
      void utils.mobil.katalog.invalidate(); // neuer Teiltyp taucht künftig in der Auswahl auf
    },
    onError: (e) => show(e.message, "error"),
  });

  const kannSpeichern = darfVerwalten && !!hersteller.trim() && !!modell.trim() && !!teiltyp.trim() && !zuordnen.isPending;
  const listId = `modelle-${gruppe.bezeichnung.replace(/[^a-z0-9]/gi, "").slice(0, 40)}`;

  const b = gruppe.beispiel;
  const hatChips = !!b.stellplatz || !!b.farbe || !!b.aan || b.ek != null || !!b.lieferant || !!b.colli;

  function speichern() {
    if (!kannSpeichern) return;
    zuordnen.mutate({
      logIds:      gruppe.logIds,
      hersteller:  hersteller.trim(),
      modell:      modell.trim(),
      teiltyp:     teiltyp.trim(),
      // Nur mitsenden, wenn wirklich geändert (leer = unverändert lassen).
      ...(bezeichnungGeaendert && bezeichnung.trim() ? { bezeichnung: bezeichnung.trim() } : {}),
      aliasLernen,
    });
  }

  const feld = "w-full px-3 min-h-[48px] rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base outline-none focus:border-[#008BD2]";

  return (
    <div className="rounded-2xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] shadow-sm overflow-hidden">
      {/* Kopf: Bezeichnung (editierbar) + Stückzahl */}
      <div className="p-4 border-b border-[#ced4da] dark:border-[#3e4042]">
        <div className="flex items-start justify-between gap-3 mb-1">
          <span className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">Bezeichnung</span>
          <span className="flex-shrink-0 rounded-lg px-3 py-1 text-sm font-bold tabular-nums" style={{ background: `${AKZENT}1a`, color: AKZENT }}>
            {gruppe.anzahl} Stück
          </span>
        </div>
        <textarea
          value={bezeichnung}
          onChange={(e) => setBezeichnung(e.target.value)}
          disabled={!darfVerwalten}
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-sm font-mono leading-snug outline-none focus:border-[#008BD2] resize-y"
        />
        {bezeichnungGeaendert && (
          <p className="mt-1 text-xs text-[#008BD2] dark:text-[#45bdff]">
            ✏️ Bezeichnung angepasst. Wird beim Zuordnen übernommen.
          </p>
        )}
      </div>

      {/* Beispiel-Logistik + Parser-Vorschlag */}
      <div className="px-4 pt-3 space-y-2">
        {hatChips && (
          <div className="flex flex-wrap gap-1">
            {b.colli && <Chip icon="📦" wert={`Colli ${b.colli}`} />}
            {b.stellplatz && <Chip icon="📍" wert={b.stellplatz} />}
            {b.farbe && <Chip icon="🎨" wert={b.farbe} />}
            {b.aan && <Chip label="AAN" wert={b.aan} />}
            {b.ek != null && <Chip label="EK" wert={`${b.ek.toFixed(2).replace(".", ",")} €`} />}
            {b.lieferant && <Chip icon="🏭" wert={b.lieferant} />}
          </div>
        )}
        <p className="text-xs text-[#90939a] dark:text-[#8a8d91]">
          Parser-Vorschlag: {vorschlagText(gruppe.vorschlag)}
        </p>
      </div>

      {/* LogIDs anzeigen + kopieren (komplett / einzeln) */}
      <div className="px-4 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setLogsOffen((o) => !o)}
            aria-expanded={logsOffen}
            className="inline-flex items-center gap-1 min-h-[40px] px-1 text-sm font-semibold text-[#202F61] dark:text-[#e4e6eb]"
          >
            <span aria-hidden className="inline-block w-4 text-[#90939a]">{logsOffen ? "▾" : "▸"}</span>
            LogIDs ({gruppe.anzahl})
          </button>
          <button
            type="button"
            onClick={copyAlle}
            aria-label={`Alle ${gruppe.anzahl} LogIDs kopieren`}
            title="Alle LogIDs kopieren (eine pro Zeile)"
            className="inline-flex items-center gap-1 rounded-lg px-3 min-h-[40px] text-sm font-bold border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c] transition-colors"
          >
            📋 Alle kopieren
          </button>
        </div>
        {logsOffen && (
          <ul className="mt-2 space-y-1">
            {gruppe.logIds.map((id) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[#e4e6eb] dark:border-[#3a3b3c] bg-[#f7f8fa] dark:bg-[#18191a] px-2.5 py-1.5"
              >
                <span className="font-mono text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] break-all">{id}</span>
                <button
                  type="button"
                  onClick={() => copyEinzeln(id)}
                  aria-label={`LogID ${id} kopieren`}
                  title="Diese LogID kopieren"
                  className="flex-shrink-0 inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#202F61] dark:text-[#e4e6eb] hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c] transition-colors"
                >
                  📋
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Editor */}
      <div className="p-4 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="block text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Hersteller</span>
          <select
            value={hersteller}
            onChange={(e) => setHersteller(e.target.value)}
            disabled={!darfVerwalten}
            className={feld}
          >
            <option value="">wählen</option>
            {HERSTELLER.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Modell</span>
          <input
            list={listId}
            value={modell}
            onChange={(e) => setModell(e.target.value)}
            disabled={!darfVerwalten}
            placeholder="z. B. iPhone SE (2022)"
            className={feld}
          />
          <datalist id={listId}>
            {modellVorschlaege.map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>

        <label className="block">
          <span className="block text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Teiltyp</span>
          <select
            value={neuTeiltyp ? "__neu__" : teiltyp}
            onChange={(e) => {
              if (e.target.value === "__neu__") { setNeuTeiltyp(true); setTeiltyp(""); }
              else { setNeuTeiltyp(false); setTeiltyp(e.target.value); }
            }}
            disabled={!darfVerwalten}
            className={feld}
          >
            <option value="">wählen</option>
            {teiltypen.map((t) => <option key={t} value={t}>{t}</option>)}
            <option value="__neu__">➕ Neuer Teiltyp…</option>
          </select>
          {neuTeiltyp && (
            <input
              autoFocus
              value={teiltyp}
              onChange={(e) => setTeiltyp(e.target.value)}
              disabled={!darfVerwalten}
              placeholder="z. B. Back Glass"
              className={`${feld} mt-1`}
            />
          )}
        </label>
      </div>

      <div className="px-4 pb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
          <input
            type="checkbox"
            checked={aliasLernen}
            onChange={(e) => setAliasLernen(e.target.checked)}
            disabled={!darfVerwalten}
            className="w-5 h-5 accent-[#008BD2]"
          />
          Wortlaut merken, damit künftige Importe ihn automatisch erkennen
        </label>
        <button
          type="button"
          onClick={speichern}
          disabled={!kannSpeichern}
          className="inline-flex items-center justify-center gap-2 px-6 min-h-[48px] rounded-xl text-white text-base font-bold disabled:opacity-40 transition-colors shadow-sm"
          style={{ background: AKZENT }}
        >
          {zuordnen.isPending ? "Speichert…" : `Zuordnen (${gruppe.anzahl} Stück)`}
        </button>
      </div>
    </div>
  );
}

function vorschlagText(v: Gruppe["vorschlag"]): string {
  const teile = [
    v.hersteller ? `Hersteller ${v.hersteller}` : null,
    v.modelle.length === 1 ? `Modell ${v.modelle[0]}` : v.modelle.length > 1 ? `Modelle ${v.modelle.join(" / ")}` : null,
    v.teiltyp ? `Teiltyp ${v.teiltyp}` : null,
  ].filter(Boolean);
  return teile.length ? teile.join(" · ") : "nichts eindeutig erkannt";
}

function Chip({ icon, label, wert }: { icon?: string; label?: string; wert: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-1 max-w-full rounded-md border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#3a3b3c] px-2 py-0.5 text-xs"
      title={label ? `${label}: ${wert}` : wert}
    >
      {icon && <span aria-hidden className="flex-shrink-0">{icon}</span>}
      {label && <span className="flex-shrink-0 text-[#90939a] dark:text-[#8a8d91]">{label}</span>}
      <span className="truncate font-medium text-[#1a1a1a] dark:text-[#e4e6eb]">{wert}</span>
    </span>
  );
}
