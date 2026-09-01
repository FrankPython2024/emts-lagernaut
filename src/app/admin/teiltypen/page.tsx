"use client";
import { useState } from "react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";
import { getLucideIcon } from "@/lib/icons/getLucideIcon";
import { Plus, Eye, EyeOff, ChevronUp, ChevronDown, Save, X, Edit2, Layers } from "lucide-react";

const CYAN = "#008BD2";

type Teiltyp = {
  id:          number;
  name:        string;
  icon:        string | null;
  istStandard: boolean;
  sortierung:  number;
  aktiv:       boolean;
};

export default function TeiltypenAdminPage() {
  const { show } = useToast();
  const teiltypenQuery = api.teiltypen.list.useQuery({ nurAktive: false });

  const erstellen = api.teiltypen.erstellen.useMutation({
    onSuccess: () => { teiltypenQuery.refetch(); show("Teiltyp angelegt", "success"); resetNeu(); },
    onError:   (e) => show(e.message, "error"),
  });
  const aktualisieren = api.teiltypen.aktualisieren.useMutation({
    onSuccess: () => { teiltypenQuery.refetch(); show("Gespeichert", "success"); setEditId(null); },
    onError:   (e) => show(e.message, "error"),
  });

  // Neu-Formular
  const [neuOpen, setNeuOpen] = useState(false);
  const [neuName, setNeuName] = useState("");
  const [neuIcon, setNeuIcon] = useState("Box");
  function resetNeu() { setNeuName(""); setNeuIcon("Box"); setNeuOpen(false); }

  // ── Massenzuordnung ────────────────────────────────────────────────────────
  // Ein Teiltyp wie „Thermalmodul" steckt in praktisch jedem Laptop. Ihn an
  // jedem Modell einzeln anzuhaken ist nicht zumutbar, deshalb hier in einem
  // Rutsch — mit Trockenlauf davor, damit vorher klar ist, was passiert.
  const [massenId,      setMassenId]      = useState<number | null>(null);
  const [confirmWeg,    setConfirmWeg]    = useState(false);

  const stand = api.teiltypen.zuordnungsStand.useQuery(
    { teiltypId: massenId ?? 0 },
    { enabled: massenId !== null },
  );

  const zuordnen = api.teiltypen.allenModellenZuordnen.useMutation({
    onSuccess: (r) => {
      show(r.zugeordnet === 0
        ? `„${r.name}" war bereits allen ${r.modelleGesamt} Modellen zugeordnet`
        : `„${r.name}" ${r.zugeordnet} Modellen neu zugeordnet`, "success");
      stand.refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const entfernen = api.teiltypen.vonAllenModellenEntfernen.useMutation({
    onSuccess: (r) => {
      show(`„${r.name}" von ${r.entfernt} Modellen entfernt`, "success");
      setConfirmWeg(false);
      stand.refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  // Inline-Edit
  const [editId,   setEditId]   = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");

  function startEdit(t: Teiltyp) {
    setEditId(t.id);
    setEditName(t.name);
    setEditIcon(t.icon ?? "");
  }
  function saveEdit() {
    if (!editId) return;
    aktualisieren.mutate({ id: editId, name: editName.trim(), icon: editIcon.trim() || null });
  }

  if (teiltypenQuery.isLoading) return <PageLoader />;

  const alle    = (teiltypenQuery.data ?? []) as Teiltyp[];
  const aktive  = alle.filter(t => t.aktiv);
  const inaktiv = alle.filter(t => !t.aktiv);
  // Nur eigene Teiltypen sind modell-gebunden. Standards gelten ohnehin global,
  // eine Massenzuordnung waere fuer sie wirkungslos.
  const custom  = alle.filter(t => !t.istStandard);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Teiltypen</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Verwaltung der Teiltypen für Techniker-Anfragen.
            Standard-Teile sind markiert und werden bei Inaktiv-Schalten in der Techniker-Auswahl ausgeblendet.
          </p>
        </div>
        <button
          onClick={() => setNeuOpen(v => !v)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold text-white transition-colors min-h-[44px]"
          style={{ background: CYAN }}
        >
          <Plus size={16} /> Neuer Teiltyp
        </button>
      </div>

      {/* Neu-Formular */}
      {neuOpen && (
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold mb-3 text-[#1a1a1a] dark:text-[#e4e6eb]">Neuen Teiltyp anlegen</h2>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <label className="md:col-span-5 block">
              <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">Name</span>
              <input
                value={neuName}
                onChange={e => setNeuName(e.target.value)}
                placeholder="z. B. Lüfter"
                className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[44px]"
              />
            </label>
            <label className="md:col-span-4 block">
              <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">
                Icon (Lucide-Name)
              </span>
              <div className="flex items-center gap-2">
                <input
                  value={neuIcon}
                  onChange={e => setNeuIcon(e.target.value)}
                  placeholder="Box"
                  className="flex-1 px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[44px] font-mono text-sm"
                />
                <div className="w-11 h-11 rounded-lg border border-[#ced4da] dark:border-[#3e4042] flex items-center justify-center text-[#65676b] dark:text-[#b0b3b8] flex-shrink-0">
                  {(() => { const I = getLucideIcon(neuIcon); return <I size={20} />; })()}
                </div>
              </div>
            </label>
            <div className="md:col-span-3 flex gap-2">
              <button
                onClick={resetNeu}
                className="flex-1 px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] min-h-[44px]"
              >
                Abbrechen
              </button>
              <button
                onClick={() => erstellen.mutate({ name: neuName.trim(), icon: neuIcon.trim() || undefined })}
                disabled={!neuName.trim() || erstellen.isPending}
                className="flex-1 px-3 py-2 rounded-lg text-white font-bold disabled:opacity-50 min-h-[44px]"
                style={{ background: CYAN }}
              >
                {erstellen.isPending ? "…" : "Anlegen"}
              </button>
            </div>
          </div>
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-3">
            Icon-Namen aus{" "}
            <a href="https://lucide.dev/icons" target="_blank" rel="noopener noreferrer" className="text-[#0064d2] hover:underline">
              lucide.dev/icons
            </a>,
            z. B. Cpu, Monitor, Wifi, Battery, Box, Plug.
          </p>
        </div>
      )}

      {/* ── Massenzuordnung ──────────────────────────────────────────────── */}
      {custom.length > 0 && (
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] flex items-center gap-2">
            <Layers size={18} /> Teiltyp allen Gerätemodellen zuordnen
          </h2>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1 mb-4">
            Für Teile, die es in praktisch jedem Laptop gibt. Der Teiltyp erscheint danach
            bei jedem Modell in der Ersatzteil-Auswahl der Techniker.
          </p>

          <div className="flex flex-wrap gap-3 items-end">
            <label className="block flex-1 min-w-[240px]">
              <span className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase tracking-wider">
                Teiltyp
              </span>
              <select
                value={massenId ?? ""}
                onChange={(e) => { setMassenId(e.target.value ? Number(e.target.value) : null); setConfirmWeg(false); }}
                className="w-full px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] min-h-[44px]"
              >
                <option value="">auswählen</option>
                {custom.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.aktiv ? "" : " (inaktiv)"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {massenId !== null && stand.data && (
            <div className="mt-4 rounded-lg border border-[#008bd2]/30 bg-[#008bd2]/5 p-4">
              <div className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                <strong>{stand.data.modelleGesamt}</strong> aktive Gerätemodelle ·{" "}
                <strong>{stand.data.bereitsZugeordnet}</strong> haben „{stand.data.name}" bereits ·{" "}
                <strong>{stand.data.fehlend}</strong> fehlen noch
              </div>
              {!stand.data.aktiv && (
                <div className="text-sm text-[#c62828] dark:text-[#ff8a80] font-bold mt-2">
                  ⚠️ Dieser Teiltyp ist inaktiv. Er erscheint bei den Technikern erst,
                  wenn du ihn unten wieder aktiv schaltest.
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  onClick={() => zuordnen.mutate({ teiltypId: massenId })}
                  disabled={zuordnen.isPending || stand.data.fehlend === 0}
                  className="px-5 py-2.5 rounded-xl text-white font-bold disabled:opacity-50 min-h-[44px]"
                  style={{ background: CYAN }}
                >
                  {zuordnen.isPending
                    ? "…"
                    : stand.data.fehlend === 0
                      ? "Schon überall zugeordnet"
                      : `Allen ${stand.data.modelleGesamt} Modellen zuordnen`}
                </button>

                {stand.data.bereitsZugeordnet > 0 && !confirmWeg && (
                  <button
                    onClick={() => setConfirmWeg(true)}
                    className="px-4 py-2.5 rounded-xl border border-[#fa3e3e]/40 text-[#c62828] dark:text-[#ff8a80] font-bold hover:bg-[#fa3e3e]/10 min-h-[44px]"
                  >
                    Von allen Modellen entfernen
                  </button>
                )}
                {confirmWeg && (
                  <div className="flex gap-2 items-center flex-wrap">
                    <span className="text-sm font-bold text-[#c62828] dark:text-[#ff8a80]">
                      Wirklich von allen Modellen entfernen?
                    </span>
                    <button
                      onClick={() => entfernen.mutate({ teiltypId: massenId })}
                      disabled={entfernen.isPending}
                      className="px-4 py-2.5 rounded-xl bg-[#fa3e3e] text-white font-bold disabled:opacity-50 min-h-[44px]"
                    >
                      {entfernen.isPending ? "…" : "Ja, entfernen"}
                    </button>
                    <button
                      onClick={() => setConfirmWeg(false)}
                      className="px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-bold min-h-[44px]"
                    >
                      Abbrechen
                    </button>
                  </div>
                )}
              </div>

              <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-3">
                Die Zuordnung ist eine Momentaufnahme: Modelle, die später neu angelegt werden,
                bekommen den Teiltyp nicht von selbst. Dann diesen Knopf einfach erneut drücken.
                Schon zugeordnete Modelle bleiben unberührt.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Aktive Teiltypen */}
      <Section title={`Aktive Teiltypen (${aktive.length})`}>
        {aktive.length === 0 ? (
          <Leer text="Keine aktiven Teiltypen. Bitte Seed-Skript fahren oder Eintrag anlegen." />
        ) : (
          <List
            items={aktive}
            editId={editId}
            editName={editName}
            editIcon={editIcon}
            onEditName={setEditName}
            onEditIcon={setEditIcon}
            onStartEdit={startEdit}
            onCancelEdit={() => setEditId(null)}
            onSave={saveEdit}
            onToggle={(t) => aktualisieren.mutate({ id: t.id, aktiv: false })}
            onUp={(t)   => aktualisieren.mutate({ id: t.id, sortierung: t.sortierung - 5 })}
            onDown={(t) => aktualisieren.mutate({ id: t.id, sortierung: t.sortierung + 5 })}
            isPending={aktualisieren.isPending}
            inactiveSection={false}
          />
        )}
      </Section>

      {/* Inaktive Teiltypen */}
      {inaktiv.length > 0 && (
        <Section title={`Inaktiv (${inaktiv.length})`}>
          <List
            items={inaktiv}
            editId={editId}
            editName={editName}
            editIcon={editIcon}
            onEditName={setEditName}
            onEditIcon={setEditIcon}
            onStartEdit={startEdit}
            onCancelEdit={() => setEditId(null)}
            onSave={saveEdit}
            onToggle={(t) => aktualisieren.mutate({ id: t.id, aktiv: true })}
            onUp={undefined}
            onDown={undefined}
            isPending={aktualisieren.isPending}
            inactiveSection={true}
          />
        </Section>
      )}
    </div>
  );
}

// ── Sub-Komponenten ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-[#f0f2f5] dark:bg-[#18191a] border-b border-[#ced4da] dark:border-[#3e4042]">
        <h2 className="font-bold text-sm uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8]">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

function Leer({ text }: { text: string }) {
  return <div className="px-5 py-8 text-center text-[#65676b] dark:text-[#b0b3b8]">{text}</div>;
}

function List({
  items, editId, editName, editIcon,
  onEditName, onEditIcon, onStartEdit, onCancelEdit, onSave,
  onToggle, onUp, onDown, isPending, inactiveSection,
}: {
  items:           Teiltyp[];
  editId:          number | null;
  editName:        string;
  editIcon:        string;
  onEditName:      (v: string) => void;
  onEditIcon:      (v: string) => void;
  onStartEdit:     (t: Teiltyp) => void;
  onCancelEdit:    () => void;
  onSave:          () => void;
  onToggle:        (t: Teiltyp) => void;
  onUp?:           (t: Teiltyp) => void;
  onDown?:         (t: Teiltyp) => void;
  isPending:       boolean;
  inactiveSection: boolean;
}) {
  return (
    <ul className="divide-y divide-[#ced4da] dark:divide-[#3e4042]">
      {items.map((t) => {
        const Icon      = getLucideIcon(t.icon);
        const isEditing = editId === t.id;
        const EditIconC = getLucideIcon(editIcon);
        return (
          <li
            key={t.id}
            className={`flex items-center gap-3 px-5 py-3 ${inactiveSection ? "opacity-70" : ""}`}
          >
            {/* Icon-Vorschau */}
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-[#f0f2f5] dark:bg-[#18191a] text-[#65676b] dark:text-[#b0b3b8]">
              {isEditing ? <EditIconC size={20} /> : <Icon size={20} />}
            </div>

            {/* Name / Icon-Name (editierbar) */}
            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {isEditing ? (
                <>
                  <input
                    value={editName}
                    onChange={e => onEditName(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-[#0064d2] bg-white dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none min-h-[44px]"
                  />
                  <input
                    value={editIcon}
                    onChange={e => onEditIcon(e.target.value)}
                    placeholder="Icon-Name (Lucide)"
                    className="px-3 py-2 rounded-lg border border-[#0064d2] bg-white dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none font-mono text-sm min-h-[44px]"
                  />
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] truncate">{t.name}</span>
                    {t.istStandard && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#008bd2]/15 text-[#008bd2] uppercase tracking-wider flex-shrink-0">
                        Standard
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] font-mono truncate">
                    {t.icon ?? "—"} · #{t.sortierung}
                  </div>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {isEditing ? (
                <>
                  <button
                    onClick={onSave}
                    disabled={!editName.trim() || isPending}
                    aria-label="Speichern"
                    className="w-11 h-11 flex items-center justify-center rounded-lg text-white bg-[#0064d2] hover:bg-[#0056b3] disabled:opacity-50"
                  >
                    <Save size={16} />
                  </button>
                  <button
                    onClick={onCancelEdit}
                    aria-label="Abbrechen"
                    className="w-11 h-11 flex items-center justify-center rounded-lg text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                  >
                    <X size={16} />
                  </button>
                </>
              ) : (
                <>
                  {onUp && (
                    <button
                      onClick={() => onUp(t)}
                      aria-label="Nach oben sortieren"
                      title="Nach oben"
                      className="w-9 h-11 flex items-center justify-center rounded-lg text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                    >
                      <ChevronUp size={16} />
                    </button>
                  )}
                  {onDown && (
                    <button
                      onClick={() => onDown(t)}
                      aria-label="Nach unten sortieren"
                      title="Nach unten"
                      className="w-9 h-11 flex items-center justify-center rounded-lg text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                    >
                      <ChevronDown size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => onStartEdit(t)}
                    aria-label="Bearbeiten"
                    title="Name + Icon ändern"
                    className="w-11 h-11 flex items-center justify-center rounded-lg text-[#0064d2] hover:bg-[#0064d2]/10"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => onToggle(t)}
                    aria-label={t.aktiv ? "Deaktivieren" : "Aktivieren"}
                    title={t.aktiv ? "Aus Techniker-Auswahl ausblenden" : "Wieder einblenden"}
                    className={`w-11 h-11 flex items-center justify-center rounded-lg ${
                      t.aktiv
                        ? "text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]"
                        : "text-[#00a400] hover:bg-[#00a400]/10"
                    }`}
                  >
                    {t.aktiv ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
