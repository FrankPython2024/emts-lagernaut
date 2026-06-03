"use client";
import { signOut }  from "next-auth/react";
import { useRouter } from "next/navigation";
import { setzeTestModus } from "@/lib/testModus/testModus";

interface Props {
  children:  React.ReactNode;
  className?: string;
  style?:     React.CSSProperties;
  title?:     string;
}

export function LogoutButton({ children, className, style, title }: Props) {
  const router = useRouter();

  async function handleLogout() {
    // Test-Modus immer zurücksetzen, damit er nicht über eine neue Session bestehen bleibt.
    setzeTestModus(false);
    try {
      await signOut({ redirect: false });
      router.push("/login");
      router.refresh();
    } catch {
      // Fallback: harter Redirect
      window.location.href = "/login";
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className={className}
      style={style}
      title={title}
    >
      {children}
    </button>
  );
}
