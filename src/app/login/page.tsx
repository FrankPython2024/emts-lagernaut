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

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
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
    <div className="min-h-screen bg-[#f0f2f5] dark:bg-[#18191a] flex items-center justify-center">
      <div className="absolute top-4 right-4">
        <button
          onClick={toggleTheme}
          className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#242526] border border-[#ced4da] dark:border-[#3e4042] text-sm text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors"
        >
          {dark ? "☀️ Hell" : "🌙 Dunkel"}
        </button>
      </div>

      <form
        id="loginForm"
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white dark:bg-[#242526] rounded-2xl shadow-2xl border border-[#ced4da] dark:border-[#3e4042] p-8 text-center"
        style={{ animation: "none" }}
      >
        <div className="mb-2">
          <img
            src="https://www.afbshop.de/media/ca/1f/fe/1760428029/logo.svg"
            alt="AfB Logo"
            className="h-12 mx-auto dark:bg-white/90 dark:p-1 dark:rounded-md"
          />
        </div>

        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] mt-4">
          EMTS Lagernaut
        </h1>
        <p className="text-xs font-bold tracking-widest text-[#0064d2] dark:text-[#45bdff] uppercase mt-1 mb-8">
          Ersatzteil Management
        </p>

        {error && (
          <div className="mb-4 px-4 py-2.5 bg-[#fa3e3e]/10 border border-[#fa3e3e]/30 text-[#fa3e3e] rounded-lg text-sm font-medium">
            {error}
          </div>
        )}

        <input
          type="text"
          placeholder="KÜRZEL"
          value={kuerzel}
          onChange={(e) => setKuerzel(e.target.value.toUpperCase())}
          className="w-full px-4 py-3 mb-3 rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] font-bold text-center tracking-widest outline-none focus:border-[#0064d2] dark:focus:border-[#45bdff] transition-colors"
          autoComplete="username"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && document.getElementById("pw")?.focus()}
        />

        <input
          id="pw"
          type="password"
          placeholder="Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 mb-5 rounded-xl border-2 border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2] dark:focus:border-[#45bdff] transition-colors"
          autoComplete="current-password"
        />

        <button
          type="submit"
          disabled={loading || !kuerzel || !password}
          className="w-full py-3 bg-[#0064d2] hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
        >
          {loading ? (
            <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            "Portal betreten"
          )}
        </button>

        <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-6">
          AfB Sömmerda · EMTS Lagernaut v2
        </p>
      </form>

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

// Suspense Wrapper — Next.js 15 Pflicht für useSearchParams()
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
