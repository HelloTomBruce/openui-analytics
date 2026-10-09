"use client";

import React, { useState } from "react";
import { Search, ArrowUpDown, Download } from "lucide-react";

export interface ColumnConfig {
  key: string;
  header: string;
  align?: "left" | "center" | "right";
  format?: "number" | "currency" | "percent" | "text";
}

export interface DataTableProps {
  title?: string;
  columns?: ColumnConfig[];
  data?: Array<Record<string, unknown>>;
  searchable?: boolean;
}

export const DataTable: React.FC<DataTableProps> = ({
  title,
  columns = [],
  data = [],
  searchable = true,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  // 安全容错：确保 data 与 columns 始终为有效数组且元素为非空对象
  let rawData: unknown[] = [];
  if (Array.isArray(data)) {
    rawData = data;
  } else if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) rawData = parsed;
    } catch {
      rawData = [];
    }
  }

  const safeData: Array<Record<string, unknown>> = rawData.filter(
    (item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item)
  );

  let safeColumns: ColumnConfig[] = [];
  if (Array.isArray(columns)) {
    safeColumns = columns.filter(
      (c): c is ColumnConfig => c != null && typeof c === "object" && typeof c.key === "string"
    );
  } else if (typeof columns === "string") {
    try {
      const parsed = JSON.parse(columns);
      if (Array.isArray(parsed)) {
        safeColumns = parsed.filter(
          (c): c is ColumnConfig => c != null && typeof c === "object" && typeof c.key === "string"
        );
      }
    } catch {
      safeColumns = [];
    }
  }

  // 若未指定 columns，自动根据数据行推断表头
  if (safeColumns.length === 0 && safeData.length > 0 && safeData[0] && typeof safeData[0] === "object") {
    safeColumns = Object.keys(safeData[0]).map((k) => ({
      key: k,
      header: k,
    }));
  }

  const filteredData = safeData.filter((row) => {
    if (!row || typeof row !== "object") return false;
    if (!searchTerm) return true;
    return Object.values(row).some((val) =>
      val != null && String(val).toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const sortedData = [...filteredData].sort((a, b) => {
    if (!sortKey) return 0;
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (aVal === bVal) return 0;
    if (aVal == null) return sortAsc ? 1 : -1;
    if (bVal == null) return sortAsc ? -1 : 1;
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortAsc ? aVal - bVal : bVal - aVal;
    }
    const aStr = String(aVal);
    const bStr = String(bVal);
    return sortAsc ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
  });

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const exportCSV = () => {
    const headers = safeColumns.map((c) => c.header).join(",");
    const rows = sortedData.map((row) =>
      safeColumns.map((c) => `"${row[c.key] ?? ""}"`).join(",")
    );
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${title || "export"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
      {(title || searchable) && (
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          {title && (
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h4>
          )}
          <div className="flex items-center gap-2 ms-auto">
            {searchable && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="搜索数据..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="text-xs pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
            <button
              onClick={exportCSV}
              className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="导出 CSV"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            <tr>
              {safeColumns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`p-3 font-semibold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors ${
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                      ? "text-center"
                      : "text-left"
                  }`}
                >
                  <div
                    className={`inline-flex items-center gap-1 ${
                      col.align === "right" ? "justify-end" : ""
                    }`}
                  >
                    <span>{col.header}</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
            {sortedData.length === 0 ? (
              <tr>
                <td colSpan={Math.max(safeColumns.length, 1)} className="p-4 text-center text-slate-400">
                  暂无匹配数据
                </td>
              </tr>
            ) : (
              sortedData.map((row, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
                >
                  {safeColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`p-3 ${
                        col.align === "right"
                          ? "text-right font-mono"
                          : col.align === "center"
                          ? "text-center"
                          : "text-left"
                      }`}
                    >
                      {row[col.key] != null ? String(row[col.key]) : "-"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
