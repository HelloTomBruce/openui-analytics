/**
 * CSV 生成与下载的共享工具（DataTable 与 clientTools 统一使用）。
 *
 * 安全与正确性约定：
 * 1. 值内双引号转义为 ""（RFC 4180）；
 * 2. 以 = + - @ 开头的单元格前补 '，防 Excel/表格软件公式注入；
 * 3. 下载走 Blob + URL.createObjectURL，避免 data URI 中 # 截断与体积上限问题。
 */

const FORMULA_PREFIX_RE = /^[=+\-@]/;

export function escapeCsvCell(value: unknown): string {
  let str = value === null || value === undefined ? "" : String(value);
  if (FORMULA_PREFIX_RE.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export function toCsvContent(
  headers: string[],
  rows: unknown[][]
): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  // BOM 保证 Excel 正确识别 UTF-8
  return "﻿" + lines.join("\r\n");
}

/**
 * 触发浏览器下载（仅在浏览器环境可用）。
 */
export function downloadCsv(filename: string, content: string): void {
  const safeName = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
