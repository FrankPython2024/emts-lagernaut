"use client";

// ── Druckerkarte (3D-Druck Paket 3, Stufe 3) ──────────────────────────────────
// Zeigt an JEDEM PC, was die Druckbrücke am Laptop an Lagernaut meldet:
// Druckerzustand, Platte frei/belegt, Warteschlange, Fehler — und „fertig →
// einbuchen?", sobald ein aus Lagernaut gestarteter Druck fertig ist.
// ⚠️ „Platte ist leer" nur per Knopf (Frank, 24.09.2026): Wer an einem anderen
// PC druckt, sieht die Platte nicht. Frei wird sie erst, wenn jemand am Drucker
// es bestätigt; jeder Druck belegt sie wieder.

import { useState } from "react";
import Link from "next/link";
import { api } from "@/trpc/react";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { useDruckerStand } from "./useDruckbruecke";

const FARBE: Record<string, string> = {
  RUNNING: "bg-[#008BD2]/15 text-[#0064d2] dark:text-[#45bdff]",
  PREPARE: "bg-[#008BD2]/15 text-[#0064d2] dark:text-[#45bdff]",
  IDLE:    "bg-[#04B475]/15 text-[#037A4F] dark:text-[#3ddc97]",
  FINISH:  "bg-[#04B475]/15 text-[#037A4F] dark:text-[#3ddc97]",
  PAUSE:   "bg-[#BA7517]/15 text-[#8A5A00] dark:text-[#f7b928]",
  FAILED:  "bg-[#fa3e3e]/15 text-[#c01818] dark:text-[#ff6b6b]",
};
const karte = "bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm p-4";
const knopfRand = "inline-flex items-center justify-center px-3 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-sm font-bold text-[#202F61] dark:text-[#e4e6eb] min-h-[44px] disabled:opacity-50";

function fmtRest(min: number | null | undefined): string | null {
  if (min == null || min <= 0) return null;
  const h = Math.floor(min / 60);
  return h > 0 ? `noch ${h} h ${min % 60} min` : `noch ${min} min`;
}
const grad = (ist: number | null | undefined, ziel: number | null | undefined) =>
  ist == null ? "–" : `${Math.round(ist)}°${ziel ? ` / ${Math.round(ziel)}°` : ""}`;
const uhr = (d: Date | string | null) => (d ? new Date(d).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "");
function vorWann(d: Date | string | null): string {
  if (!d) return "noch nie";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return `vor ${s} s`;
  if (s < 5400) return `vor ${Math.round(s / 60)} min`;
  return new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function DruckerStatus() {
  const { has } = usePermissions();
  const darfStarten = has("DRUCK_STARTEN");
  const darfPlatte = has("ARTIKEL_EINLAGERN");
  const { data: s } = useDruckerStand({ nachfragen: true });
  const { show } = useToast();
  const utils = api.useUtils();
  const neu = () => void utils.druck.druckerStand.invalidate();
  const [platteFrage, setPlatteFrage] = useState(false);
  const [koppeln, setKoppeln] = useState(false);

  const platte = api.druck.platteIstLeer.useMutation({
    onSuccess: () => { setPlatteFrage(false); show("Platte ist frei — der nächste Druck darf starten.", "success"); neu(); },
    onError: (e) => show(e.message, "error"),
  });
  const abbrechen = api.druck.auftragAbbrechen.useMutation({ onSuccess: neu, onError: (e) => show(e.message, "error") });
  const ausblenden = api.druck.einbuchenAusblenden.useMutation({ onSuccess: neu });

  if (!s) return null;

  if (!s.gekoppelt) {
    if (!darfStarten) return null;
    return (
      <div className={`${karte} text-sm text-[#1a1a1a] dark:text-[#e4e6eb] space-y-2`}>
        <strong>🖨️ Druckbrücke noch nicht gekoppelt.</strong>
        <div className="text-[#65676b] dark:text-[#b0b3b8]">Einmal einen Schlüssel erzeugen und am Laptop beim Drucker eintragen — danach kann von jedem PC gedruckt werden.</div>
        <button type="button" className={knopfRand} onClick={() => setKoppeln(true)}>🔑 Druckbrücke koppeln</button>
        {koppeln && <KoppelnDialog onClose={() => setKoppeln(false)} />}
      </div>
    );
  }

  const d = s.drucker;
  const aktiv = d?.zustand === "RUNNING" || d?.zustand === "PREPARE" || d?.zustand === "PAUSE";
  const rest = fmtRest(d?.restMinuten);
  const fehler = s.zuletzt.filter((a) => a.status === "FEHLER").slice(0, 2);

  return (
    <div className={`${karte} space-y-3`} aria-live="polite">
      {/* Kopf: Drucker */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-black text-[#202F61] dark:text-[#e4e6eb]">🖨️ Drucker</span>
        {!s.online ? (
          <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold bg-[#65676b]/15 text-[#4b4f56] dark:text-[#b0b3b8]">
            Druckbrücke aus · zuletzt {vorWann(s.gemeldetAm)}
          </span>
        ) : s.verbindung !== "verbunden" ? (
          <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold bg-[#BA7517]/15 text-[#8A5A00] dark:text-[#f7b928]">
            Brücke ohne Verbindung zum Drucker{s.fehler ? ` — ${s.fehler}` : ""}
          </span>
        ) : d ? (
          <>
            <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold ${FARBE[d.zustand ?? ""] ?? "bg-[#65676b]/15 text-[#4b4f56] dark:text-[#b0b3b8]"}`}>{d.zustandText ?? "unbekannt"}</span>
            {(aktiv || d.zustand === "FINISH" || d.zustand === "FAILED") && d.datei && <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{d.datei}</span>}
            {d.fehlercode ? <span className="text-xs font-bold text-[#c01818] dark:text-[#ff6b6b]">Fehler {d.fehlercode}</span> : null}
            {(d.meldungen ?? 0) > 0 && <span className="text-xs font-bold text-[#8A5A00] dark:text-[#f7b928]">⚠ {d.meldungen} am Drucker</span>}
          </>
        ) : (
          <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">warte auf den ersten Bericht…</span>
        )}
      </div>

      {s.online && d && aktiv && d.fortschritt != null && (
        <div>
          <div className="flex justify-between text-xs font-semibold text-[#65676b] dark:text-[#b0b3b8] mb-1">
            <span>{d.fortschritt} %{d.schicht != null && d.schichten ? ` · Schicht ${d.schicht}/${d.schichten}` : ""}</span>
            {rest && <span>{rest}</span>}
          </div>
          <div className="h-2.5 rounded-full bg-[#f0f2f5] dark:bg-[#18191a] overflow-hidden" role="progressbar" aria-valuenow={d.fortschritt} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-[#008BD2] transition-all" style={{ width: `${Math.max(0, Math.min(100, d.fortschritt))}%` }} />
          </div>
        </div>
      )}
      {s.online && d && (
        <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
          Düse {grad(d.duese, d.dueseZiel)} · Bett {grad(d.bett, d.bettZiel)}
          {d.spule?.typ && <> · Spule {d.spule.typ}{d.spule.farbe && <span className="inline-block w-3 h-3 rounded-full align-middle ml-1 border border-[#ced4da]" style={{ background: d.spule.farbe }} aria-hidden />}</>}
        </div>
      )}

      {/* Platte */}
      <div className="flex items-center gap-2 flex-wrap">
        {s.platteFrei ? (
          <span className="text-sm font-bold text-[#037A4F] dark:text-[#3ddc97]">✓ Platte frei{s.platteFreiVon ? ` (${s.platteFreiVon}, ${uhr(s.platteFreiAm)})` : ""}</span>
        ) : (
          <span className="text-sm font-bold text-[#8A5A00] dark:text-[#f7b928]">⚠ Platte belegt</span>
        )}
        {!s.platteFrei && darfPlatte && !aktiv && (
          <button type="button" className={knopfRand} onClick={() => setPlatteFrage(true)}>✓ Platte ist leer</button>
        )}
      </div>

      {/* Warteschlange */}
      {s.warteschlange.length > 0 && (
        <ul className="space-y-1">
          {s.warteschlange.map((a, i) => (
            <li key={a.id} className="flex items-center gap-2 flex-wrap text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              <span className="flex-1 min-w-[200px]">
                {a.status === "ABGEHOLT" ? "📤" : "⏳"} <strong>{a.titel}</strong>
                <span className="text-[#65676b] dark:text-[#b0b3b8]"> · {a.erstelltVon} {uhr(a.createdAt)} · </span>
                {a.status === "ABGEHOLT" ? "wird an den Drucker übertragen…"
                  : i > 0 ? "wartet auf den vorherigen Auftrag"
                  : s.startbereit ? "startet gleich" : <span className="text-[#8A5A00] dark:text-[#f7b928]">wartet: {s.wartegrund}</span>}
              </span>
              {a.status === "WARTET" && darfStarten && (
                <button type="button" className={knopfRand} disabled={abbrechen.isPending} onClick={() => abbrechen.mutate({ id: a.id })}>Abbrechen</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {fehler.map((a) => (
        <div key={a.id} role="alert" className="rounded-xl bg-[#fa3e3e]/10 px-3 py-2 text-sm text-[#c01818] dark:text-[#ff6b6b]">
          ⚠ <strong>{a.titel}</strong> ({uhr(a.createdAt)}) nicht gestartet: {a.meldung}
        </div>
      ))}

      {s.einbuchen && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl bg-[#04B475]/10 px-3 py-2">
          <span className="text-sm font-bold text-[#037A4F] dark:text-[#3ddc97] flex-1 min-w-[180px]">✓ „{s.einbuchen.titel}“ ist fertig gedruckt.</span>
          <Link href={`/admin/druck/${s.einbuchen.vorlageId}#fertig`} className="inline-flex items-center px-4 rounded-xl bg-[#037A4F] text-white text-sm font-bold min-h-[48px]">
            Jetzt einbuchen
          </Link>
          <button type="button" onClick={() => s.einbuchen && ausblenden.mutate({ auftragId: s.einbuchen.auftragId })}
            className="px-3 rounded-xl text-sm font-semibold text-[#65676b] dark:text-[#b0b3b8] min-h-[48px]">Ausblenden</button>
        </div>
      )}

      {darfStarten && (
        <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
          Druckbrücke {s.version ?? "?"} · gemeldet {vorWann(s.gemeldetAm)} ·{" "}
          <button type="button" className="underline" onClick={() => setKoppeln(true)}>Schlüssel neu erzeugen</button>
        </div>
      )}

      <Modal open={platteFrage} onClose={() => setPlatteFrage(false)} title="Platte ist leer?">
        <p className="text-base text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">
          Sind die gedruckten Teile abgenommen und die Platte wieder sauber eingelegt? Danach darf der nächste Druck
          <strong> ohne weitere Rückfrage</strong> starten — auch von einem anderen PC aus.
        </p>
        <div className="flex gap-3">
          <button type="button" className={`${knopfRand} flex-1 min-h-[56px]`} onClick={() => setPlatteFrage(false)}>Abbrechen</button>
          <button type="button" disabled={platte.isPending} onClick={() => platte.mutate()}
            className="flex-1 rounded-xl bg-[#037A4F] text-white text-sm font-black min-h-[56px] disabled:opacity-50">✓ Ja, Platte ist leer</button>
        </div>
      </Modal>
      {koppeln && <KoppelnDialog onClose={() => setKoppeln(false)} />}
    </div>
  );
}

// Schlüssel erzeugen — wird genau EINMAL gezeigt, gespeichert wird nur der Hash.
function KoppelnDialog({ onClose }: { onClose: () => void }) {
  const { show } = useToast();
  const utils = api.useUtils();
  const koppeln = api.druck.brueckeKoppeln.useMutation({
    onSuccess: () => void utils.druck.druckerStand.invalidate(),
    onError: (e) => show(e.message, "error"),
  });
  const schluessel = koppeln.data?.schluessel;
  return (
    <Modal open onClose={onClose} title="Druckbrücke koppeln">
      {!schluessel ? (
        <div className="space-y-4 text-base text-[#1a1a1a] dark:text-[#e4e6eb]">
          <p>Erzeugt einen neuen Schlüssel für die Druckbrücke am Laptop beim Drucker. <strong>Ein vorhandener Schlüssel wird damit ungültig.</strong></p>
          <div className="flex gap-3">
            <button type="button" className={`${knopfRand} flex-1 min-h-[56px]`} onClick={onClose}>Abbrechen</button>
            <button type="button" disabled={koppeln.isPending} onClick={() => koppeln.mutate()}
              className="flex-1 rounded-xl bg-[#008BD2] text-white text-sm font-black min-h-[56px] disabled:opacity-50">🔑 Schlüssel erzeugen</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
          <p className="font-bold">Schlüssel — wird nur jetzt angezeigt:</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 break-all rounded-xl bg-[#f0f2f5] dark:bg-[#18191a] px-3 py-3 font-mono text-base select-all">{schluessel}</code>
            <button type="button" className={knopfRand} onClick={() => { void navigator.clipboard?.writeText(schluessel); show("Kopiert", "success"); }}>📋</button>
          </div>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Am Laptop beim Drucker die Datei <code>.lagernaut-druckbruecke.json</code> im Benutzerordner öffnen.</li>
            <li>Bei <code>&quot;brueckenSchluessel&quot;</code> diesen Schlüssel eintragen und speichern.</li>
            <li>Die Druckbrücke neu starten — im Fenster erscheint „✓ Mit Lagernaut verbunden“.</li>
          </ol>
          <button type="button" className={`${knopfRand} w-full min-h-[56px]`} onClick={onClose}>Fertig</button>
        </div>
      )}
    </Modal>
  );
}
