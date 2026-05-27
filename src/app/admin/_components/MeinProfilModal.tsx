"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import FocusTrap from "focus-trap-react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import type { SessionUser } from "@/core/types";

export function MeinProfilModal({ onClose }: { onClose: () => void }) {
  const { data: session } = useSession();
  const user = session?.user as SessionUser | undefined;
  const { show: toast } = useToast();

  const [pwAkt,  setPwAkt]  = useState("");
  const [pwNeu,  setPwNeu]  = useState("");
  const [pwNeu2, setPwNeu2] = useState("");

  const changePassword = api.benutzer.changePassword.useMutation({
    onSuccess: () => {
      setPwAkt(""); setPwNeu(""); setPwNeu2("");
      toast("Passwort erfolgreich geändert", "success");
    },
    onError: (err) => {
      toast(err.message || "Passwort konnte nicht geändert werden", "error");
    },
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const mismatch  = !!pwNeu2 && pwNeu !== pwNeu2;
  const canSubmit = !!pwAkt && !!pwNeu && !!pwNeu2 && !mismatch && !changePassword.isPending;

  function handleSubmit() {
    if (pwNeu !== pwNeu2) {
      toast("Die neuen Passwörter stimmen nicht überein", "error");
      return;
    }
    if (pwNeu.length < 8) {
      toast("Neues Passwort muss mindestens 8 Zeichen lang sein", "error");
      return;
    }
    changePassword.mutate({ aktuellesPasswort: pwAkt, neuesPasswort: pwNeu });
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <FocusTrap focusTrapOptions={{
        escapeDeactivates:       false,
        allowOutsideClick:       true,
        returnFocusOnDeactivate: true,
        fallbackFocus:           "[aria-labelledby='mein-profil-title']",
        initialFocus:            false,
      }}>
        <div
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="mein-profil-title"
          onClick={(e) => e.stopPropagation()}
          className="bg-white dark:bg-gray-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <h2 id="mein-profil-title" className="text-xl font-semibold text-gray-900 dark:text-white">
              Mein Profil
            </h2>
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Persönliche Daten */}
          <div className="mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              Persönliche Daten
            </h3>
            <div className="space-y-1 text-sm text-gray-800 dark:text-gray-200">
              <div><span className="text-gray-500 dark:text-gray-400">Name:</span>{" "}<strong>{user?.name ?? "–"}</strong></div>
              <div><span className="text-gray-500 dark:text-gray-400">Kürzel:</span>{" "}<strong>{user?.kuerzel ?? "–"}</strong></div>
              <div><span className="text-gray-500 dark:text-gray-400">Rolle:</span>{" "}<strong>{user?.rolle ?? "–"}</strong></div>
            </div>
          </div>

          {/* Passwort */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
              Passwort ändern
            </h3>

            <div className="space-y-3">
              <label className="block">
                <span className="block text-sm mb-1 text-gray-700 dark:text-gray-300">Aktuelles Passwort</span>
                <input
                  type="password"
                  value={pwAkt}
                  onChange={(e) => setPwAkt(e.target.value)}
                  autoComplete="current-password"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-cyan-500"
                  style={{ minHeight: 44 }}
                />
              </label>

              <label className="block">
                <span className="block text-sm mb-1 text-gray-700 dark:text-gray-300">
                  Neues Passwort{" "}
                  <span className="text-gray-400 dark:text-gray-500 font-normal">(min. 8 Zeichen)</span>
                </span>
                <input
                  type="password"
                  value={pwNeu}
                  onChange={(e) => setPwNeu(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-cyan-500"
                  style={{ minHeight: 44 }}
                />
              </label>

              <label className="block">
                <span className="block text-sm mb-1 text-gray-700 dark:text-gray-300">Neues Passwort bestätigen</span>
                <input
                  type="password"
                  value={pwNeu2}
                  onChange={(e) => setPwNeu2(e.target.value)}
                  autoComplete="new-password"
                  className={`w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-cyan-500 ${
                    mismatch ? "border-red-500" : "border-gray-300 dark:border-gray-700"
                  }`}
                  style={{ minHeight: 44 }}
                />
                {mismatch && (
                  <span className="text-sm text-red-500 mt-1 block">Passwörter stimmen nicht überein</span>
                )}
              </label>

              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`mt-2 px-5 py-3 rounded-xl text-white font-semibold transition-colors ${
                  canSubmit ? "bg-cyan-500 hover:bg-cyan-600" : "bg-gray-400 dark:bg-gray-600 cursor-not-allowed"
                }`}
                style={{ minHeight: 56 }}
              >
                {changePassword.isPending ? "Speichere…" : "Passwort ändern"}
              </button>
            </div>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
