type StatCardProps = {
  title:   string;
  value:   number | string;
  icon:    string;
  color?:  "primary" | "success" | "danger" | "warning" | "purple";
  sub?:    string;
  trend?:  number;
};

const COLORS = {
  primary: { ring: "ring-[#0064d2]/20", icon: "bg-[#0064d2]/10 text-[#0064d2] dark:text-[#45bdff]", val: "text-[#0064d2] dark:text-[#45bdff]" },
  success: { ring: "ring-[#00a400]/20", icon: "bg-[#00a400]/10 text-[#00a400]",                     val: "text-[#00a400]" },
  danger:  { ring: "ring-[#fa3e3e]/20", icon: "bg-[#fa3e3e]/10 text-[#fa3e3e]",                     val: "text-[#fa3e3e]" },
  warning: { ring: "ring-[#f7b928]/20", icon: "bg-[#f7b928]/10 text-[#f7b928]",                     val: "text-[#f7b928]" },
  purple:  { ring: "ring-[#8e44ad]/20", icon: "bg-[#8e44ad]/10 text-[#8e44ad]",                     val: "text-[#8e44ad]" },
};

export function StatCard({ title, value, icon, color = "primary", sub, trend }: StatCardProps) {
  const c = COLORS[color];
  return (
    <div className={`bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-5 shadow-sm ring-2 ${c.ring}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`text-2xl w-12 h-12 rounded-xl flex items-center justify-center ${c.icon} flex-shrink-0`}>
          {icon}
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${trend >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {trend >= 0 ? "+" : ""}{trend}%
          </span>
        )}
      </div>
      <div className={`text-3xl font-black mt-3 ${c.val}`}>{value}</div>
      <div className="text-sm font-semibold text-[#1a1a1a] dark:text-[#e4e6eb] mt-1">{title}</div>
      {sub && <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-0.5">{sub}</div>}
    </div>
  );
}
