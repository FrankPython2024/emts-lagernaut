"use client";
import type { ReactNode } from "react";
import { useWidgetEditContext } from "@/lib/dashboard/widgetContext";

type WidgetCardProps = {
  title:      string;
  icon?:      string;
  action?:    ReactNode;
  children:   ReactNode;
  minHeight?: string;
  // Phase 2: hidden prop (für Drag & Drop Sichtbarkeit vorbereitet)
  // hidden?: boolean;
};

export function WidgetCard({ title, icon, action, children, minHeight = "200px" }: WidgetCardProps) {
  const { editMode, widgetId, onHide } = useWidgetEditContext();

  return (
    <div
      className={`widget-card bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col overflow-hidden h-full ${editMode ? "edit-mode" : ""}`}
      style={{ minHeight }}
    >
      {/* Edit-Mode: Drag-Handle (CSS class für react-grid-layout draggableHandle) */}
      {editMode && (
        <div className="widget-drag-handle flex items-center justify-between px-3 bg-cyan-50 dark:bg-cyan-900/20 border-b border-cyan-200 dark:border-cyan-800 cursor-move select-none flex-shrink-0"
          style={{ minHeight: 44 }}>
          <span className="text-xs text-cyan-700 dark:text-cyan-300 font-medium flex items-center gap-1.5">
            <span className="text-sm leading-none tracking-tighter" aria-hidden>⋮⋮</span>
            Ziehen zum Verschieben
          </span>
          <button
            onClick={() => onHide(widgetId)}
            className="p-1.5 rounded hover:bg-cyan-100 dark:hover:bg-cyan-900/40 transition-colors text-cyan-600 dark:text-cyan-400 min-w-[32px] min-h-[32px] flex items-center justify-center"
            aria-label={`${title} ausblenden`}
            title="Widget ausblenden"
            type="button"
          >
            👁️‍🗨️
          </button>
        </div>
      )}

      {/* Widget-Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-base flex-shrink-0" aria-hidden>{icon}</span>}
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {title}
          </h3>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>

      {/* Widget-Inhalt */}
      <div className="flex-1 p-4 overflow-auto">
        {children}
      </div>
    </div>
  );
}
