"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { formatLogId } from "@/lib/pickup/logId";

// ── Gerätedetails beim Pickup ────────────────────────────────────────────────
//
// Tippt jemand auf eine LogID, öffnet sich diese Ansicht: Was ist das für ein
// Gerät, von wem, wo liegt es — und ein Bild davon.
//
// Warum das Bild: Wer eine Reihe abarbeitet, erkennt ein Gerät schneller am
// Aussehen als an „HP EliteBook 840 G5". Und wer die Baureihen nicht im Kopf
// hat, erkennt es überhaupt erst.
//
// ⚠️ Die Bildersammlung füllt sich von selbst. Es gibt keine Quelle, aus der
// man Fotos aller Notebookmodelle beziehen könnte — also fotografiert der, der
// ein Modell zum ersten Mal in der Hand hat, und alle danach sehen es. Deshalb
// steht der Aufnahmeknopf genau dort, wo jemand das Gerät gerade hält.

export type PickupPos = {
  id:          number;
  logId:       string;
  colli:       string | null;
  stellplatz:  string | null;
  bezeichnung: string | null;
  status:      string;
};

export function GeraetDetail({ pos, onClose }: { pos: PickupPos; onClose: () => void }) {
  const { show } = useToast();
  const utils = api.useUtils();
  const [laeuft, setLaeuft] = useState(false);

  const info = api.geraeteFotos.info.useQuery(
    { bezeichnung: pos.bezeichnung },
    { staleTime: 60_000 },
  );

  const speichern = api.geraeteFotos.speichern.useMutation({
    onSuccess: (r) => {
      show(r.ersetzt ? "Foto ersetzt" : "Foto gespeichert", "success");
      void utils.geraeteFotos.invalidate();
    },
    onError: (e) => show(e.message, "error"),
  });

  async function fotoAufnehmen(e: React.ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0];
    const anzeige = info.data?.anzeige;
    if (!datei || !anzeige) return;
    setLaeuft(true);
    try {
      // Vor dem Hochladen verkleinern: Ein 13-Megapixel-Foto als Nachschlagebild
      // wäre Verschwendung, und die Datenbank trägt es mit.
      const base64 = await verkleinere(datei, 1200);
      speichern.mutate({ anzeige, base64, mimeType: "image/jpeg" });
    } catch (err) {
      show((err as Error).message, "error");
    } finally {
      setLaeuft(false);
    }
  }

  const g = info.data;
  const bildUrl = g?.hatFoto
    ? `/api/geraete/foto?schluessel=${encodeURIComponent(g.schluessel)}&v=${g.fotoStand ?? ""}`
    : null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-white dark:bg-[#242526] rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Gerätedetails"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-[#ced4da] dark:border-[#3e4042]">
          <div className="min-w-0">
            <div className="font-mono font-black text-xl text-[#202F61] dark:text-[#e4e6eb]">
              {formatLogId(pos.logId)}
            </div>
            <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
              {pos.status === "GEFUNDEN" ? "✓ gefunden" : "noch offen"}
            </div>
          </div>
          <button onClick={onClose} aria-label="Schließen"
            className="text-2xl leading-none text-[#65676b] dark:text-[#b0b3b8] px-3 py-1 min-h-[44px]">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">

          {/* Bild oben: Es ist das, wonach gesucht wird. */}
          {bildUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={bildUrl} alt={g?.anzeige ?? "Gerät"}
              className="w-full rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a]" />
          ) : (
            <div className="rounded-xl border-2 border-dashed border-[#ced4da] dark:border-[#3e4042] p-6 text-center">
              <div className="text-3xl mb-1">📷</div>
              <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
                Von diesem Modell gibt es noch kein Bild.
              </div>
            </div>
          )}

          <dl className="space-y-2">
            <Zeile titel="Gerät"      wert={g?.modell ?? pos.bezeichnung ?? "—"} gross />
            <Zeile titel="Hersteller" wert={g?.hersteller ?? "unbekannt"} />
            <Zeile titel="Colli"      wert={pos.colli ?? "—"} />
            <Zeile titel="Stellplatz" wert={pos.stellplatz ?? "—"} />
          </dl>

          {/* Rohtext nur auf Wunsch: Er ist lang, unleserlich und für die
              Suche im Regal nutzlos — aber manchmal steht die Wahrheit drin. */}
          {pos.bezeichnung && pos.bezeichnung !== g?.modell && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-[#0064d2] dark:text-[#45bdff]">
                Originaltext aus ReForm
              </summary>
              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1 break-words">
                {pos.bezeichnung}
              </p>
            </details>
          )}

          {g && (
            <label className={`inline-flex items-center justify-center w-full px-5 py-3 rounded-xl font-bold min-h-[56px] cursor-pointer ${
              bildUrl
                ? "border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"
                : "bg-[#0064d2] text-white"
            }`}>
              {laeuft || speichern.isPending
                ? "Wird gespeichert…"
                : bildUrl ? "Besseres Foto aufnehmen" : "📷 Foto von diesem Modell aufnehmen"}
              <input type="file" accept="image/*" capture="environment"
                onChange={fotoAufnehmen} className="sr-only"
                disabled={laeuft || speichern.isPending} />
            </label>
          )}

          {g && (
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Das Foto gilt für alle Geräte vom Typ <strong>{g.anzeige}</strong>, nicht
              nur für dieses Stück. Einmal fotografieren, alle sehen es.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Zeile({ titel, wert, gross }: { titel: string; wert: string; gross?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] pt-0.5">
        {titel}
      </dt>
      <dd className={`flex-1 min-w-0 break-words text-[#1a1a1a] dark:text-[#e4e6eb] ${gross ? "text-lg font-bold" : ""}`}>
        {wert}
      </dd>
    </div>
  );
}

/** Bild auf eine vernünftige Kantenlänge bringen und als base64 zurückgeben. */
function verkleinere(datei: File, kante: number): Promise<string> {
  return new Promise((fertig, fehler) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => {
      const f = Math.min(1, kante / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width  = Math.max(1, Math.round(img.naturalWidth  * f));
      c.height = Math.max(1, Math.round(img.naturalHeight * f));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      fertig(c.toDataURL("image/jpeg", 0.85).replace(/^data:[^;]+;base64,/, ""));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fehler(new Error("Bild konnte nicht gelesen werden.")); };
    img.src = url;
  });
}
