"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import type { SessionUser } from "@/core/types";

const ROLLEN_FARBE: Record<string, string> = {
  ADMIN:          "bg-[#fa3e3e]/10 text-[#fa3e3e]",
  TECHNIKER:      "bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff]",
  BETRACHTER:     "bg-[#00a400]/10 text-[#00a400]",
  ADMIN_READONLY: "bg-[#f59e0b]/10 text-[#b45309] dark:text-[#fbbf24]",
  PICKUP:         "bg-[#8e44ad]/10 text-[#8e44ad] dark:text-[#c79df0]",
};

function Initials({ name }: { name: string }) {
  const parts = name.split(" ");
  const ini = parts.length >= 2 ? parts[0]![0] + parts[parts.length - 1]![0] : name.slice(0, 2);
  return (
    <div className="w-10 h-10 rounded-full bg-[#0064d2] text-white font-black text-sm flex items-center justify-center flex-shrink-0 uppercase">
      {ini}
    </div>
  );
}

// Confirm-Dialog-State: drei mögliche Aktionen, jeweils mit Ziel-User.
type ConfirmTarget =
  | { type: "toggle"; userId: number; name: string; aktivNeu: boolean }
  | { type: "delete"; userId: number; name: string }
  | { type: "reset";  userId: number; name: string; kuerzel: string };

export default function BenutzerPage() {
  const { show } = useToast();
  const { data: session } = useSession();
  const meId = (session?.user as SessionUser | undefined)?.id;

  const { data, isLoading, refetch } = api.benutzer.getAll.useQuery();
  const [zeigeInaktive, setZeigeInaktive] = useState(false);
  const [confirm,       setConfirm]      = useState<ConfirmTarget | null>(null);

  const toggle = api.benutzer.aktiviereDeaktiviere.useMutation({
    onSuccess: (_r, vars) => {
      show(vars.aktiv ? "Benutzer aktiviert" : "Benutzer deaktiviert", vars.aktiv ? "success" : "warning");
      setConfirm(null);
      refetch();
    },
    onError: (e) => { show(e.message, "error"); setConfirm(null); },
  });

  const loeschen = api.benutzer.loeschen.useMutation({
    onSuccess: (r) => { show(`User „${r.geloescht}" gelöscht`, "success"); setConfirm(null); refetch(); },
    onError:   (e) => { show(e.message, "error"); setConfirm(null); },
  });

  const resetPw = api.benutzer.resetPasswordDefault.useMutation({
    onSuccess: (r) => { show(`✅ Passwort für ${r.kuerzel} auf Standard zurückgesetzt`, "success"); setConfirm(null); },
    onError:   (e) => { show(e.message, "error"); setConfirm(null); },
  });

  const sichtbar = useMemo(
    () => (data ?? []).filter(u => zeigeInaktive || u.aktiv),
    [data, zeigeInaktive],
  );

  const counts = useMemo(
    () => (data ?? []).reduce((acc, u) => {
      acc[u.rolle] = (acc[u.rolle] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    [data],
  );

  const inaktiveAnzahl = (data ?? []).filter(u => !u.aktiv).length;

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Benutzer</h1>
          <div className="flex gap-3 mt-1 flex-wrap">
            {Object.entries(counts).map(([r, n]) => (
              <span key={r} className={`text-xs px-2 py-0.5 rounded-full font-bold ${ROLLEN_FARBE[r] ?? ""}`}>
                {n}× {r}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-[#65676b] dark:text-[#b0b3b8] min-h-[44px]">
            <input
              type="checkbox"
              checked={zeigeInaktive}
              onChange={(e) => setZeigeInaktive(e.target.checked)}
              className="w-4 h-4 accent-[#0064d2]"
            />
            Inaktive anzeigen{inaktiveAnzahl > 0 && <span className="text-[#65676b] dark:text-[#b0b3b8]">({inaktiveAnzahl})</span>}
          </label>
          <Link href="/admin/benutzer/neu" className="px-4 py-2 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 shadow-sm min-h-[44px] flex items-center">
            + Neuer Benutzer
          </Link>
        </div>
      </div>

      <div className="space-y-2">
        {sichtbar.map((u) => {
          const istIch = meId === u.id;
          return (
            <div
              key={u.id}
              className={`flex items-center gap-4 bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] px-5 py-4 shadow-sm flex-wrap gap-y-2 ${!u.aktiv ? "opacity-60" : ""}`}
            >
              <Initials name={u.name} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                  {u.name}
                  {!u.aktiv && <span className="ml-2 text-xs bg-[#65676b]/15 text-[#65676b] px-2 py-0.5 rounded-full font-bold uppercase">Inaktiv</span>}
                  {istIch  && <span className="ml-2 text-xs bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] px-2 py-0.5 rounded-full font-bold uppercase">Du</span>}
                </div>
                <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{u.email} · {u.kuerzel}</div>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${ROLLEN_FARBE[u.rolle] ?? ""}`}>
                {u.rolle}
              </span>
              <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] text-right">
                {u.lastLogin ? `Login: ${new Date(u.lastLogin).toLocaleDateString("de-DE")}` : "Noch kein Login"}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Link
                  href={`/admin/benutzer/${u.id}`}
                  className="px-3 py-2.5 text-xs font-semibold rounded-lg min-h-[44px] bg-[#f0f2f5] dark:bg-[#3e4042] hover:bg-[#ced4da] dark:hover:bg-[#555] flex items-center"
                >
                  ✏️ Bearbeiten
                </Link>

                {/* Passwort-Reset — nur für Nicht-Admins und nur wenn aktiv */}
                {u.rolle !== "ADMIN" && u.aktiv && (
                  <button
                    onClick={() => setConfirm({ type: "reset", userId: u.id, name: u.name, kuerzel: u.kuerzel })}
                    className="px-3 py-2.5 text-xs font-semibold rounded-lg min-h-[44px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                    title="Passwort auf Standard zurücksetzen"
                  >
                    🔄 Passwort reset
                  </button>
                )}

                {/* Aktivieren/Deaktivieren — Self-Lock-Schutz */}
                {!istIch && (
                  u.aktiv ? (
                    <button
                      onClick={() => setConfirm({ type: "toggle", userId: u.id, name: u.name, aktivNeu: false })}
                      className="px-3 py-2.5 text-xs font-semibold rounded-lg min-h-[44px] bg-[#fa3e3e]/10 text-[#fa3e3e] hover:bg-[#fa3e3e]/20"
                    >
                      Deaktivieren
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirm({ type: "toggle", userId: u.id, name: u.name, aktivNeu: true })}
                      className="px-3 py-2.5 text-xs font-semibold rounded-lg min-h-[44px] bg-[#00a400]/10 text-[#00a400] hover:bg-[#00a400]/20"
                    >
                      Aktivieren
                    </button>
                  )
                )}

                {/* Hart löschen — nur bei inaktiven Usern, nicht bei sich selbst */}
                {!istIch && !u.aktiv && (
                  <button
                    onClick={() => setConfirm({ type: "delete", userId: u.id, name: u.name })}
                    className="px-3 py-2.5 text-xs font-semibold rounded-lg min-h-[44px] bg-[#fa3e3e]/15 text-[#fa3e3e] hover:bg-[#fa3e3e]/25 border border-[#fa3e3e]/30"
                    title="Endgültig löschen (nur wenn keine Anfragen/Buchungen verknüpft)"
                  >
                    🗑️ Löschen
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {sichtbar.length === 0 && (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] text-center py-6">
            {zeigeInaktive ? "Keine Benutzer." : "Keine aktiven Benutzer. „Inaktive anzeigen“ aktivieren."}
          </p>
        )}
      </div>

      {/* Confirm: Aktivieren / Deaktivieren */}
      <ConfirmDialog
        open={confirm?.type === "toggle"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.type === "toggle") {
            toggle.mutate({ id: confirm.userId, aktiv: confirm.aktivNeu });
          }
        }}
        title={confirm?.type === "toggle" && confirm.aktivNeu ? "Benutzer aktivieren?" : "Benutzer deaktivieren?"}
        confirmText={confirm?.type === "toggle" && confirm.aktivNeu ? "Aktivieren" : "Deaktivieren"}
        danger={confirm?.type === "toggle" && !confirm.aktivNeu}
        loading={toggle.isPending}
        message={
          confirm?.type === "toggle" ? (
            confirm.aktivNeu ? (
              <>Benutzer <strong>{confirm.name}</strong> wieder aktivieren. Login wird sofort möglich.</>
            ) : (
              <>Benutzer <strong>{confirm.name}</strong> deaktivieren. Login wird gesperrt, historische Daten bleiben erhalten. Reversibel.</>
            )
          ) : null
        }
      />

      {/* Confirm: Hart löschen */}
      <ConfirmDialog
        open={confirm?.type === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.type === "delete") loeschen.mutate({ id: confirm.userId });
        }}
        title="Benutzer unwiderruflich löschen?"
        confirmText="Endgültig löschen"
        danger
        loading={loeschen.isPending}
        message={
          confirm?.type === "delete" ? (
            <>
              Benutzer <strong>{confirm.name}</strong> dauerhaft entfernen. Diese Aktion kann nicht
              rückgängig gemacht werden. Wenn der User noch Anfragen oder Buchungen hat, wird
              das Löschen serverseitig blockiert. Dann lieber deaktiviert lassen.
            </>
          ) : null
        }
      />

      {/* Confirm: Passwort-Reset */}
      <ConfirmDialog
        open={confirm?.type === "reset"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.type === "reset") resetPw.mutate({ id: confirm.userId });
        }}
        title="Passwort zurücksetzen?"
        confirmText="Ja, zurücksetzen"
        loading={resetPw.isPending}
        message={
          confirm?.type === "reset" ? (
            <>
              Passwort von <strong>{confirm.name}</strong> ({confirm.kuerzel}) wird auf{" "}
              <code className="bg-[#f0f2f5] dark:bg-[#3e4042] px-1 rounded font-mono">techniker123</code>{" "}
              gesetzt. Der Benutzer sollte es beim nächsten Login sofort ändern.
            </>
          ) : null
        }
      />
    </div>
  );
}
