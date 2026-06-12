"use client";

import { useEffect, useState } from "react";
import { api } from "@/trpc/react";

// Self-Service „Passwort ändern" für den Picker-Bereich.
// Trigger-Button (für den Layout-Header) + Modal in einem, damit das Layout
// schlank bleibt. Inklusives UI wie der Einlager-Assistent: große Touch-Targets
// (56px), klare Beschriftung, leichte Sprache, Dark/Light, handheld-tauglich.
//
// Backend: bewusst die bestehende, session-gebundene tRPC-Mutation
// `benutzer.changePassword` (protectedProcedure) — sie ändert serverseitig nur
// den eingeloggten User, prüft das aktuelle Passwort und hasht mit bcrypt.
// KEINE neue Crypto, KEINE Schema-Änderung.

const MIN_LEN = 8; // gleiche Regel wie überall (Techniker-Profil, Admin)

const inputClass =
  "w-full px-4 rounded-xl border bg-white dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] " +
  "text-lg outline-none focus:border-[#008BD2] focus:ring-2 focus:ring-[#008BD2]/30 transition-colors";

export function PasswortAendernModal() {
  const [offen, setOffen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        title="Passwort ändern"
        className="inline-flex items-center gap-1.5 px-4 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold transition-colors min-h-[44px]"
      >
        <span aria-hidden>🔑</span>
        <span className="hidden sm:inline">Passwort</span>
      </button>
      {offen && <Dialog onClose={() => setOffen(false)} />}
    </>
  );
}

function Dialog({ onClose }: { onClose: () => void }) {
  const [alt,  setAlt]  = useState("");
  const [neu,  setNeu]  = useState("");
  const [neu2, setNeu2] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState(false);

  const aendern = api.benutzer.changePassword.useMutation({
    onSuccess: () => { setFehler(null); setFertig(true); },
    onError:   (e) => setFehler(e.message || "Das hat leider nicht geklappt. Bitte erneut versuchen."),
  });

  // Schließen mit Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  function pruefenUndSenden() {
    setFehler(null);
    if (!alt) {
      setFehler("Bitte gib dein aktuelles Passwort ein.");
      return;
    }
    if (neu.length < MIN_LEN) {
      setFehler(`Das neue Passwort muss mindestens ${MIN_LEN} Zeichen lang sein.`);
      return;
    }
    if (neu !== neu2) {
      setFehler("Die beiden neuen Passwörter sind nicht gleich. Bitte noch einmal prüfen.");
      return;
    }
    if (neu === alt) {
      setFehler("Das neue Passwort muss sich vom alten unterscheiden.");
      return;
    }
    aendern.mutate({ aktuellesPasswort: alt, neuesPasswort: neu });
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-titel"
        onClick={(e) => e.stopPropagation()}
        className="bg-[#f0f2f5] dark:bg-[#242526] text-[#1a1a1a] dark:text-[#e4e6eb] w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
      >
        {/* Kopf */}
        <div className="sticky top-0 bg-[#202F61] text-white px-5 py-4 flex items-center justify-between gap-3 rounded-t-3xl">
          <h2 id="pw-titel" className="text-xl font-black flex items-center gap-2">
            <span aria-hidden>🔑</span> Passwort ändern
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/15 text-2xl transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-5">
          {fertig ? (
            // ── Erfolg ───────────────────────────────────────────────────────
            <div className="text-center py-6 space-y-4">
              <div className="text-5xl" aria-hidden>✅</div>
              <h3 className="text-xl font-black text-[#04B475]">Passwort geändert</h3>
              <p className="text-base text-[#65676b] dark:text-[#b0b3b8]">
                Dein neues Passwort gilt ab dem <strong>nächsten Anmelden</strong>.
                Merke es dir gut.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-[#202F61] text-white text-lg font-black hover:opacity-90 transition-opacity"
                style={{ minHeight: 56 }}
              >
                Fertig
              </button>
            </div>
          ) : (
            // ── Formular ─────────────────────────────────────────────────────
            <>
              <p className="text-base text-[#65676b] dark:text-[#b0b3b8]">
                Wähle ein neues Passwort. Es muss mindestens {MIN_LEN} Zeichen lang sein.
              </p>

              <Feld
                id="pw-alt"
                label="Aktuelles Passwort"
                value={alt}
                onChange={setAlt}
                autoComplete="current-password"
                onEnter={pruefenUndSenden}
              />
              <Feld
                id="pw-neu"
                label="Neues Passwort"
                value={neu}
                onChange={setNeu}
                autoComplete="new-password"
                hint={`Mindestens ${MIN_LEN} Zeichen`}
                onEnter={pruefenUndSenden}
              />
              <Feld
                id="pw-neu2"
                label="Neues Passwort wiederholen"
                value={neu2}
                onChange={setNeu2}
                autoComplete="new-password"
                onEnter={pruefenUndSenden}
              />

              {fehler && (
                <div
                  role="alert"
                  className="rounded-xl bg-[#ffe5e5] dark:bg-[#3a1f1f] text-[#c1272d] dark:text-[#ff8a8a] px-4 py-3 text-base font-semibold flex items-start gap-2"
                >
                  <span aria-hidden>⚠️</span>
                  <span>{fehler}</span>
                </div>
              )}

              <button
                type="button"
                onClick={pruefenUndSenden}
                disabled={aendern.isPending}
                className="w-full rounded-xl bg-[#04B475] text-white text-lg font-black hover:opacity-90 disabled:opacity-50 transition-opacity"
                style={{ minHeight: 56 }}
              >
                {aendern.isPending ? "Speichere…" : "💾 Passwort speichern"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-base font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                style={{ minHeight: 48 }}
              >
                Abbrechen
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Feld({
  id, label, value, onChange, autoComplete, hint, onEnter,
}: {
  id:           string;
  label:        string;
  value:        string;
  onChange:     (v: string) => void;
  autoComplete: string;
  hint?:        string;
  onEnter:      () => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-base font-bold mb-1.5">
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onEnter(); }}
        className={inputClass + " border-[#ced4da] dark:border-[#3e4042]"}
        style={{ minHeight: 56 }}
      />
      {hint && (
        <div className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">{hint}</div>
      )}
    </div>
  );
}
