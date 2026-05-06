"use client";
import { useState } from "react";
import { BuchungsTyp } from "@prisma/client";
import { useDebounce } from "use-debounce";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { PageLoader } from "@/components/ui/LoadingSpinner";

const TYP_FARBE: Record<BuchungsTyp, string> = {
  EINGANG: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  AUSGANG: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  DIREKT:  "bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400",
};

export default function BuchungenPage() {
  const { show } = useToast();
  const [typFilter, setTypFilter]     = useState<BuchungsTyp | "">("");
  const [suchArtikel, setSuchArtikel] = useState("");
  const [debArtikel]                  = useDebounce(suchArtikel, 300);
  const [selArtikelId, setSelArtikelId] = useState<number | null>(null);
  const [form, setForm] = useState({ menge: 1, typ: BuchungsTyp.EINGANG, mitarbeiter: "", notiz: "" });

  const { data, isLoading, refetch } = api.buchungen.getAll.useQuery({
    ...(typFilter ? { typ: typFilter as BuchungsTyp } : {}),
    limit: 100, offset: 0,
  });

  const suche = api.lager.searchAdmin.useQuery({ query: debArtikel }, { enabled: debArtikel.length >= 2 });

  const buchen = api.buchungen.create.useMutation({
    onSuccess: (b) => {
      show(`✅ ${b.bezeichnung}: ${b.typ} ×${b.menge} | Bestand: ${b.neuerBestand}`, "success");
      setForm({ menge: 1, typ: BuchungsTyp.EINGANG, mitarbeiter: "", notiz: "" });
      setSuchArtikel(""); setSelArtikelId(null);
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  const selArtikelBezeichnung = suche.data?.find((a) => a.id === selArtikelId)?.bezeichnung ?? "";

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Buchungen</h1>

      {/* Buchungs-Formular */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-4">Manuelle Buchung</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Artikel-Suche */}
          <div className="relative col-span-1 md:col-span-2">
            <input
              type="text"
              placeholder="Artikel suchen..."
              value={selArtikelId ? selArtikelBezeichnung : suchArtikel}
              onChange={(e) => { setSelArtikelId(null); setSuchArtikel(e.target.value); }}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            />
            {!selArtikelId && suche.data && suche.data.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-20 bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] rounded-xl shadow-xl mt-1 max-h-48 overflow-y-auto">
                {suche.data.map((a) => (
                  <button key={a.id} onClick={() => { setSelArtikelId(a.id); setSuchArtikel(a.bezeichnung); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] text-sm border-b border-[#ced4da] dark:border-[#3e4042] last:border-0">
                    <span className="font-semibold text-[#1a1a1a] dark:text-[#e4e6eb]">{a.bezeichnung}</span>
                    <span className={`ml-2 text-xs font-bold ${a.bestand > 0 ? "text-[#00a400]" : "text-[#fa3e3e]"}`}>Bestand: {a.bestand}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {([BuchungsTyp.EINGANG, BuchungsTyp.AUSGANG] as BuchungsTyp[]).map((t) => (
              <button key={t} onClick={() => setForm((f) => ({ ...f, typ: t }))}
                className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-colors ${form.typ === t ? "bg-[#0064d2] text-white" : "bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8]"}`}>
                {t === BuchungsTyp.EINGANG ? "📥 Ein" : "📤 Aus"}
              </button>
            ))}
          </div>

          <input type="number" min={1} value={form.menge} onChange={(e) => setForm((f) => ({ ...f, menge: Number(e.target.value) }))}
            className="px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />

          <input placeholder="Mitarbeiter *" value={form.mitarbeiter} onChange={(e) => setForm((f) => ({ ...f, mitarbeiter: e.target.value }))}
            className="px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />

          <input placeholder="Notiz (optional)" value={form.notiz} onChange={(e) => setForm((f) => ({ ...f, notiz: e.target.value }))}
            className="col-span-1 md:col-span-2 px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />

          <button
            disabled={!selArtikelId || !form.mitarbeiter || buchen.isPending}
            onClick={() => selArtikelId && buchen.mutate({ artikelId: selArtikelId, menge: form.menge, typ: form.typ, mitarbeiter: form.mitarbeiter, notiz: form.notiz || undefined })}
            className="py-2.5 bg-[#0064d2] text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 shadow-sm">
            {buchen.isPending ? "..." : "Buchen"}
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-3 flex-wrap items-center">
        <select value={typFilter} onChange={(e) => setTypFilter(e.target.value as BuchungsTyp | "")}
          className="px-4 py-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] text-sm">
          <option value="">Alle Typen</option>
          <option value="EINGANG">Eingang</option>
          <option value="AUSGANG">Ausgang</option>
          <option value="DIREKT">Direkt</option>
        </select>
        <span className="text-sm text-[#65676b] dark:text-[#b0b3b8]">{data?.total ?? 0} Buchungen</span>
      </div>

      {/* Tabelle */}
      {isLoading ? <PageLoader /> : (
        <div className="overflow-x-auto bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-[#f0f2f5] dark:bg-[#18191a] text-xs font-bold uppercase text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042]">
                <th className="px-4 py-3 text-left">Datum</th>
                <th className="px-4 py-3 text-left">Mitarbeiter</th>
                <th className="px-4 py-3 text-left">Artikel</th>
                <th className="px-4 py-3 text-center">Typ</th>
                <th className="px-4 py-3 text-center">Menge</th>
                <th className="px-4 py-3 text-left">Notiz</th>
              </tr>
            </thead>
            <tbody>
              {data?.buchungen.map((b) => (
                <tr key={b.id} className="border-b border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] text-sm">
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8] whitespace-nowrap">{new Date(b.datum).toLocaleDateString("de-DE")}</td>
                  <td className="px-4 py-3 font-medium text-[#1a1a1a] dark:text-[#e4e6eb]">{b.mitarbeiter}</td>
                  <td className="px-4 py-3 text-[#1a1a1a] dark:text-[#e4e6eb]">{b.bezeichnung}</td>
                  <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded text-xs font-bold ${TYP_FARBE[b.typ]}`}>{b.typ}</span></td>
                  <td className="px-4 py-3 text-center font-black">{b.menge}</td>
                  <td className="px-4 py-3 text-[#65676b] dark:text-[#b0b3b8] text-xs">{b.notiz ?? "–"}</td>
                </tr>
              ))}
              {!data?.buchungen.length && (
                <tr><td colSpan={6} className="text-center py-12 text-[#65676b] dark:text-[#b0b3b8]">Keine Buchungen</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
