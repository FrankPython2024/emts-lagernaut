export function WidgetSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-3" aria-label="Lädt…" role="status">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-gray-100 dark:bg-gray-800 rounded" style={{ width: `${70 + (i % 3) * 10}%` }} />
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 180 }: { height?: number }) {
  return (
    <div
      className="animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg"
      style={{ height }}
      aria-label="Chart lädt…"
      role="status"
    />
  );
}
