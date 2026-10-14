import { describe, it, expect } from "vitest";
import { escapeCsvCell, toCsvContent } from "./csv";

describe("escapeCsvCell", () => {
  it("值内双引号转义为两个双引号并整体包裹", () => {
    expect(escapeCsvCell('他说"你好"')).toBe('"他说""你好"""');
  });

  it("以 = + - @ 开头的单元格前补单引号防公式注入", () => {
    expect(escapeCsvCell("=cmd|'/c calc'!A1")).toBe("\"'=cmd|'/c calc'!A1\"");
    expect(escapeCsvCell("+1+1")).toBe("\"'+1+1\"");
    expect(escapeCsvCell("-10")).toBe("\"'-10\"");
    expect(escapeCsvCell("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
  });

  it("普通值原样包裹", () => {
    expect(escapeCsvCell("Google Search")).toBe('"Google Search"');
    expect(escapeCsvCell(42)).toBe('"42"');
  });

  it("null/undefined 导出为空字符串", () => {
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
  });
});

describe("toCsvContent", () => {
  it("表头与数据行正确拼接，含 UTF-8 BOM", () => {
    const csv = toCsvContent(
      ["渠道", "消耗"],
      [
        ["Google", 100],
        ["Meta", 200],
      ]
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("﻿" + '"渠道","消耗"');
    expect(lines[1]).toBe('"Google","100"');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("含 # 与换行的值被安全包裹（配合 Blob 下载不受 URI 截断影响）", () => {
    const csv = toCsvContent(["备注"], [["含#号\n与换行"]]);
    expect(csv).toContain('"含#号\n与换行"');
  });
});
