"use client";
import { useState } from "react";
import { useDebounce } from "use-debounce";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageLoader } from "@/components/ui/LoadingSpinner";

export default function LagerplaetzePage() {
  const { show } = useToast();
  const { data: session } = useSession();
  const kuerzel = (session?.user as { kuerzel?: string })?.kuerzel ?? "ADMIN";

  const [suche,   setSuche]   = useState("");
  const [bereich, setBereich] = useState("");
  const [debouncedSuche]      = useDebounce(suche, 300);

  // Neuer Lagerplatz
  const [neuerCode, setNeuerCode] = useState("");

  // Verschieben-Modal State
  const [verschiebeVon,  setVerschiebeVon]  = useState<string | null>(null);
  const [verschiebeNach, setVerschiebeNach] = useState("");
  const [neuLagerplatz,  setNeuLagerplatz]  = useState("");
  const [confirmOpen,    setConfirmOpen]    = useState(false);

  const { data, isLoading, error, refetch } = api.lagerplaetze.getAll.useQuery(
    { bereich: bereich || undefined },
    { refetchOnMount: "always", staleTime: 0 },
  );
  const bereiche = api.lagerplaetze.getBereiche.useQuery();

  const anlegen = api.lagerplaetze.create.useMutation({
    onSuccess: (lp) => {
      show(`✅ Lagerplatz ${lp.code} angelegt`, "success");
      setNeuerCode("");
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const verschiebeAlle = api.lagerplaetze.verschiebeAlle.useMutation({
    onSuccess: (r) => {
      show(`✅ ${r.verschoben} Artikel: ${r.von} → ${r.nach}`, "success");
      setVerschiebeVon(null); setVerschiebeNach(""); setConfirmOpen(false);
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  if (isLoading) return <PageLoader />;
  if (error) return (
    <div className="p-6 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 rounded-xl text-[#fa3e3e]">
      Fehler: {error.message}
    </div>
  );

  const filtered = (data ?? []).filter((l) =>
    !debouncedSuche || l.lagerplatz.toLowerCase().includes(debouncedSuche.toLowerCase()),
  );

  const alleCodes = (data ?? []).map((l) => l.lagerplatz);

  const INPUT_CLS = "px-3 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Lagerplätze</h1>
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{filtered.length} Lagerplätze</p>
        </div>
      </div>

      {/* Neuer Lagerplatz */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm">
        <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-3">Neuer Lagerplatz</p>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[180px]">
            <input
              type="text"
              placeholder="z.B. HP-1-1-3"
              value={neuerCode}
              onChange={(e) => setNeuerCode(e.target.value.toUpperCase().replace(/[^A-Z0-9\-]/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && neuerCode) anlegen.mutate({ code: neuerCode }); }}
              className={`${INPUT_CLS} w-full font-mono tracking-wider`}
            />
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
              Format: BEREICH-REGAL-FACH-EBENE (HP, L=Lenovo, D=Dell, A=Acer)
            </p>
          </div>
          <button
            disabled={!neuerCode || anlegen.isPending}
            onClick={() => anlegen.mutate({ code: neuerCode })}
            className="px-5 py-2 bg-[#0064d2] text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm h-[38px]"
          >
            {anlegen.isPending ? "..." : "+ Anlegen"}
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-4 shadow-sm flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[180px]">
          <input type="text" placeholder="Lagerplatz suchen..."
            value={suche} onChange={(e) => setSuche(e.target.value)}
            className={`${INPUT_CLS} w-full pr-7`}
          />
          {suche && (
            <button onClick={() => setSuche("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#65676b] hover:text-[#fa3e3e] font-bold text-sm">✕</button>
          )}
        </div>
        <select value={bereich} onChange={(e) => setBereich(e.target.value)} className={INPUT_CLS}>
          <option value="">Alle Bereiche</option>
          {bereiche.data?.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Tabelle */}
      <div className="overflow-x-auto bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
              <th className="px-4 py-3 text-left">Lagerplatz</th>
              <th className="px-4 py-3 text-left">Bereich</th>
              <th className="px-4 py-3 text-center">Artikel</th>
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.lagerplatz} className="border-b border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] text-sm">
                <td className="px-4 py-3">
                  <span className="font-mono font-bold text-[#0064d2] dark:text-[#45bdff]">{l.lagerplatz}</span>
                  {l.artikelAnzahl === 0 && (
                    <span className="ml-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">leer</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 bg-[#f0f2f5] dark:bg-[#3e4042] rounded text-xs">{l.bereich}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`font-black text-lg ${l.artikelAnzahl > 0 ? "text-[#00a400]" : "text-[#65676b] dark:text-[#b0b3b8]"}`}>
                    {l.artikelAnzahl}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {l.artikelAnzahl > 0 && (
                    <button
                      onClick={() => { setVerschiebeVon(l.lagerplatz); setVerschiebeNach(""); }}
                      className="px-3 py-1 text-xs font-bold rounded-lg bg-[#f7b928]/10 text-[#f7b928] border border-[#f7b928]/30 hover:bg-[#f7b928]/20"
                    >
                      📦 Alle verschieben
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={4} className="text-center py-12 text-[#65676b] dark:text-[#b0b3b8]">Keine Lagerplätze</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Alle verschieben Modal */}
      <Modal open={!!verschiebeVon} onClose={() => setVerschiebeVon(null)} title="Alle Artikel verschieben">
        <div className="space-y-4">
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Alle Artikel von{" "}
            <span className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{verschiebeVon}</span>{" "}
            verschieben nach:
          </p>

          <select value={verschiebeNach} onChange={(e) => setVerschiebeNach(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]">
            <option value="">-- Vorhandenen Lagerplatz wählen --</option>
            {alleCodes.filter((c) => c !== verschiebeVon).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <div className="flex items-center gap-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">
            <span className="flex-1 h-px bg-[#ced4da] dark:bg-[#3e4042]" />
            <span>oder neuen Lagerplatz eingeben</span>
            <span className="flex-1 h-px bg-[#ced4da] dark:bg-[#3e4042]" />
          </div>

          <input type="text" placeholder="Neuer Lagerplatz-Code z.B. HP-2-1-1"
            value={neuLagerplatz} onChange={(e) => { setNeuLagerplatz(e.target.value.toUpperCase()); setVerschiebeNach(e.target.value.toUpperCase()); }}
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] font-mono" />

          <div className="flex gap-3">
            <button onClick={() => setVerschiebeVon(null)}
              className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
              Abbrechen
            </button>
            <button
              disabled={!verschiebeNach}
              onClick={() => setConfirmOpen(true)}
              className="flex-1 py-2.5 rounded-xl bg-[#f7b928] text-black font-bold hover:bg-yellow-500 disabled:opacity-50"
            >
              Weiter →
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          if (verschiebeVon && verschiebeNach) {
            verschiebeAlle.mutate({ alterLagerplatz: verschiebeVon, neuerLagerplatz: verschiebeNach, mitarbeiter: kuerzel });
          }
        }}
        title="Alle Artikel verschieben"
        message={
          <span>
            Alle Artikel von <strong className="font-mono">{verschiebeVon}</strong> nach{" "}
            <strong className="font-mono">{verschiebeNach}</strong> verschieben?
          </span>
        }
        confirmText="Verschieben"
        loading={verschiebeAlle.isPending}
      />
    </div>
  );
}
