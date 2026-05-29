// Backward-compat: unterstützt alte Props (title, color, icon) und neue (label, accent, trend als string)

const ACCENT_COLORS = {
  cyan:    "#008BD2",
  green:   "#04B475",
  amber:   "#F59E0B",
  red:     "#fa3e3e",
  navy:    "#202F61",
  orange:  "#f97316",
};

const COLOR_TO_ACCENT: Record<string, string> = {
  primary: "#0064d2",
  success: "#04b475",
  warning: "#f7b928",
  danger:  "#fa3e3e",
  purple:  "#8e44ad",
};

type StatCardProps = {
  // Neue Props
  label?:  string;
  accent?: keyof typeof ACCENT_COLORS;
  trend?:  string | number;
  // Alte Props (backward compat)
  title?:  string;
  value:   number | string;
  icon?:   string;
  color?:  "primary" | "success" | "danger" | "warning" | "purple";
  sub?:    string;
};

export function StatCard({ label, title, value, accent, color, icon, sub, trend }: StatCardProps) {
  const displayLabel  = label ?? title ?? "";
  const accentColor   = accent
    ? ACCENT_COLORS[accent]
    : color
      ? COLOR_TO_ACCENT[color]
      : ACCENT_COLORS.cyan;

  const trendStr = typeof trend === "number"
    ? `${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend)}%`
    : trend;
  const trendPositive = typeof trend === "number" ? trend >= 0 : trend?.startsWith("+");

  return (
    <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] shadow-sm overflow-hidden hover:shadow-md transition-shadow duration-200">
      {/* Akzent-Balken */}
      <div style={{ height: 3, background: accentColor }} />

      <div className="p-5">
        {/* Label + Icon */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-[#65676b] dark:text-[#b0b3b8] leading-tight">
            {displayLabel}
          </span>
          {icon && (
            <span className="text-xl opacity-50 flex-shrink-0">{icon}</span>
          )}
        </div>

        {/* Wert */}
        <div className="text-[2rem] font-black text-[#1a1a1a] dark:text-[#e4e6eb] leading-none tabular-nums">
          {value}
        </div>

        {/* Trend / Sub */}
        {(trendStr ?? sub) && (
          <div className={`text-xs mt-2 font-medium ${
            trendStr
              ? trendPositive
                ? "text-[#04b475]"
                : "text-[#fa3e3e]"
              : "text-[#65676b] dark:text-[#b0b3b8]"
          }`}>
            {trendStr ?? sub}
          </div>
        )}
      </div>
    </div>
  );
}
