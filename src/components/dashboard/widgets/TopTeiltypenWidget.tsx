"use client";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { ChartSkeleton } from "@/components/dashboard/WidgetSkeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const COLORS = ["#008BD2","#04B475","#202F61","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16","#F97316"];

export function TopTeiltypenWidget() {
  const { data, isLoading, error } = api.dashboard.topTeiltypen.useQuery(
    undefined, { staleTime: 120_000, refetchInterval: 120_000, refetchIntervalInBackground: false }
  );

  return (
    <WidgetCard title="Top Teiltypen (30 Tage)" icon="🏆">
      {isLoading && <ChartSkeleton height={200} />}
      {error && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && !isLoading && !data.length && (
        <p className="text-sm text-gray-400 text-center py-8">Noch keine abgeschlossenen Anfragen</p>
      )}
      {data && data.length > 0 && (
        <div aria-label="Top Teiltypen Balkendiagramm">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 60, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="teiltyp" tick={{ fontSize: 11 }} width={60} />
              <Tooltip formatter={(v) => [v, "Auslagerungen"]} />
              <Bar dataKey="anzahl" radius={[0, 4, 4, 0]}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
