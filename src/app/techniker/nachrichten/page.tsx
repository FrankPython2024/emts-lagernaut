"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NachrichtenRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/techniker"); }, [router]);
  return null;
}
