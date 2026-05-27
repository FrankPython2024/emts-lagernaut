"use client";

import { api } from "@/trpc/react";

export function usePermissions() {
  const { data, isLoading } = api.rollen.meinePermissions.useQuery(undefined, {
    staleTime: 60_000,
  });

  const permissions  = data ?? [];
  const isSystemAdmin = permissions.includes("SYSTEM_ADMIN");

  return {
    permissions,
    isLoading,
    isSystemAdmin,
    has: (key: string) => isSystemAdmin || permissions.includes(key),
    hasAny: (keys: string[]) =>
      isSystemAdmin || keys.some(k => permissions.includes(k)),
  };
}
