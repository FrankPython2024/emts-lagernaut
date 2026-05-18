import Link from "next/link";
import type { ReactNode } from "react";

type Crumb = { label: string; href?: string };

type PageHeaderProps = {
  title:       string;
  subtitle?:   string;
  breadcrumb?: Crumb[];
  action?:     ReactNode;
};

export function PageHeader({ title, subtitle, breadcrumb, action }: PageHeaderProps) {
  return (
    <div className="pb-6 border-b border-[#ced4da] dark:border-[#3e4042] mb-6">
      {/* Breadcrumb */}
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="flex items-center gap-1.5 text-[13px] text-[#65676b] dark:text-[#b0b3b8] mb-2">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="opacity-40">›</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-[#1a1a1a] dark:hover:text-[#e4e6eb] transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Title row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[1.75rem] font-black text-[#1a1a1a] dark:text-[#e4e6eb] leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8] mt-1">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  );
}
