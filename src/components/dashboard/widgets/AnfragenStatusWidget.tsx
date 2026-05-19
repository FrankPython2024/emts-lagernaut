"use client";
import { api } from "@/trpc/react";
import { WidgetCard } from "@/components/dashboard/WidgetCard";
import { ChartSkeleton } from "@/components/dashboard/WidgetSkeleton";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

export function AnfragenStatusWidget() {
  const { data, isLoading, error } = api.dashboard.anfragenStatusVerteilung.useQuery(
    undefined, { staleTime: 60_000 }
  );

  return (
    <WidgetCard title="Anfragen nach Status" icon="🍩">
      {isLoading && <ChartSkeleton />}
      {error   && <p className="text-sm text-red-500">Fehler beim Laden</p>}
      {data && !isLoading && (() => {
        const filled = data.filter(d => d.anzahl > 0);
        if (!filled.length) return <p className="text-sm text-gray-400 text-center py-8">Keine Anfragen vorhanden</p>;
        return (
          <div aria-label={`Anfragen-Status: ${data.map(d => `${d.status} ${d.anzahl}`).join(", ")}`}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={filled} dataKey="anzahl" nameKey="status" cx="50%" cy="50%" outerRadius={70} innerRadius={35}>
                  {filled.map(d => <Cell key={d.status} fill={d.farbe} />)}
                </Pie>
                <Tooltip formatter={(v) => [v, "Anfragen"]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        );
      })()}
    </WidgetCard>
  );
}
