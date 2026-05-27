"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { UserRolle } from "@prisma/client";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageLoader } from "@/components/ui/LoadingSpinner";

export default function BenutzerDetailPage() {
  const params   = useParams<{ id: string }>();
  const router   = useRouter();
  const { show } = useToast();
  const userId   = Number(params?.id);

  const { data: user, isLoading, refetch } = api.benutzer.getById.useQuery({ id: userId });
  const [form, setForm]       = useState<{ name: string; email: string; rolle: UserRolle }>({ name: "", email: "", rolle: UserRolle.TECHNIKER });
  const [newPw, setNewPw]     = useState("");
  const [deactOpen, setDeactOpen] = useState(false);

  useEffect(() => {
    if (user) setForm({ name: user.name, email: user.email, rolle: user.rolle });
  }, [user]);

  const update = api.benutzer.update.useMutation({
    onSuccess: () => { show("✅ Gespeichert", "success"); refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  const resetPw = api.benutzer.resetPassword.useMutation({
    onSuccess: () => { show("✅ Passwort zurückgesetzt", "success"); setNewPw(""); },
    onError:   (e) => show(e.message, "error"),
  });

  const deactivate = api.benutzer.deactivate.useMutation({
    onSuccess: () => { show("Benutzer deaktiviert", "warning"); router.push("/admin/benutzer"); },
    onError:   (e) => show(e.message, "error"),
  });

  // ── Standort-Zugriff ──────────────────────────────────────────────────────
  const accessQ      = api.benutzer.getStandortAccess.useQuery({ userId });
  const alleStandorteQ = api.standort.list.useQuery();
  const setzeAccess  = api.benutzer.setzeStandortAccess.useMutation({
    onSuccess: () => { show("✅ Standort-Zugriff aktualisiert", "success"); accessQ.refetch(); },
    onError:   (e) => show(e.message, "error"),
  });
  const [alleAktiv,    setAlleAktiv]    = useState(false);
  const [zusaetzlich,  setZusaetzlich]  = useState<Set<number>>(new Set());

  useEffect(() => {
    if (accessQ.data) {
      setAlleAktiv(accessQ.data.alleStandorte);
      setZusaetzlich(new Set(accessQ.data.zusaetzlicheStandortIds));
    }
  }, [accessQ.data]);

  if (isLoading) return <PageLoader />;
  if (!user) return <div className="text-[#fa3e3e]">Benutzer nicht gefunden.</div>;

  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-[#65676b] hover:text-[#0064d2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">{user.name}</h1>
        {!user.aktiv && <span className="text-xs bg-[#fa3e3e]/10 text-[#fa3e3e] px-2 py-1 rounded-full font-bold">Inaktiv</span>}
      </div>

      {/* Stammdaten */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] border-b border-[#ced4da] dark:border-[#3e4042] pb-3">Stammdaten</h2>
        {[
          { key: "name",  label: "Name",   type: "text" },
          { key: "email", label: "E-Mail", type: "email" },
        ].map(({ key, label, type }) => (
          <div key={key}>
            <label htmlFor={`field-${key}`} className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">{label}</label>
            <input id={`field-${key}`} type={type} value={(form as any)[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
          </div>
        ))}
        <div>
          <label htmlFor="kuerzel-field" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Kürzel (unveränderlich)</label>
          <input id="kuerzel-field" disabled value={user.kuerzel}
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5]/50 dark:bg-[#18191a]/50 text-[#65676b] dark:text-[#b0b3b8] font-mono" />
        </div>
        <div>
          <label htmlFor="rolle-field" className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Rolle</label>
          <select id="rolle-field" value={form.rolle} onChange={(e) => setForm((f) => ({ ...f, rolle: e.target.value as UserRolle }))}
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]">
            {Object.values(UserRolle).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button onClick={() => update.mutate({ id: userId, ...form })} disabled={update.isPending}
          className="px-6 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50">
          {update.isPending ? "..." : "Speichern"}
        </button>
      </div>

      {/* Standort-Zugriff */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] border-b border-[#ced4da] dark:border-[#3e4042] pb-3">
          Standort-Zugriff
        </h2>

        {accessQ.isLoading ? (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade…</p>
        ) : (
          <>
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
              Hauptstandort:{" "}
              <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">
                {alleStandorteQ.data?.find(s => s.id === accessQ.data?.hauptstandortId)?.name
                 ?? (accessQ.data?.hauptstandortId == null ? "—" : `#${accessQ.data.hauptstandortId}`)}
              </strong>
            </p>

            <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
              <input
                type="checkbox"
                checked={alleAktiv}
                onChange={(e) => setAlleAktiv(e.target.checked)}
                className="w-4 h-4 accent-[#0064d2]"
              />
              <span className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">
                Zugriff auf <em>alle</em> Standorte (Wildcard)
              </span>
            </label>

            {!alleAktiv && (
              <div>
                <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mb-2 uppercase font-bold">
                  Zusätzliche Standorte (Hauptstandort automatisch enthalten)
                </p>
                <div className="space-y-1">
                  {(alleStandorteQ.data ?? [])
                    .filter(s => s.aktiv && s.id !== accessQ.data?.hauptstandortId)
                    .map(s => {
                      const checked = zusaetzlich.has(s.id);
                      return (
                        <label key={s.id} className="flex items-center gap-2 cursor-pointer py-1.5 min-h-[44px]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setZusaetzlich(prev => {
                                const next = new Set(prev);
                                if (next.has(s.id)) next.delete(s.id);
                                else next.add(s.id);
                                return next;
                              });
                            }}
                            className="w-4 h-4 accent-[#0064d2]"
                          />
                          <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                            {s.name} <span className="text-[#65676b] dark:text-[#b0b3b8]">({s.kurzname})</span>
                          </span>
                        </label>
                      );
                    })}
                  {alleStandorteQ.data?.filter(s => s.aktiv && s.id !== accessQ.data?.hauptstandortId).length === 0 && (
                    <p className="text-xs text-[#65676b] dark:text-[#b0b3b8]">Keine weiteren Standorte verfügbar.</p>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={() =>
                setzeAccess.mutate({
                  userId,
                  alleStandorte:           alleAktiv,
                  zusaetzlicheStandortIds: alleAktiv ? [] : Array.from(zusaetzlich),
                })
              }
              disabled={setzeAccess.isPending}
              className="px-6 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
            >
              {setzeAccess.isPending ? "..." : "Standort-Zugriff speichern"}
            </button>

            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] italic">
              Hinweis: Änderungen wirken erst nach Re-Login beim betroffenen Benutzer.
            </p>
          </>
        )}
      </div>

      {/* Passwort */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] border-b border-[#ced4da] dark:border-[#3e4042] pb-3">Passwort zurücksetzen</h2>
        <label htmlFor="new-password" className="sr-only">Neues Passwort</label>
        <input id="new-password" type="password" placeholder="Neues Passwort (min. 8 Zeichen)" value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
        <button onClick={() => resetPw.mutate({ id: userId, newPassword: newPw })}
          disabled={newPw.length < 8 || resetPw.isPending}
          className="px-6 py-2.5 bg-[#f7b928] text-black font-bold rounded-xl hover:bg-yellow-500 disabled:opacity-50">
          {resetPw.isPending ? "..." : "Passwort setzen"}
        </button>
      </div>

      {/* Deaktivieren */}
      {user.aktiv && (
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#fa3e3e]/30 p-6 shadow-sm">
          <h2 className="font-bold text-[#fa3e3e] mb-2">Gefahrenzone</h2>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mb-4">Benutzer wird deaktiviert. Buchungshistorie bleibt erhalten.</p>
          <button onClick={() => setDeactOpen(true)}
            className="px-6 py-2.5 bg-[#fa3e3e] text-white font-bold rounded-xl hover:bg-red-600">
            Benutzer deaktivieren
          </button>
        </div>
      )}

      <ConfirmDialog
        open={deactOpen} onClose={() => setDeactOpen(false)}
        onConfirm={() => deactivate.mutate({ id: userId })}
        title="Benutzer deaktivieren" danger loading={deactivate.isPending}
        message={<>Benutzer <strong>{user.name}</strong> deaktivieren?</>}
        confirmText="Deaktivieren"
      />
    </div>
  );
}
