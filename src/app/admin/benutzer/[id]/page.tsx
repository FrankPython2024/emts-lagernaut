"use client";
import { useEffect, useMemo, useState } from "react";
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

  // ── Zusatz-Rechte (zusätzlich zur Rolle) ──────────────────────────────────
  const permsQ  = api.rollen.listPermissions.useQuery();
  const extraQ  = api.benutzer.getExtraRechte.useQuery({ userId });
  const setExtra = api.benutzer.setExtraRechte.useMutation({
    onSuccess: () => { show("✅ Zusatz-Rechte gespeichert", "success"); extraQ.refetch(); },
    onError:   (e) => show(e.message, "error"),
  });
  const [extraSel, setExtraSel] = useState<Set<string>>(new Set());
  useEffect(() => { if (extraQ.data) setExtraSel(new Set(extraQ.data.extra)); }, [extraQ.data]);

  const rolleRechteSet = useMemo(() => new Set(extraQ.data?.rolleRechte ?? []), [extraQ.data]);
  const rechteGruppen = useMemo(() => {
    const map = new Map<string, { key: string; bezeichnung: string }[]>();
    for (const p of permsQ.data ?? []) {
      const arr = map.get(p.kategorie) ?? [];
      arr.push({ key: p.key, bezeichnung: p.bezeichnung });
      map.set(p.kategorie, arr);
    }
    return [...map.entries()];
  }, [permsQ.data]);

  // ── Entzogene Rechte (Deny — gewinnt über Rolle + Zusatzrecht) ─────────────
  const denyQ = api.benutzer.getEntzogeneRechte.useQuery({ userId });
  const setDeny = api.benutzer.setEntzogeneRechte.useMutation({
    onSuccess: () => { show("✅ Entzogene Rechte gespeichert", "success"); denyQ.refetch(); extraQ.refetch(); },
    onError:   (e) => show(e.message, "error"),
  });
  const [denySel, setDenySel] = useState<Set<string>>(new Set());
  useEffect(() => { if (denyQ.data) setDenySel(new Set(denyQ.data.deny)); }, [denyQ.data]);

  // Kandidaten = Rechte des Users über die Rolle ∪ bereits entzogene; SYSTEM_ADMIN NIE.
  const denyKandidatSet = useMemo(() => {
    const s = new Set<string>([...(denyQ.data?.rolleRechte ?? []), ...(denyQ.data?.deny ?? [])]);
    s.delete("SYSTEM_ADMIN");
    return s;
  }, [denyQ.data]);
  const denyGruppen = useMemo(() =>
    rechteGruppen
      .map(([kat, perms]) => [kat, perms.filter(p => denyKandidatSet.has(p.key))] as const)
      .filter(([, perms]) => perms.length > 0),
    [rechteGruppen, denyKandidatSet],
  );

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

      {/* Zusätzliche Rechte (zusätzlich zur Rolle) */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <div className="border-b border-[#ced4da] dark:border-[#3e4042] pb-3">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Zusätzliche Rechte (zusätzlich zur Rolle)</h2>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Einzelne Rechte zusätzlich zur Rolle <strong>{extraQ.data?.rolle ?? user.rolle}</strong>. Ausgegraute sind bereits durch die Rolle abgedeckt.
          </p>
        </div>

        {permsQ.isLoading || extraQ.isLoading ? (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade…</p>
        ) : (
          <>
            {rechteGruppen.map(([kategorie, perms]) => (
              <fieldset key={kategorie}>
                <legend className="text-xs uppercase font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1">{kategorie}</legend>
                <div className="space-y-0.5">
                  {perms.map((p) => {
                    const durchRolle = rolleRechteSet.has(p.key);
                    const checked    = durchRolle || extraSel.has(p.key);
                    return (
                      <label key={p.key} className={`flex items-center gap-2 py-1 min-h-[44px] ${durchRolle ? "opacity-60" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={durchRolle}
                          onChange={() => setExtraSel((prev) => {
                            const n = new Set(prev);
                            if (n.has(p.key)) n.delete(p.key); else n.add(p.key);
                            return n;
                          })}
                          className="w-4 h-4 accent-[#0064d2] flex-shrink-0"
                        />
                        <span className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                          {p.bezeichnung} <span className="text-[#65676b] dark:text-[#b0b3b8] font-mono text-[11px]">{p.key}</span>
                        </span>
                        {durchRolle && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#65676b]/10 text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">bereits durch Rolle</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}

            <button
              onClick={() => setExtra.mutate({ userId, rechte: [...extraSel].filter((k) => !rolleRechteSet.has(k)) })}
              disabled={setExtra.isPending}
              className="px-6 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
            >
              {setExtra.isPending ? "..." : "Zusatz-Rechte speichern"}
            </button>

            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] italic">
              Wirkt sofort (serverseitig live). Die Menü-/Sidebar-Anzeige beim Benutzer folgt nach kurzer Zeit (spätestens nach einem Reload) — <strong>kein Neu-Anmelden nötig</strong>.
            </p>
          </>
        )}
      </div>

      {/* Entzogene Rechte (Deny — überschreibt Rolle + Zusatzrechte) */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <div className="border-b border-[#ced4da] dark:border-[#3e4042] pb-3">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">Entzogene Rechte</h2>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Rechte, die der Account über seine Rolle <strong>{denyQ.data?.rolle ?? user.rolle}</strong> hat, hier gezielt entziehen.
            <strong> Entzug gewinnt immer</strong> — überschreibt Rolle und Zusatzrechte. Greift sofort für rechte-geprüfte Bereiche.
          </p>
        </div>

        {permsQ.isLoading || denyQ.isLoading ? (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">Lade…</p>
        ) : denyGruppen.length === 0 ? (
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Diese Rolle hat keine entziehbaren Einzelrechte (z. B. reine Admin-Rolle über die Wildcard).
          </p>
        ) : (
          <>
            {denyGruppen.map(([kategorie, perms]) => (
              <fieldset key={kategorie}>
                <legend className="text-xs uppercase font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1">{kategorie}</legend>
                <div className="space-y-0.5">
                  {perms.map((p) => {
                    const entzogen = denySel.has(p.key);
                    return (
                      <button
                        key={p.key}
                        type="button"
                        aria-pressed={entzogen}
                        onClick={() => setDenySel((prev) => {
                          const n = new Set(prev);
                          if (n.has(p.key)) n.delete(p.key); else n.add(p.key);
                          return n;
                        })}
                        className={`w-full flex items-center gap-2 py-1.5 px-2 min-h-[44px] rounded-lg text-left transition-colors ${
                          entzogen
                            ? "bg-[#fa3e3e]/10 hover:bg-[#fa3e3e]/15"
                            : "hover:bg-[#f0f2f5] dark:hover:bg-[#3a3b3c]"
                        }`}
                      >
                        <span className="w-5 text-center flex-shrink-0" aria-hidden>{entzogen ? "⛔" : "○"}</span>
                        <span className={`text-sm flex-1 ${entzogen ? "line-through text-[#fa3e3e]" : "text-[#1a1a1a] dark:text-[#e4e6eb]"}`}>
                          {p.bezeichnung} <span className="font-mono text-[11px] opacity-70">{p.key}</span>
                        </span>
                        {entzogen && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#fa3e3e]/15 text-[#fa3e3e] whitespace-nowrap">entzogen</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}

            {denySel.size > 0 && (
              <p className="text-xs text-[#fa3e3e] font-semibold">
                ⛔ {denySel.size} Recht(e) werden dem Account trotz Rolle entzogen.
              </p>
            )}

            <button
              onClick={() => setDeny.mutate({ userId, keys: [...denySel] })}
              disabled={setDeny.isPending}
              className="px-6 py-2.5 bg-[#fa3e3e] text-white font-bold rounded-xl hover:bg-red-600 disabled:opacity-50 min-h-[44px]"
            >
              {setDeny.isPending ? "..." : "Entzogene Rechte speichern"}
            </button>

            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] italic">
              SYSTEM_ADMIN ist nicht entziehbar (Schutz gegen Aussperrung). Wirkt sofort (serverseitig live); die Menü-Anzeige beim Benutzer folgt kurz danach — kein Neu-Anmelden nötig.
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
