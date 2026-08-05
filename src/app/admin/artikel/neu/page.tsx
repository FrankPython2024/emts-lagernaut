"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

export default function ArtikelNeuPage() {
  const router = useRouter();
  const { show } = useToast();
  const utils = api.useUtils();
  const [form, setForm] = useState({ bezeichnung: "", kategorie: "", lagerplatz: "", preis: "" });

  const kategorien = api.lager.getKategorien.useQuery();
  const [neueKat, setNeueKat] = useState(false);

  const erstellen = api.lager.create.useMutation({
    onSuccess: async (a) => {
      show(`✅ Artikel #${a.id} angelegt`, "success");
      await utils.lager.getAll.invalidate();
      await utils.lager.getKategorien.invalidate();
      router.push("/admin/artikel");
    },
    onError: (e) => show(e.message, "error"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.bezeichnung || !form.kategorie) return;

    // Deutsches Komma zulassen; leer = kein Einzelpreis (Kategoriepreis gilt).
    const roh   = form.preis.trim().replace(",", ".");
    const preis = roh === "" ? null : Number(roh);
    if (preis !== null && !Number.isFinite(preis)) { show("Preis ist keine gültige Zahl", "error"); return; }

    erstellen.mutate({
      bezeichnung: form.bezeichnung,
      kategorie:   form.kategorie,
      lagerplatz:  form.lagerplatz || undefined,
      preis,
    });
  }

  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-[#65676b] hover:text-[#0064d2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Neuer Artikel</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Bezeichnung *</label>
          <input
            required value={form.bezeichnung} onChange={(e) => setForm((f) => ({ ...f, bezeichnung: e.target.value }))}
            placeholder="z.B. 840 G5 Akku"
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Kategorie *</label>
          {neueKat ? (
            <input
              required value={form.kategorie} onChange={(e) => setForm((f) => ({ ...f, kategorie: e.target.value }))}
              placeholder="Neue Kategorie eingeben"
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            />
          ) : (
            <select
              value={form.kategorie} onChange={(e) => setForm((f) => ({ ...f, kategorie: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            >
              <option value="">-- Kategorie wählen --</option>
              {kategorien.data?.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          )}
          <button type="button" onClick={() => { setNeueKat((n) => !n); setForm((f) => ({ ...f, kategorie: "" })); }}
            className="text-xs text-[#0064d2] dark:text-[#45bdff] mt-1 hover:underline">
            {neueKat ? "← Vorhandene wählen" : "+ Neue Kategorie"}
          </button>
        </div>

        {/* Einzelpreis gleich hier — bei Festplatten/RAM sagt die Kategorie
            nichts über den Wert, und beim Anlegen vieler Varianten spart es
            den zweiten Weg über die Detailseite. */}
        <div>
          <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Einzelpreis € (optional)</label>
          <input
            type="text" inputMode="decimal"
            value={form.preis} onChange={(e) => setForm((f) => ({ ...f, preis: e.target.value }))}
            placeholder="leer = Kategoriepreis verwenden"
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
          />
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Nötig, wo die Kategorie den Wert nicht trifft — z. B. 256-GB-SSD gegen 2-TB-NVMe.
          </p>
        </div>

        <div>
          <label className="block text-sm font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-1">Lagerplatz (optional)</label>
          <input
            value={form.lagerplatz} onChange={(e) => setForm((f) => ({ ...f, lagerplatz: e.target.value }))}
            placeholder="z.B. R1-F3"
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold hover:bg-[#ced4da] dark:hover:bg-[#555]">
            Abbrechen
          </button>
          <button type="submit" disabled={erstellen.isPending}
            className="flex-1 py-2.5 rounded-xl bg-[#0064d2] text-white font-bold hover:bg-blue-700 disabled:opacity-50">
            {erstellen.isPending ? "..." : "Anlegen"}
          </button>
        </div>
      </form>
    </div>
  );
}
