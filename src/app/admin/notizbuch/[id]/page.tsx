"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { usePermissions } from "@/hooks/usePermissions";

// ── Notizbuch: eine Notiz ────────────────────────────────────────────────────
// Oben das Scanfeld (jeder Scan = eine Zeile), darunter die Einträge, dann der
// Freitext. Ein Handscanner schickt nach dem Code ein Enter — das reicht zum
// Anlegen, ohne Knopf. Wer eine Liste einfügt, bekommt je Zeile einen Eintrag.

const karte   = "bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm";
const eingabe = "w-full px-4 min-h-[56px] rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] text-base outline-none focus:border-[#0064d2]";
const knopfLeise = "px-4 min-h-[56px] rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] font-bold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] disabled:opacity-50 inline-flex items-center justify-center";

function zeitDe(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function NotizPage() {
  const params   = useParams<{ id: string }>();
  const id       = Number(params?.id);
  const router   = useRouter();
  const { show } = useToast();
  const utils    = api.useUtils();
  const { has }  = usePermissions();
  const darfSchreiben = has("NOTIZBUCH_EDIT");

  const notiz = api.notizbuch.get.useQuery(
    { id },
    // Für alle sichtbar: Scans anderer Personen tauchen ohne Neuladen auf.
    { enabled: Number.isInteger(id) && id > 0, refetchInterval: 10_000 },
  );

  // ── Titel + Freitext ─────────────────────────────────────────────────────
  // ⚠️ Nachgeladene Daten dürfen Eingaben nie überschreiben (CLAUDE.md,
  // Formular-Falle 1). Die Abfrage lädt alle 10 s neu — ohne `geaendert` wäre
  // ein halb getippter Text nach spätestens 10 s weg.
  const [titel, setTitel]         = useState("");
  const [text, setText]           = useState("");
  const [stand, setStand]         = useState<number | null>(null);
  const [geaendert, setGeaendert] = useState(false);
  const [konflikt, setKonflikt]   = useState(false);

  useEffect(() => {
    if (!notiz.data || geaendert) return;
    setTitel(notiz.data.titel);
    setText(notiz.data.text ?? "");
    setStand(notiz.data.textStand);
  }, [notiz.data, geaendert]);

  const speichern = api.notizbuch.speichern.useMutation({
    onSuccess: (r) => {
      setStand(r.stand);
      setGeaendert(false);
      setKonflikt(false);
      show("✅ Gespeichert", "success");
      void utils.notizbuch.invalidate();
    },
    onError: (e) => {
      if (e.data?.code === "CONFLICT") setKonflikt(true);
      show(`❌ ${e.message}`, "error");
    },
  });

  const neuesteFassungLaden = () => {
    // Bewusste Entscheidung der Person: eigene Änderung verwerfen.
    setGeaendert(false);
    setKonflikt(false);
    void notiz.refetch();
  };

  // ── Scannen ──────────────────────────────────────────────────────────────
  const scanRef = useRef<HTMLTextAreaElement>(null);
  const [scan, setScan] = useState("");
  const [neueIds, setNeueIds] = useState<Set<number>>(new Set());

  const hinzufuegen = api.notizbuch.eintraegeHinzufuegen.useMutation({
    onSuccess: (r) => {
      setScan("");
      setNeueIds(new Set(r.angelegt.map((e) => e.id)));
      if (r.doppelt.length > 0) {
        show(`⚠️ Schon vorhanden: ${r.doppelt.slice(0, 3).join(", ")}${r.doppelt.length > 3 ? " …" : ""}`, "warning");
      } else if (r.angelegt.length > 1) {
        show(`✅ ${r.angelegt.length} Einträge hinzugefügt`, "success");
      }
      void utils.notizbuch.invalidate();
      scanRef.current?.focus();
    },
    onError: (e) => { show(`❌ ${e.message}`, "error"); scanRef.current?.focus(); },
  });

  const absenden = (roh: string) => {
    const werte = roh.split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
    if (werte.length === 0 || hinzufuegen.isPending) return;
    hinzufuegen.mutate({ notizId: id, werte });
  };

  // Scanner: Enter schickt ab. Umschalt+Enter bleibt für Zeilenumbrüche beim Tippen.
  const beiTaste = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      absenden(scan);
    }
  };

  // Eingefügte Liste mit mehreren Zeilen sofort anlegen — sonst müsste man
  // nach dem Einfügen noch einmal Enter drücken und wundert sich über nichts.
  const beiEinfuegen = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const eingefuegt = e.clipboardData.getData("text");
    if (/\r?\n/.test(eingefuegt.trim())) {
      e.preventDefault();
      absenden(scan + eingefuegt);
    }
  };

  // ── Einträge bearbeiten / löschen ───────────────────────────────────────
  const [bearbeite, setBearbeite] = useState<{ id: number; wert: string } | null>(null);
  const [loescheEintrag, setLoescheEintrag] = useState<{ id: number; wert: string } | null>(null);
  const [loescheNotiz, setLoescheNotiz] = useState(false);

  const eintragAendern = api.notizbuch.eintragAendern.useMutation({
    onSuccess: () => { setBearbeite(null); show("✅ Eintrag geändert", "success"); void utils.notizbuch.invalidate(); },
    onError:   (e) => show(`❌ ${e.message}`, "error"),
  });
  const eintragLoeschen = api.notizbuch.eintragLoeschen.useMutation({
    onSuccess: () => { setLoescheEintrag(null); show("🗑 Eintrag gelöscht", "success"); void utils.notizbuch.invalidate(); },
    onError:   (e) => show(`❌ ${e.message}`, "error"),
  });
  const notizLoeschen = api.notizbuch.loeschen.useMutation({
    onSuccess: () => { show("🗑 Notiz gelöscht", "success"); void utils.notizbuch.invalidate(); router.push("/admin/notizbuch"); },
    onError:   (e) => show(`❌ ${e.message}`, "error"),
  });

  // Wie oft kommt ein Wert vor? Für die Doppelt-Markierung in der Liste.
  const haeufigkeit = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of notiz.data?.eintraege ?? []) m.set(e.wert, (m.get(e.wert) ?? 0) + 1);
    return m;
  }, [notiz.data]);

  const kopieren = async () => {
    const werte = (notiz.data?.eintraege ?? []).map((e) => e.wert);
    if (werte.length === 0) return;
    try {
      await navigator.clipboard.writeText(werte.join("\n"));
      show(`📋 ${werte.length} Einträge kopiert (je Zeile einer)`, "success");
    } catch {
      show("❌ Kopieren nicht möglich. Bitte den Excel-Export nutzen.", "error");
    }
  };

  // ── Darstellung ──────────────────────────────────────────────────────────
  if (!Number.isInteger(id) || id <= 0) {
    return <div className={karte}>Ungültige Notiz.</div>;
  }
  if (notiz.isLoading) return <div className={karte}>Lädt…</div>;
  if (notiz.error || !notiz.data) {
    return (
      <div className={karte}>
        <p className="text-[#c62828] font-bold">❌ {notiz.error?.message ?? "Notiz nicht gefunden."}</p>
        <Link href="/admin/notizbuch" className="inline-block mt-3 text-[#0064d2] dark:text-[#45bdff] underline">
          Zurück zum Notizbuch
        </Link>
      </div>
    );
  }

  const n = notiz.data;
  const eintraege = n.eintraege;
  const unterschiedliche = haeufigkeit.size;

  return (
    <div className="space-y-5 max-w-4xl">
      <Link href="/admin/notizbuch" className="inline-flex items-center min-h-[44px] text-[#0064d2] dark:text-[#45bdff] font-semibold">
        ← Alle Notizen
      </Link>

      {/* ── Kopf ──────────────────────────────────────────────────────────── */}
      <div className={karte}>
        {darfSchreiben ? (
          <input
            type="text" value={titel} maxLength={191} aria-label="Titel"
            onChange={(e) => { setTitel(e.target.value); setGeaendert(true); }}
            className="w-full text-2xl font-bold bg-transparent text-[#1a1a1a] dark:text-[#e4e6eb] outline-none border-b-2 border-transparent focus:border-[#0064d2] py-1"
          />
        ) : (
          <h1 className="text-2xl font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{n.titel}</h1>
        )}
        <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
          Angelegt {zeitDe(n.createdAt)} von {n.erstelltVon}
          {n.geaendertVon ? ` · zuletzt ${zeitDe(n.updatedAt)} von ${n.geaendertVon}` : ""}
        </p>

        <div className="flex gap-3 flex-wrap mt-4">
          <div className="px-4 min-h-[56px] rounded-xl bg-[#202F61]/10 dark:bg-[#202F61]/40 flex items-center gap-2">
            <span className="text-2xl font-bold tabular-nums text-[#202F61] dark:text-[#e4e6eb]">{eintraege.length}</span>
            <span className="text-sm text-[#202F61] dark:text-[#b0b3b8]">
              {eintraege.length === 1 ? "Eintrag" : "Einträge"}
              {unterschiedliche !== eintraege.length ? ` (${unterschiedliche} verschiedene)` : ""}
            </span>
          </div>
          <button onClick={kopieren} disabled={eintraege.length === 0} className={knopfLeise}>📋 Alle kopieren</button>
          {/* Echte Links statt Blob-Klick — laden in jedem Browser zuverlässig herunter. */}
          <a href={`/api/notizbuch/export?id=${n.id}&format=csv`}
             className={`${knopfLeise} ${eintraege.length === 0 ? "pointer-events-none opacity-50" : ""}`}>⬇ CSV</a>
          <a href={`/api/notizbuch/export?id=${n.id}&format=xlsx`}
             className={`${knopfLeise} ${eintraege.length === 0 ? "pointer-events-none opacity-50" : ""}`}>⬇ Excel</a>
        </div>
      </div>

      {/* ── Scannen ───────────────────────────────────────────────────────── */}
      {darfSchreiben && (
        <div className={`${karte} border-2 border-[#008BD2]/40`}>
          <label htmlFor="scanfeld" className="block font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-2">
            Scannen oder eintippen
          </label>
          <div className="flex gap-3 flex-wrap">
            <textarea
              id="scanfeld" ref={scanRef} rows={1} autoFocus
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={beiTaste}
              onPaste={beiEinfuegen}
              placeholder="LogID, Barcode, Inventarnummer … dann Enter"
              className={`${eingabe} flex-1 min-w-[240px] py-4 font-mono resize-none`}
            />
            <button
              onClick={() => absenden(scan)}
              disabled={!scan.trim() || hinzufuegen.isPending}
              className="px-6 min-h-[56px] rounded-xl bg-[#0064d2] text-white font-bold hover:bg-blue-700 disabled:opacity-50">
              {hinzufuegen.isPending ? "…" : "Hinzufügen"}
            </button>
          </div>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-2">
            Der Scanner schickt Enter selbst — einfach nacheinander scannen. Eine eingefügte Liste
            wird je Zeile ein Eintrag. Doppelte werden angenommen und gelb markiert.
          </p>
        </div>
      )}

      {/* ── Einträge ──────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] p-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          Einträge
        </h2>
        {eintraege.length === 0 ? (
          <p className="p-5 text-[#65676b] dark:text-[#b0b3b8]">
            {darfSchreiben ? "Noch nichts erfasst. Oben ins Scanfeld scannen." : "Noch nichts erfasst."}
          </p>
        ) : (
          <ol className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
            {/* Neueste oben: Beim Scannen sieht man sofort, ob der letzte angekommen ist. */}
            {[...eintraege].reverse().map((e) => {
              const nr     = eintraege.indexOf(e) + 1;
              const anzahl = haeufigkeit.get(e.wert) ?? 1;
              const neu    = neueIds.has(e.id);
              return (
                <li key={e.id}
                  className={`flex items-center gap-3 px-4 py-2 min-h-[56px] ${
                    neu ? "bg-[#04B475]/10" : anzahl > 1 ? "bg-[#f7b928]/10" : ""}`}>
                  <span className="w-10 text-right tabular-nums text-sm text-[#90939a] flex-shrink-0">{nr}</span>

                  {bearbeite?.id === e.id ? (
                    <input
                      type="text" value={bearbeite.wert} maxLength={500} autoFocus aria-label="Eintrag bearbeiten"
                      onChange={(ev) => setBearbeite({ id: e.id, wert: ev.target.value })}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" && bearbeite.wert.trim()) eintragAendern.mutate({ id: e.id, wert: bearbeite.wert });
                        if (ev.key === "Escape") setBearbeite(null);
                      }}
                      className={`${eingabe} flex-1 font-mono`}
                    />
                  ) : (
                    <span className="flex-1 min-w-0 font-mono text-base text-[#1a1a1a] dark:text-[#e4e6eb] break-all">
                      {e.wert}
                      {anzahl > 1 && (
                        <span className="ml-2 px-2 py-0.5 rounded-md text-xs font-bold font-sans bg-[#f7b928]/25 text-[#a67908] dark:text-[#f7b928]">
                          {anzahl}×
                        </span>
                      )}
                    </span>
                  )}

                  <span className="hidden sm:block text-xs text-[#65676b] dark:text-[#b0b3b8] text-right flex-shrink-0">
                    {zeitDe(e.createdAt)}<br />{e.erfasstVon}
                  </span>

                  {darfSchreiben && (
                    <span className="flex gap-1 flex-shrink-0">
                      {bearbeite?.id === e.id ? (
                        <>
                          <button
                            onClick={() => bearbeite.wert.trim() && eintragAendern.mutate({ id: e.id, wert: bearbeite.wert })}
                            disabled={!bearbeite.wert.trim() || eintragAendern.isPending}
                            aria-label="Änderung speichern"
                            className="w-12 h-12 rounded-lg bg-[#04B475] text-white font-bold disabled:opacity-50">✓</button>
                          <button onClick={() => setBearbeite(null)} aria-label="Abbrechen"
                            className="w-12 h-12 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b]">✕</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setBearbeite({ id: e.id, wert: e.wert })} aria-label={`${e.wert} bearbeiten`}
                            className="w-12 h-12 rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]">✏️</button>
                          <button onClick={() => setLoescheEintrag({ id: e.id, wert: e.wert })} aria-label={`${e.wert} löschen`}
                            className="w-12 h-12 rounded-lg hover:bg-[#fa3e3e]/10">🗑</button>
                        </>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ── Freitext ──────────────────────────────────────────────────────── */}
      <div className={karte}>
        <label htmlFor="freitext" className="block font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-2">Notiz</label>
        {darfSchreiben ? (
          <>
            <textarea
              id="freitext" rows={6} value={text}
              onChange={(e) => { setText(e.target.value); setGeaendert(true); }}
              placeholder="Bemerkungen, Hinweise, Zusammenhänge …"
              className={`${eingabe} py-3 min-h-[140px]`}
            />
            {konflikt && (
              <div className="mt-3 p-3 rounded-xl border-2 border-[#f7b928] bg-[#f7b928]/10 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                <p className="font-bold">Jemand hat diese Notiz inzwischen geändert.</p>
                <p className="mt-1">Dein Text steht noch im Feld. Kopiere ihn dir, bevor du die neueste Fassung lädst.</p>
                <div className="flex gap-2 flex-wrap mt-2">
                  <button
                    onClick={() => { void navigator.clipboard.writeText(text).then(() => show("📋 Dein Text ist kopiert", "success")); }}
                    className={knopfLeise}>📋 Meinen Text kopieren</button>
                  <button onClick={neuesteFassungLaden} className={knopfLeise}>Neueste Fassung laden</button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap mt-3">
              <button
                onClick={() => stand !== null && speichern.mutate({ id: n.id, titel: titel.trim(), text, stand })}
                disabled={!geaendert || !titel.trim() || stand === null || speichern.isPending}
                className="px-6 min-h-[56px] rounded-xl bg-[#04B475] text-white font-bold hover:bg-[#039c65] disabled:opacity-50">
                {speichern.isPending ? "…" : "💾 Titel und Notiz speichern"}
              </button>
              {geaendert && <span className="text-sm font-semibold text-[#a67908] dark:text-[#f7b928]">Nicht gespeicherte Änderungen</span>}
            </div>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-[#1a1a1a] dark:text-[#e4e6eb]">
            {n.text || <span className="text-[#90939a]">Kein Text.</span>}
          </p>
        )}
      </div>

      {/* ── Löschen ───────────────────────────────────────────────────────── */}
      {darfSchreiben && (
        <div className="flex justify-end">
          <button onClick={() => setLoescheNotiz(true)}
            className="px-5 min-h-[56px] rounded-xl border border-[#fa3e3e]/40 text-[#c62828] dark:text-[#ff8a80] font-bold hover:bg-[#fa3e3e]/10">
            🗑 Notiz löschen …
          </button>
        </div>
      )}

      <ConfirmDialog
        open={loescheEintrag !== null}
        onClose={() => setLoescheEintrag(null)}
        onConfirm={() => loescheEintrag && eintragLoeschen.mutate({ id: loescheEintrag.id })}
        title="Eintrag löschen?"
        message={<>Der Eintrag <strong className="font-mono">{loescheEintrag?.wert}</strong> wird entfernt.</>}
        confirmText="Löschen" danger loading={eintragLoeschen.isPending}
      />
      <ConfirmDialog
        open={loescheNotiz}
        onClose={() => setLoescheNotiz(false)}
        onConfirm={() => notizLoeschen.mutate({ id: n.id })}
        title="Notiz endgültig löschen?"
        message={<>
          <strong>{n.titel}</strong> mit <strong>{eintraege.length}</strong> {eintraege.length === 1 ? "Eintrag" : "Einträgen"} wird
          für alle gelöscht. Das lässt sich nicht rückgängig machen — vorher bei Bedarf als Excel sichern.
        </>}
        confirmText="Endgültig löschen" danger loading={notizLoeschen.isPending}
      />
    </div>
  );
}
