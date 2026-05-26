"use client";
import { useState, useEffect, useMemo } from "react";
import { Plus, ShieldCheck, Trash2, Eye, EyeOff } from "lucide-react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { PageLoader } from "@/components/ui/LoadingSpinner";

const CYAN = "#008BD2";

type Permission = {
  id:          number;
  key:         string;
  kategorie:   string;
  bezeichnung: string;
};

export default function RollenAdminPage() {
  const { show } = useToast();
  const rollenQuery = api.rollen.list.useQuery();

  const aktualisieren = api.rollen.aktualisieren.useMutation({
    onSuccess: () => { rollenQuery.refetch(); show("Rolle aktualisiert", "success"); },
    onError:   (e) => show(e.message, "error"),
  });
  const loeschen = api.rollen.loeschen.useMutation({
    onSuccess: (r) => { rollenQuery.refetch(); show(`Rolle ${r.geloescht} gelöscht`, "success"); setDeleteId(null); },
    onError:   (e) => { show(e.message, "error"); setDeleteId(null); },
  });

  const [editPermsId, setEditPermsId] = useState<number | null>(null);
  const [neueOpen,    setNeueOpen]    = useState(false);
  const [deleteId,    setDeleteId]    = useState<{ id: number; name: string } | null>(null);

  if (rollenQuery.isLoading) return <PageLoader />;
  const rollen = rollenQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Rollen &amp; Berechtigungen</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Vorbereitung für RBAC. Phase 1+2: Datenstruktur und Verwaltung.
            Bestehende Berechtigungs-Checks bleiben unverändert bis Phase 3+4 produktiv geschaltet werden.
          </p>
        </div>
        <button
          onClick={() => setNeueOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold text-white transition-colors min-h-[44px]"
          style={{ background: CYAN }}
        >
          <Plus size={16} /> Neue Rolle
        </button>
      </div>

      <div className="grid gap-3">
        {rollen.map((r) => (
          <div
            key={r.id}
            className={`rounded-xl border bg-white dark:bg-[#242526] border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm ${!r.aktiv ? "opacity-60" : ""}`}
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {r.bezeichnung}
                  </h2>
                  {r.istSystem && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#008bd2]/15 text-[#008bd2] uppercase tracking-wider">
                      System
                    </span>
                  )}
                  {!r.aktiv && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#65676b]/15 text-[#65676b] dark:text-[#b0b3b8] uppercase tracking-wider">
                      Inaktiv
                    </span>
                  )}
                </div>
                <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
                  {r.beschreibung || <em>Keine Beschreibung</em>}
                </p>
                <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-2 font-mono">
                  {r._count.permissions} Berechtigungen · Name: {r.name}
                </p>
              </div>

              <div className="flex items-center gap-1 flex-wrap">
                <button
                  onClick={() => setEditPermsId(r.id)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff] hover:bg-[#0064d2]/20 font-bold text-sm min-h-[44px]"
                >
                  <ShieldCheck size={16} /> Berechtigungen
                </button>
                <button
                  onClick={() => aktualisieren.mutate({ id: r.id, aktiv: !r.aktiv })}
                  aria-label={r.aktiv ? "Deaktivieren" : "Aktivieren"}
                  title={r.aktiv ? "Rolle deaktivieren" : "Rolle aktivieren"}
                  className="w-11 h-11 flex items-center justify-center rounded-lg text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                >
                  {r.aktiv ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                {!r.istSystem && (
                  <button
                    onClick={() => setDeleteId({ id: r.id, name: r.bezeichnung })}
                    aria-label="Rolle löschen"
                    title="Rolle löschen"
                    className="w-11 h-11 flex items-center justify-center rounded-lg text-[#fa3e3e] hover:bg-[#fa3e3e]/10"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {editPermsId !== null && (
        <PermissionEditorModal
          rolleId={editPermsId}
          onClose={() => { setEditPermsId(null); rollenQuery.refetch(); }}
        />
      )}
      {neueOpen && (
        <NeueRolleModal
          onClose={(neueId) => {
            setNeueOpen(false);
            rollenQuery.refetch();
            if (neueId) setEditPermsId(neueId);
          }}
        />
      )}
      {deleteId && (
        <Modal open onClose={() => setDeleteId(null)} title="Rolle löschen?" width="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              Rolle <strong>{deleteId.name}</strong> wirklich löschen? Alle Berechtigungs-Verknüpfungen werden mit entfernt.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] min-h-[44px]"
              >
                Abbrechen
              </button>
              <button
                onClick={() => loeschen.mutate({ id: deleteId.id })}
                disabled={loeschen.isPending}
                className="flex-1 py-2 rounded-lg bg-[#fa3e3e] text-white font-bold disabled:opacity-50 min-h-[44px]"
              >
                {loeschen.isPending ? "Lösche…" : "Endgültig löschen"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── PermissionEditorModal ────────────────────────────────────────────────────

function PermissionEditorModal({ rolleId, onClose }: { rolleId: number; onClose: () => void }) {
  const { show } = useToast();
  const rolle      = api.rollen.get.useQuery({ id: rolleId });
  const alleQuery  = api.rollen.listPermissions.useQuery();

  const setzen = api.rollen.setzePermissions.useMutation({
    onSuccess: () => { show("Berechtigungen gespeichert", "success"); onClose(); },
    onError:   (e) => show(e.message, "error"),
  });

  const [selected,    setSelected]    = useState<Set<number>>(new Set());
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (rolle.data && !initialized) {
      setSelected(new Set(rolle.data.permissions.map(p => p.permissionId)));
      setInitialized(true);
    }
  }, [rolle.data, initialized]);

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of (alleQuery.data ?? []) as Permission[]) {
      if (!map.has(p.kategorie)) map.set(p.kategorie, []);
      map.get(p.kategorie)!.push(p);
    }
    return map;
  }, [alleQuery.data]);

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function speichern() {
    setzen.mutate({ rolleId, permissionIds: Array.from(selected) });
  }

  const title = rolle.data ? `Berechtigungen: ${rolle.data.bezeichnung}` : "Berechtigungen";
  const loading = rolle.isLoading || alleQuery.isLoading;

  return (
    <Modal open onClose={onClose} title={title} width="max-w-4xl">
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            {selected.size} von {alleQuery.data?.length ?? 0} Berechtigungen aktiv
          </div>

          {Array.from(grouped.entries()).map(([kategorie, perms]) => (
            <div key={kategorie}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] mb-2">
                {kategorie}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {perms.map((p) => {
                  const isOn = selected.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        isOn
                          ? "border-[#008bd2] bg-[#008bd2]/10"
                          : "border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#18191a] hover:border-[#008bd2]/50"
                      }`}
                      style={{ minHeight: 44 }}
                    >
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => toggle(p.id)}
                        className="mt-0.5 w-5 h-5 accent-[#008bd2] flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">
                          {p.bezeichnung}
                        </div>
                        <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] font-mono mt-0.5">
                          {p.key}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex justify-end gap-3 pt-4 border-t border-[#ced4da] dark:border-[#3e4042]">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] min-h-[44px]"
            >
              Abbrechen
            </button>
            <button
              onClick={speichern}
              disabled={setzen.isPending}
              className="px-5 py-2 rounded-lg text-white font-bold disabled:opacity-50 min-h-[44px]"
              style={{ background: CYAN }}
            >
              {setzen.isPending ? "Speichere…" : "Speichern"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── NeueRolleModal ───────────────────────────────────────────────────────────

function NeueRolleModal({ onClose }: { onClose: (neueId?: number) => void }) {
  const { show } = useToast();
  const [name,        setName]        = useState("");
  const [bezeichnung, setBezeichnung] = useState("");
  const [beschreibung, setBeschreibung] = useState("");

  const erstellen = api.rollen.erstellen.useMutation({
    onSuccess: (r) => { show(`Rolle ${r.name} angelegt`, "success"); onClose(r.id); },
    onError:   (e) => show(e.message, "error"),
  });

  const nameValid = /^[A-Z_][A-Z_0-9]*$/.test(name);
  const canSubmit = nameValid && bezeichnung.trim().length > 0 && !erstellen.isPending;

  function submit() {
    if (!canSubmit) return;
    erstellen.mutate({
      name:         name.trim(),
      bezeichnung:  bezeichnung.trim(),
      beschreibung: beschreibung.trim() || undefined,
    });
  }

  return (
    <Modal open onClose={() => onClose()} title="Neue Rolle anlegen" width="max-w-lg">
      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">
            Name (technisch)
          </span>
          <input
            value={name}
            onChange={e => setName(e.target.value.toUpperCase())}
            placeholder="PRAKTIKANT"
            className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] font-mono min-h-[44px]"
          />
          {name && !nameValid && (
            <p className="mt-1 text-xs text-[#fa3e3e]">
              Nur Großbuchstaben, Ziffern und Unterstrich; muss mit Buchstabe oder _ beginnen
            </p>
          )}
        </label>

        <label className="block">
          <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">
            Bezeichnung
          </span>
          <input
            value={bezeichnung}
            onChange={e => setBezeichnung(e.target.value)}
            placeholder="Praktikant"
            className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[44px]"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">
            Beschreibung (optional)
          </span>
          <input
            value={beschreibung}
            onChange={e => setBeschreibung(e.target.value)}
            placeholder="Begrenzter Zugriff für Praktikanten"
            className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[44px]"
          />
        </label>

        <div className="flex justify-end gap-3 pt-2 border-t border-[#ced4da] dark:border-[#3e4042]">
          <button
            onClick={() => onClose()}
            className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] min-h-[44px]"
          >
            Abbrechen
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-5 py-2 rounded-lg text-white font-bold disabled:opacity-50 min-h-[44px]"
            style={{ background: CYAN }}
          >
            {erstellen.isPending ? "…" : "Anlegen & Rechte vergeben"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
