"use client";
import { useState } from "react";

export type Column<T> = {
  key:      string;
  header:   string;
  render:   (row: T) => React.ReactNode;
  sortable?: boolean;
  width?:   string;
};

type DataTableProps<T> = {
  columns:    Column<T>[];
  data:       T[];
  keyFn:      (row: T) => string | number;
  emptyText?: string;
  loading?:   boolean;
};

export function DataTable<T>({ columns, data, keyFn, emptyText = "Keine Einträge", loading }: DataTableProps<T>) {
  const [sortKey, setSortKey]   = useState<string | null>(null);
  const [sortAsc, setSortAsc]   = useState(true);

  function handleSort(key: string) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#ced4da] dark:border-[#3e4042]">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[#f0f2f5] dark:bg-[#18191a]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#65676b] dark:text-[#b0b3b8] border-b border-[#ced4da] dark:border-[#3e4042] ${col.width ?? ""} ${col.sortable ? "cursor-pointer select-none hover:text-[#0064d2] dark:hover:text-[#45bdff]" : ""}`}
                onClick={() => col.sortable && handleSort(col.key)}
              >
                {col.header}
                {col.sortable && sortKey === col.key && (
                  <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-12 text-[#65676b] dark:text-[#b0b3b8]">
                <div className="inline-block w-6 h-6 border-2 border-[#0064d2]/20 border-t-[#0064d2] rounded-full animate-spin" />
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-12 text-[#65676b] dark:text-[#b0b3b8]">
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={keyFn(row)}
                className="border-b border-[#ced4da] dark:border-[#3e4042] hover:bg-[#f0f2f5] dark:hover:bg-[#18191a] transition-colors"
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
