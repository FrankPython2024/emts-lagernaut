"use client";
import { Suspense, useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const { data: session, status } = useSession();
  const router  = useRouter();
  const params  = useSearchParams();
  const [kuerzel, setKuerzel]   = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [dark, setDark]         = useState(false);
  const [hinweis, setHinweis]   = useState<string | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  // Öffentlichen Login-Hinweis aus Redis laden (über /api/login-hinweis).
  // Fehler werden bewusst geschluckt — kein Hinweis darf die Login-Seite stören.
  useEffect(() => {
    fetch("/api/login-hinweis")
      .then((r) => r.json())
      .then((d: { text?: string | null }) => setHinweis(d?.text ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      const cb = params?.get("callbackUrl") ?? "/";
      router.replace(cb);
    }
  }, [status, router, params]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!kuerzel.trim() || !password) return;
    setLoading(true);
    setError("");

    const res = await signIn("credentials", {
      kuerzel: kuerzel.trim().toUpperCase(),
      password,
      redirect: false,
    });

    setLoading(false);
    if (res?.error) {
      setError("Kürzel oder Passwort falsch.");
      const form = document.getElementById("loginForm");
      form?.classList.add("shake");
      setTimeout(() => form?.classList.remove("shake"), 400);
    }
  }

  function toggleTheme() {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("theme", d ? "dark" : "light");
  }

  if (status === "loading") return null;

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: dark ? "#15181E" : "linear-gradient(135deg, #f5f6f8 0%, #e8edf5 100%)" }}
    >
      {/* AfB Brand Background Elements */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #008BD2 0%, transparent 70%)" }} />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #04B475 0%, transparent 70%)" }} />
      </div>

      {/* Theme Toggle */}
      <div className="absolute top-4 right-4">
        <button
          onClick={toggleTheme}
          className="px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{ background: dark ? "#1F2329" : "white", border: "1px solid", borderColor: dark ? "#3A3F47" : "#d0d5e0", color: dark ? "#b0b3b8" : "#65676b" }}
        >
          {dark ? "☀️ Hell" : "🌙 Dunkel"}
        </button>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-4 relative z-10">

      {/* Login-Hinweis (Redis: "login_hinweis") — nur wenn Text vorhanden */}
      {hinweis && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm font-medium text-left"
          style={{
            background:  dark ? "rgba(0,139,210,0.15)" : "#E6F4FB",
            border:      "1px solid #008BD2",
            color:       dark ? "#BFE6F8" : "#0B4D6E",
          }}
        >
          <span aria-hidden className="text-base leading-none mt-0.5" style={{ color: "#008BD2" }}>ℹ️</span>
          <span className="flex-1">{hinweis}</span>
        </div>
      )}

      <form
        id="loginForm"
        onSubmit={handleSubmit}
        className="w-full rounded-2xl p-8 text-center"
        style={{
          background:   dark ? "#1F2329" : "white",
          border:       `1px solid ${dark ? "#3A3F47" : "#d0d5e0"}`,
          boxShadow:    dark ? "0 20px 60px rgba(0,0,0,0.4)" : "0 8px 40px rgba(32,47,97,0.15)",
          animation:    "none",
        }}
      >
        {/* Logo */}
        <div className="mb-3">
          <img
            src="https://www.afbshop.de/media/ca/1f/fe/1760428029/logo.svg"
            alt="AfB Logo"
            className="h-14 mx-auto"
            style={{ filter: dark ? "none" : "none" }}
          />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-black mt-3" style={{ color: dark ? "#e4e6eb" : "#202F61" }}>
          EMTS Lagernaut
        </h1>
        <p className="text-xs font-bold tracking-widest uppercase mt-1 mb-7" style={{ color: "#008BD2" }}>
          Ersatzteil Management · AfB Sömmerda
        </p>

        {/* Trennlinie mit Logo-Gradient */}
        <div className="w-16 h-0.5 mx-auto mb-7 rounded-full"
          style={{ background: "linear-gradient(90deg, #008BD2, #04B475)" }} />

        {error && (
          <div className="mb-4 px-4 py-2.5 rounded-lg text-sm font-medium" style={{ background: "rgba(250,62,62,0.1)", border: "1px solid rgba(250,62,62,0.3)", color: "#fa3e3e" }}>
            {error}
          </div>
        )}

        <label htmlFor="kuerzel" className="sr-only">Kürzel</label>
        <input
          id="kuerzel"
          type="text"
          placeholder="KÜRZEL"
          value={kuerzel}
          onChange={(e) => setKuerzel(e.target.value.toUpperCase())}
          className="w-full px-4 py-3 mb-3 rounded-xl font-bold text-center tracking-widest outline-none transition-all"
          style={{
            border:      `2px solid ${dark ? "#3A3F47" : "#d0d5e0"}`,
            background:  dark ? "#15181E" : "#f5f6f8",
            color:       dark ? "#e4e6eb" : "#1a1a1a",
          }}
          autoComplete="username"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && document.getElementById("pw")?.focus()}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#202F61")}
          onBlur={(e)  => (e.currentTarget.style.borderColor = dark ? "#3A3F47" : "#d0d5e0")}
        />

        <label htmlFor="pw" className="sr-only">Passwort</label>
        <input
          id="pw"
          type="password"
          placeholder="Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 mb-5 rounded-xl outline-none transition-all"
          style={{
            border:     `2px solid ${dark ? "#3A3F47" : "#d0d5e0"}`,
            background: dark ? "#15181E" : "#f5f6f8",
            color:      dark ? "#e4e6eb" : "#1a1a1a",
          }}
          autoComplete="current-password"
          onFocus={(e) => (e.currentTarget.style.borderColor = "#202F61")}
          onBlur={(e)  => (e.currentTarget.style.borderColor = dark ? "#3A3F47" : "#d0d5e0")}
        />

        <button
          type="submit"
          disabled={loading || !kuerzel || !password}
          className="w-full py-3 text-white font-bold rounded-xl transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
          style={{ background: "linear-gradient(135deg, #202F61 0%, #2D3D7A 100%)", boxShadow: "0 4px 12px rgba(32,47,97,0.3)" }}
        >
          {loading ? (
            <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            "Portal betreten →"
          )}
        </button>

        <p className="text-xs mt-5" style={{ color: dark ? "#b0b3b8" : "#65676b" }}>
          Social &amp; Green IT · AfB Sömmerda
        </p>
      </form>

      </div>

      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          25%{transform:translateX(-8px)}
          75%{transform:translateX(8px)}
        }
        .shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
