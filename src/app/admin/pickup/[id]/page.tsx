"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { useSocket } from "@/hooks/useSocket";
import { EVENTS } from "@/modules/realtime/events";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { formatLogId } from "@/lib/pickup/logId";
import { exportPickupCsv, printPickupBericht } from "@/lib/pickup/bericht";

function PosStatusBadge({ status }: { status: string }) {
  const gefunden = status === "GEFUNDEN";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${gefunden
      ? "bg-[#04B475]/10 text-[#04B475]"
      : "bg-[#65676b]/10 text-[#65676b] dark:text-[#b0b3b8]"}`}>
      {gefunden ? "Gefunden" : "Offen"}
    </span>
  );
}

function fmtDatum(d: Date | string): string {
  return new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function PickupDetailPage() {
  const { has, isLoading: permsLoading } = usePermissions();
  const darfManage = has("PICKUP_MANAGE");

  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const router = useRouter();
  const { show } = useToast();
  const utils = api.useUtils();

  const [loeschDialog, setLoeschDialog] = useState(false);

  const { data, isLoading, error } = api.pickup.details.useQuery(
    { id },
    { enabled: !permsLoading && darfManage && Number.isInteger(id) && id > 0 },
  );

  const loeschen = api.pickup.loeschen.useMutation({
    onSuccess: () => { show("Pickup-Auftrag gelöscht", "success"); router.push("/admin/pickup"); },
    onError:   (e) => show(e.message, "error"),
  });

  const wiederOeffnen = api.pickup.wiederOeffnen.useMutation({
    onSuccess: () => { show("Auftrag wieder geöffnet", "success"); utils.pickup.details.invalidate({ id }); },
    onError:   (e) => show(e.message, "error"),
  });

  // Live-Fortschritt (Socket): nur für DIESE id die Details invalidieren → ohne Reload.
  const { on, off, connected } = useSocket();
  useEffect(() => {
    const h = (d: unknown) => {
      const p = d as { auftragId: number };
      if (p.auftragId === id) void utils.pickup.details.invalidate({ id });
    };
    on(EVENTS.PICKUP_FORTSCHRITT, h);
    return () => off(EVENTS.PICKUP_FORTSCHRITT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, id]);

  // Positionen nach Colli gruppieren; Colli natürlich aufsteigend (ohne Colli zuletzt),
  // innerhalb nach Stellplatz, dann LogId.
  const gruppen = useMemo(() => {
    const positionen = data?.positionen ?? [];
    const map = new Map<string, typeof positionen>();
    for (const p of positionen) {
      const key = p.colli ?? "";
      const arr = map.get(key);
      if (arr) arr.push(p); else map.set(key, [p]);
    }
    const out = [...map.entries()].map(([colli, items]) => ({ colli, items }));
    out.sort((a, b) => {
      if (a.colli === "" && b.colli === "") return 0;
      if (a.colli === "") return 1;
      if (b.colli === "") return -1;
      return a.colli.localeCompare(b.colli, "de", { numeric: true });
    });
    for (const g of out) {
      g.items.sort((x, y) => {
        const s = (x.stellplatz ?? "").localeCompare(y.stellplatz ?? "", "de", { numeric: true });
        return s !== 0 ? s : x.logId.localeCompare(y.logId, "de", { numeric: true });
      });
    }
    return out;
  }, [data]);

  if (permsLoading) {
    return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Berechtigungen…</div>;
  }
  if (!darfManage) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Kein Zugriff auf Pickup. Bitte das Recht <strong>PICKUP_MANAGE</strong> bei der Rolle aktivieren.
      </div>
    );
  }
  if (isLoading) return <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade Auftrag…</div>;
  if (error || !data) {
    return (
      <div className="p-8 text-center text-sm text-[#65676b] dark:text-[#b0b3b8]">
        Auftrag nicht gefunden. <button onClick={() => router.push("/admin/pickup")} className="text-[#008BD2] font-semibold">Zurück zur Liste</button>
      </div>
    );
  }

  const gesamt        = data.positionen.length;
  const gefunden      = data.positionen.filter((p) => p.status === "GEFUNDEN").length;
  const offen         = gesamt - gefunden;
  const abgeschlossen = data.status === "abgeschlossen";
  const nichtGefundene = data.positionen.filter((p) => p.status !== "GEFUNDEN");
  const pct           = gesamt > 0 ? Math.round((gefunden / gesamt) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Kopf */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <button onClick={() => router.push("/admin/pickup")} className="text-[#65676b] hover:text-[#008BD2] text-sm mb-1">← Zurück zur Liste</button>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black text-[#202F61] dark:text-[#e4e6eb] truncate">{data.name}</h1>
            {abgeschlossen && (
              nichtGefundene.length === 0
                ? <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#04B475]/10 text-[#04B475]">Vollständig</span>
                : <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: "rgba(186,117,23,0.15)", color: "#BA7517" }}>Nicht komplett</span>
            )}
          </div>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            {data.status === "offen" ? "Offen" : "Abgeschlossen"} · {fmtDatum(data.createdAt)} · {data.ersteller?.kuerzel ?? data.ersteller?.name ?? "—"}
          </p>
          {data.bemerkung && (
            <div className="mt-2 inline-flex items-start gap-2 px-3 py-2 rounded-xl bg-[#008BD2]/10 text-[#202F61] dark:text-[#e4e6eb] text-sm">
              <span aria-hidden>📝</span>
              <span className="font-semibold whitespace-pre-wrap break-words">{data.bemerkung}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data.status === "offen" ? (
            <Link
              href={`/pickup/${id}`}
              className="inline-flex items-center gap-2 px-5 rounded-xl bg-[#008BD2] text-white text-sm font-bold hover:bg-[#0077b5] transition-colors shadow-sm min-h-[56px]"
            >
              ▶ Scannen
            </Link>
          ) : (
            <>
              <button
                onClick={() => exportPickupCsv(data)}
                className="inline-flex items-center gap-2 px-4 rounded-xl bg-[#008BD2] text-white text-sm font-bold hover:bg-[#0077b5] transition-colors shadow-sm min-h-[56px]"
              >
                ⬇ CSV-Export
              </button>
              <button
                onClick={() => printPickupBericht(data)}
                className="inline-flex items-center gap-2 px-4 rounded-xl border border-[#008BD2]/40 text-[#008BD2] dark:text-[#45bdff] text-sm font-bold hover:bg-[#008BD2]/10 transition-colors min-h-[56px]"
              >
                🖨️ Drucken
              </button>
              <button
                onClick={() => wiederOeffnen.mutate({ id })}
                disabled={wiederOeffnen.isPending}
                className="inline-flex items-center gap-2 px-4 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] text-sm font-bold hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] disabled:opacity-50 transition-colors min-h-[56px]"
              >
                {wiederOeffnen.isPending ? "…" : "↩ Wieder öffnen"}
              </button>
            </>
          )}
          <button
            onClick={() => setLoeschDialog(true)}
            className="inline-flex items-center gap-2 px-4 rounded-xl border border-[#fa3e3e]/40 text-[#fa3e3e] text-sm font-bold hover:bg-[#fa3e3e]/10 transition-colors min-h-[56px]"
          >
            🗑️ Löschen
          </button>
        </div>
      </div>

      {/* Abschlussbericht (abgeschlossen) bzw. einfache Zähler (offen) */}
      {abgeschlossen ? (
        <div className="bg-white dark:bg-[#242526] rounded-2xl border-2 border-[#04B475]/40 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-[#04B475]/10 border-b border-[#04B475]/30 flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-black text-sm uppercase tracking-wider text-[#04713f] dark:text-[#04B475]">✓ Abschlussbericht</h2>
            <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">
              Abgeschlossen: {data.abgeschlossenAm ? fmtDatum(data.abgeschlossenAm) : "—"}
              {(data.abschliesser?.kuerzel || data.abschliesser?.name) ? ` · ${data.abschliesser?.kuerzel ?? data.abschliesser?.name}` : ""}
            </span>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Gesamt",         value: gesamt,                color: "text-[#202F61] dark:text-[#e4e6eb]" },
                { label: "Gefunden",       value: gefunden,              color: "text-[#04B475]" },
                { label: "Nicht gefunden", value: nichtGefundene.length, color: "text-[#b3261e]" },
                { label: "Quote",          value: `${pct}%`,             color: "text-[#202F61] dark:text-[#e4e6eb]" },
              ].map((k) => (
                <div key={k.label} className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-4 text-center">
                  <div className={`text-2xl font-black ${k.color}`}>{k.value}</div>
                  <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{k.label}</div>
                </div>
              ))}
            </div>

            {nichtGefundene.length > 0 && (
              <div className="rounded-xl border border-[#fa3e3e]/30 overflow-hidden">
                <div className="px-4 py-2 bg-[#fa3e3e]/10 text-sm font-bold text-[#b3261e]">
                  ✗ Nicht gefunden ({nichtGefundene.length})
                </div>
                <div className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
                  {nichtGefundene.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2 flex-wrap gap-y-0.5 text-sm">
                      <span className="font-mono font-bold text-[#202F61] dark:text-[#e4e6eb] min-w-[110px]">{formatLogId(p.logId)}</span>
                      <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[70px]">Colli {p.colli ?? "—"}</span>
                      <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[70px]">{p.stellplatz ?? "—"}</span>
                      <span className="flex-1 min-w-0 truncate text-[#1a1a1a] dark:text-[#e4e6eb]" title={p.bezeichnung ?? ""}>{p.bezeichnung ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Gesamt",   value: gesamt,   color: "text-[#202F61] dark:text-[#e4e6eb]" },
            { label: "Offen",    value: offen,    color: "text-[#65676b] dark:text-[#b0b3b8]" },
            { label: "Gefunden", value: gefunden, color: "text-[#04B475]" },
          ].map((k) => (
            <div key={k.label} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] p-4 text-center">
              <div className={`text-2xl font-black ${k.color}`}>{k.value}</div>
              <div className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Positionen gruppiert nach Colli */}
      <div className="space-y-4">
        {gruppen.map((g) => (
          <div key={g.colli || "__ohne__"} className="bg-white dark:bg-[#242526] rounded-2xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-5 py-3 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042]">
              <h2 className="font-black text-sm text-[#202F61] dark:text-[#e4e6eb]">
                📦 Colli {g.colli || "— (ohne Colli)"}
              </h2>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#008BD2]/10 text-[#008BD2] dark:text-[#45bdff]">
                {g.items.filter((p) => p.status === "GEFUNDEN").length}/{g.items.length} gefunden
              </span>
            </div>
            <div className="divide-y divide-[#f0f2f5] dark:divide-[#3e4042]">
              {g.items.map((p) => (
                <div key={p.id} className="flex items-center gap-4 px-5 py-3 flex-wrap gap-y-1">
                  <div className="font-mono font-black text-base text-[#202F61] dark:text-[#e4e6eb] min-w-[120px]">
                    {formatLogId(p.logId)}
                  </div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] min-w-[90px]">
                    {p.stellplatz ?? "—"}
                  </div>
                  <div className="flex-1 min-w-0 text-sm text-[#1a1a1a] dark:text-[#e4e6eb] truncate" title={p.bezeichnung ?? ""}>
                    {p.bezeichnung ?? "—"}
                  </div>
                  <PosStatusBadge status={p.status} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Löschen-Bestätigung */}
      {loeschDialog && (
        <div role="dialog" aria-modal="true" aria-labelledby="pickup-del-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !loeschen.isPending && setLoeschDialog(false)}>
          <div className="bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 text-center space-y-3">
              <div className="text-4xl">🗑️</div>
              <h2 id="pickup-del-title" className="font-black text-lg text-[#202F61] dark:text-[#e4e6eb]">Pickup-Auftrag löschen?</h2>
              <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                <strong>{data.name}</strong><br />
                <span className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{gesamt} Positionen werden unwiderruflich gelöscht.</span>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button
                onClick={() => setLoeschDialog(false)}
                disabled={loeschen.isPending}
                className="flex-1 text-sm text-[#65676b] dark:text-[#b0b3b8] font-semibold border border-[#ced4da] dark:border-[#3e4042] rounded-xl hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors min-h-[56px] disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                onClick={() => loeschen.mutate({ id })}
                disabled={loeschen.isPending}
                className="flex-1 bg-[#fa3e3e] text-white text-sm font-bold rounded-xl hover:bg-red-600 disabled:opacity-50 transition-colors min-h-[56px]"
              >
                {loeschen.isPending ? "Lösche…" : "Endgültig löschen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
