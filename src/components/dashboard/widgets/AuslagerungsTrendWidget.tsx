"use client";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { ChartSkeleton } from "@/components/dashboard/WidgetSkeleton";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";

function shortDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

export function AuslagerungsTrendWidget() {
  const { data, isLoading, error } = api.dashboard.auslagerungsTrend.useQuery(
    undefined, { staleTime: 60_000, refetchInterval: 60_000, refetchIntervalInBackground: false }
  );

  return (
    <WidgetCard title="Auslagerungen letzte 30 Tage" icon="📈">
      {isLoading && <ChartSkeleton height={200} />}
      {error && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && !isLoading && (
        <div aria-label="Auslagerungs-Trend Liniendiagramm">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="datum" tickFormatter={shortDate} tick={{ fontSize: 11 }} interval={6} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                labelFormatter={(label) => shortDate(String(label))}
                formatter={(v, n) => [v, n === "ausgang" ? "AUSGANG" : "DIREKT"]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="ausgang" stroke="#008BD2" strokeWidth={2} dot={false} name="AUSGANG" />
              <Line type="monotone" dataKey="direkt"  stroke="#F59E0B" strokeWidth={2} dot={false} name="DIREKT"  />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
