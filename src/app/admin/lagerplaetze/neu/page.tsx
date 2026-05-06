"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

const BEREICHE = ["HP", "Lenovo", "Dell", "Acer", "Apple", "Sonstiges"];

function parseBereich(code: string): string {
  const prefix = code.split("-")[0]?.toUpperCase() ?? "";
  if (["HP", "L", "D", "A"].includes(prefix)) {
    const map: Record<string, string> = { HP: "HP", L: "Lenovo", D: "Dell", A: "Acer" };
    return map[prefix] ?? "Sonstiges";
  }
  return "Sonstiges";
}

export default function LagerplatzNeuPage() {
  const router  = useRouter();
  const { show } = useToast();

  const [code,         setCode]         = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [bereich,      setBereich]      = useState("");

  const erstellen = api.lagerplaetze.create.useMutation({
    onSuccess: (l) => {
      show(`✅ Lagerplatz ${l.code} angelegt`, "success");
      router.push("/admin/lagerplaetze");
    },
    onError: (e) => show(e.message, "error"),
  });

  function handleCodeChange(val: string) {
    const formatted = val.toUpperCase().replace(/[^A-Z0-9\-]/g, "");
    setCode(formatted);
    if (!bereich) setBereich(parseBereich(formatted));
  }

  const INPUT_CLS = "w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]";

  return (
    <div className="max-w-lg space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-[#65676b] hover:text-[#0064d2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Neuer Lagerplatz</h1>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); if (code) erstellen.mutate({ code, beschreibung: beschreibung || undefined, bereich: bereich || undefined }); }}
        className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">

        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Code *</label>
          <input
            required value={code} onChange={(e) => handleCodeChange(e.target.value)}
            placeholder="z.B. HP-1-1-1"
            className={`${INPUT_CLS} font-mono tracking-wider`}
          />
          {code && (
            <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
              Vorschau: <span className="font-mono font-bold text-[#0064d2] dark:text-[#45bdff]">{code}</span>
            </p>
          )}
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Format: BEREICH-REGAL-FACH-EBENE (z.B. HP-1-1-1, L-2-3-2)
          </p>
        </div>

        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Beschreibung</label>
          <input
            value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)}
            placeholder="z.B. Regal HP, Fach 1, Ebene 1"
            className={INPUT_CLS}
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Bereich</label>
          <select value={bereich} onChange={(e) => setBereich(e.target.value)}
            className={INPUT_CLS}>
            <option value="">Automatisch erkennen</option>
            {BEREICHE.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {code && !bereich && (
            <p className="text-xs text-[#0064d2] dark:text-[#45bdff] mt-1">
              Automatisch erkannt: <strong>{parseBereich(code)}</strong>
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
            Abbrechen
          </button>
          <button type="submit" disabled={!code || erstellen.isPending}
            className="flex-1 py-2.5 rounded-xl bg-[#0064d2] text-white font-bold hover:bg-blue-700 disabled:opacity-50">
            {erstellen.isPending ? "..." : "Anlegen"}
          </button>
        </div>
      </form>
    </div>
  );
}
