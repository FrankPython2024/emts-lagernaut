"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserRolle } from "@prisma/client";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";

const ROLLEN = [
  { rolle: UserRolle.ADMIN,          icon: "🔴", label: "Admin",            desc: "Vollzugriff: Artikel, Buchungen, Benutzer, System" },
  { rolle: UserRolle.TECHNIKER,      icon: "🔵", label: "Techniker",        desc: "Ersatzteil-Anfragen stellen, eigenen Verlauf sehen" },
  { rolle: UserRolle.BETRACHTER,     icon: "🟢", label: "Betrachter",       desc: "Nur lesen: Statistiken und Bestände" },
  { rolle: UserRolle.ADMIN_READONLY, icon: "🟡", label: "Admin (nur Lesen)", desc: "Audit: voller Admin-Lesezugriff, keine Schreibrechte, kein Benutzer-/Rollen-Zugriff" },
];

export default function BenutzerNeuPage() {
  const router = useRouter();
  const { show } = useToast();
  const [form, setForm] = useState<{ name: string; kuerzel: string; email: string; password: string; rolle: UserRolle }>({ name: "", kuerzel: "", email: "", password: "", rolle: UserRolle.TECHNIKER });

  const erstellen = api.benutzer.create.useMutation({
    onSuccess: (u) => { show(`✅ ${u.name} angelegt`, "success"); router.push("/admin/benutzer"); },
    onError:   (e) => show(e.message, "error"),
  });

  const RECHTE: Record<UserRolle, string[]> = {
    ADMIN:          ["Artikel verwalten", "Buchungen erstellen", "Anfragen bearbeiten", "Benutzer verwalten", "System einsehen"],
    TECHNIKER:      ["Artikel suchen", "Anfragen stellen", "Eigene Anfragen stornieren"],
    BETRACHTER:     ["Artikel einsehen", "Anfragen einsehen (nur lesen)"],
    ADMIN_READONLY: ["Admin-Bereich vollständig einsehen", "Anfragen, Lager, Modelle, Statistik, Activity-Log", "Keine Schreibrechte · kein Benutzer-/Rollen-Zugriff"],
  };

  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="text-[#65676b] hover:text-[#0064d2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb]">Neuer Benutzer</h1>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); erstellen.mutate(form); }}
        className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">

        {[
          { key: "name",     label: "Name",     placeholder: "Max Mustermann", type: "text" },
          { key: "kuerzel",  label: "Kürzel",   placeholder: "MM",             type: "text" },
          { key: "email",    label: "E-Mail",   placeholder: "max@afb.de",     type: "email" },
          { key: "password", label: "Passwort", placeholder: "Mindestens 8 Zeichen", type: "password" },
        ].map(({ key, label, placeholder, type }) => (
          <div key={key}>
            <label htmlFor={`field-${key}`} className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">{label} *</label>
            <input
              id={`field-${key}`}
              required type={type} placeholder={placeholder}
              value={form[key as keyof typeof form] as string}
              onChange={(e) => setForm((f) => ({ ...f, [key]: key === "kuerzel" ? e.target.value.toUpperCase() : e.target.value }))}
              className="w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            />
          </div>
        ))}

        {/* Rollen-Auswahl */}
        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-2 uppercase">Rolle</label>
          <div className="grid grid-cols-1 gap-2">
            {ROLLEN.map(({ rolle, icon, label, desc }) => (
              <button type="button" key={rolle}
                onClick={() => setForm((f) => ({ ...f, rolle }))}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
                  form.rolle === rolle
                    ? "border-[#0064d2] bg-[#0064d2]/5 dark:bg-[#0064d2]/10"
                    : "border-[#ced4da] dark:border-[#3e4042] hover:border-[#0064d2]/50"
                }`}>
                <span className="text-xl">{icon}</span>
                <div>
                  <div className="font-bold text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">{label}</div>
                  <div className="text-xs text-[#65676b] dark:text-[#b0b3b8]">{desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Berechtigungs-Vorschau */}
        <div className="bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl p-4">
          <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-2">Berechtigungen:</p>
          <ul className="space-y-1">
            {RECHTE[form.rolle].map((r) => (
              <li key={r} className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb] flex items-center gap-2">
                <span className="text-[#00a400] text-xs">✓</span> {r}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
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
