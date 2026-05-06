"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

const STANDARD_TEILE = [
  "Displaymodul","Tastatur","Touchpad","Füße vorne","Füße hinten",
  "D Cover","USB Board","Power Button","Lautsprecher","Lüfter",
  "Thermalmodul","BIOS Batterie","Akku",
];

export default function ModellNeuPage() {
  const router = useRouter();
  const { show } = useToast();
  const [hersteller, setHersteller] = useState("");
  const [modell, setModell]         = useState("");
  const [result, setResult]         = useState<{ teil: string; id: number }[] | null>(null);

  const anlegen = api.geraete.legeModellAn.useMutation({
    onSuccess: (data) => {
      setResult(data.angelegtTeile.map((t) => ({ teil: t.teiltyp, id: t.artikelId })));
      show(`✅ ${data.modell.hersteller} ${data.modell.modell} angelegt!`, "success");
    },
    onError: (e) => show(e.message, "error"),
  });

  if (result) {
    return (
      <div className="max-w-lg space-y-5">
        <h1 className="text-2xl font-black text-[#00a400]">✅ Modell angelegt!</h1>
        <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm">
          <p className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] mb-3">{hersteller} {modell} — {result.length} Artikel angelegt:</p>
          <div className="space-y-1.5">
            {result.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-[#ced4da] dark:border-[#3e4042] last:border-0 text-sm">
                <span className="text-[#1a1a1a] dark:text-[#e4e6eb]">{t.teil}</span>
                <span className="font-mono text-xs text-[#65676b] dark:text-[#b0b3b8]">ID #{t.id}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => { setResult(null); setHersteller(""); setModell(""); }}
            className="flex-1 py-2.5 bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold rounded-xl">
            Weiteres Modell
          </button>
          <button onClick={() => router.push("/admin/modelle")}
            className="flex-1 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700">
            Zur Übersicht
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-[#65676b] hover:text-[#0064d2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Neues Modell</h1>
      </div>

      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Hersteller</label>
          <input value={hersteller} onChange={(e) => setHersteller(e.target.value)} placeholder="z.B. HP"
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
        </div>
        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Modell</label>
          <input value={modell} onChange={(e) => setModell(e.target.value)} placeholder="z.B. EliteBook 840 G5"
            className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]" />
        </div>

        <div>
          <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-2">Automatisch angelegte Teile:</p>
          <div className="grid grid-cols-2 gap-1.5">
            {STANDARD_TEILE.map((t) => (
              <div key={t} className="flex items-center gap-2 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                <span className="text-[#00a400] text-xs">✓</span> {t}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={() => router.back()}
            className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
            Abbrechen
          </button>
          <button
            disabled={!hersteller || !modell || anlegen.isPending}
            onClick={() => anlegen.mutate({ hersteller, modell })}
            className="flex-1 py-2.5 rounded-xl bg-[#0064d2] text-white font-bold hover:bg-blue-700 disabled:opacity-50">
            {anlegen.isPending ? "..." : "Anlegen"}
          </button>
        </div>
      </div>
    </div>
  );
}
