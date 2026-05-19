"use client";
import type { ReactNode } from "react";

type WidgetCardProps = {
  title:     string;
  icon?:     string;
  action?:   ReactNode;
  children:  ReactNode;
  minHeight?: string;
  // Phase 2: hidden?: boolean  // für Drag & Drop Sichtbarkeit
};

export function WidgetCard({ title, icon, action, children, minHeight = "200px" }: WidgetCardProps) {
  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col overflow-hidden"
      style={{ minHeight }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-base flex-shrink-0" aria-hidden>{icon}</span>}
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {title}
          </h3>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>

      {/* Body */}
      <div className="flex-1 p-4 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
