// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  applyTransform,
  evalExpr,
  inferTransform,
  isValidTransformSpec,
  verifyTransform,
  type TransformSpec,
} from "./transforms";

type Row = Record<string, unknown>;

const DETAIL_ROWS: Row[] = [
  { channel: "TikTok", month: "09", spend: 1000, leads: 50 },
  { channel: "TikTok", month: "10", spend: 1200, leads: 60 },
  { channel: "Google", month: "09", spend: 2000, leads: 80 },
  { channel: "Google", month: "10", spend: 800, leads: 20 },
];

describe("evalExpr 受限四则表达式", () => {
  it("字段引用与四则/括号求值", () => {
    expect(evalExpr("spend / leads", { spend: 100, leads: 4 })).toBe(25);
    expect(evalExpr("(spend + 100) * 2", { spend: 50 })).toBe(300);
    expect(evalExpr("-spend + 10", { spend: 3 })).toBe(7);
  });

  it("数字字符串字段互认；除零/未知字段/非法表达式返回 null", () => {
    expect(evalExpr("spend * 2", { spend: "21" })).toBe(42);
    expect(evalExpr("a / b", { a: 1, b: 0 })).toBeNull(); // Infinity 不合法
    expect(evalExpr("unknown + 1", { a: 1 })).toBeNull();
    expect(evalExpr("alert(1)", {})).toBeNull();
    expect(evalExpr("a; b", { a: 1 })).toBeNull();
    expect(evalExpr("a b", { a: 1, b: 2 })).toBeNull();
  });
});

describe("isValidTransformSpec 形态校验", () => {
  const good: TransformSpec = {
    op: "aggregate",
    groupBy: ["channel"],
    metrics: { spend: "sum", leads: "sum" },
    compute: [{ field: "cac", expr: "spend / leads" }],
    sort: { key: "cac", desc: false },
    limit: 10,
  };

  it("合法 spec 通过；非法项逐一拒绝", () => {
    expect(isValidTransformSpec(good)).toBe(true);
    expect(isValidTransformSpec({ ...good, op: "join" })).toBe(false);
    expect(isValidTransformSpec({ ...good, groupBy: [] })).toBe(false);
    expect(isValidTransformSpec({ ...good, metrics: { spend: "median" } })).toBe(false);
    expect(
      isValidTransformSpec({
        ...good,
        compute: [{ field: "x", expr: "alert(1)" }],
      })
    ).toBe(false);
    expect(isValidTransformSpec({ ...good, limit: 0 })).toBe(false);
    expect(isValidTransformSpec("nope")).toBe(false);
  });
});

describe("applyTransform 确定性重放", () => {
  it("aggregate：分组求和 + 派生列 + 排序 + 截断", () => {
    const spec: TransformSpec = {
      op: "aggregate",
      groupBy: ["channel"],
      metrics: { spend: "sum", leads: "sum" },
      compute: [{ field: "cac", expr: "spend / leads" }],
      sort: { key: "cac", desc: false },
      limit: 1,
    };
    const out = applyTransform(DETAIL_ROWS, spec);
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("TikTok"); // cac=20 < Google 的 28
    expect(out[0].spend).toBe(2200);
    expect(out[0].cac).toBeCloseTo(20);
  });

  it("avg/count/min/max 聚合语义", () => {
    const out = applyTransform(DETAIL_ROWS, {
      op: "aggregate",
      groupBy: ["channel"],
      metrics: { spend: "avg", leads: "max" },
    });
    const tiktok = out.find((r) => r.channel === "TikTok");
    expect(tiktok?.spend).toBe(1100);
    expect(tiktok?.leads).toBe(60);
  });

  it("输入行不被修改（纯函数）", () => {
    const rows = [{ a: 1, b: 2 }];
    applyTransform(rows, {
      op: "aggregate",
      groupBy: ["a"],
      metrics: { b: "sum" },
      compute: [{ field: "c", expr: "b * 10" }],
    });
    expect(rows[0]).toEqual({ a: 1, b: 2 });
  });
});

describe("verifyTransform 一致性验证", () => {
  const spec: TransformSpec = {
    op: "aggregate",
    groupBy: ["channel"],
    metrics: { spend: "sum", leads: "sum" },
    compute: [{ field: "cac", expr: "spend / leads" }],
  };
  const compRows: Row[] = [
    { channel: "TikTok", spend: 2200, leads: 110, cac: 20 },
    { channel: "Google", spend: 2800, leads: 100, cac: 28 },
  ];

  it("重算结果与组件数据一致 → true（忽略行序；容差互认四舍五入）", () => {
    const shuffled = [compRows[1], compRows[0]];
    const keys = new Set(["channel", "spend", "leads", "cac"]);
    expect(verifyTransform(DETAIL_ROWS, spec, shuffled, keys)).toBe(true);
    // LLM 把 cac 写成 20.0 / 28.0（1e-3 相对容差内）
    const rounded: Row[] = [
      { channel: "TikTok", spend: 2200, leads: 110, cac: 20.0 },
      { channel: "Google", spend: 2800, leads: 100, cac: 28.0 },
    ];
    expect(verifyTransform(DETAIL_ROWS, spec, rounded, keys)).toBe(true);
  });

  it("数值被篡改/行数不符 → false", () => {
    const keys = new Set(["channel", "spend", "leads", "cac"]);
    const tampered: Row[] = [
      { channel: "TikTok", spend: 2200, leads: 110, cac: 25 }, // cac 不符
      { channel: "Google", spend: 2800, leads: 100, cac: 28 },
    ];
    expect(verifyTransform(DETAIL_ROWS, spec, tampered, keys)).toBe(false);
    expect(
      verifyTransform(DETAIL_ROWS, spec, [compRows[0]], keys)
    ).toBe(false);
  });
});

describe("inferTransform 推测（第二通道）", () => {
  it("典型聚合+派生列场景：推测出 groupBy+metrics+compute 并通过验证", () => {
    // LLM 拉了明细，组件里是「按渠道汇总 + cac=spend/leads」的加工结果
    const compRows: Row[] = [
      { channel: "TikTok", spend: 2200, leads: 110, cac: 20 },
      { channel: "Google", spend: 2800, leads: 100, cac: 28 },
    ];
    const keys = new Set(["channel", "spend", "leads", "cac"]);
    const spec = inferTransform(DETAIL_ROWS, compRows, keys);
    expect(spec).not.toBeNull();
    expect(spec?.op).toBe("aggregate");
    expect(spec?.groupBy).toEqual(["channel"]);
    expect(spec?.metrics).toEqual({ spend: "sum", leads: "sum" });
    expect(spec?.compute).toEqual([{ field: "cac", expr: "spend / leads" }]);
  });

  it("组件是子集（top N 截断）：推测出 limit", () => {
    const compRows: Row[] = [
      { channel: "Google", spend: 2800, leads: 100 },
    ];
    const keys = new Set(["channel", "spend", "leads"]);
    const spec = inferTransform(DETAIL_ROWS, compRows, keys);
    expect(spec).not.toBeNull();
    expect(spec?.limit).toBe(1);
  });

  it("无字符串分组键/行数未收敛 → null（不强行绑定）", () => {
    const keys = new Set(["spend", "leads"]);
    // 组件行数 >= 查询行数，无法是聚合
    expect(
      inferTransform(DETAIL_ROWS.slice(0, 2), DETAIL_ROWS, keys)
    ).toBeNull();
    // 无共有字符串键
    const noGroup: Row[] = [{ spend: 5, leads: 1 }];
    expect(
      inferTransform(
        [{ spend: 1, leads: 1 }, { spend: 4, leads: 0 }],
        noGroup,
        keys
      )
    ).toBeNull();
  });

  it("加工不是聚合（行被打乱改写）→ null", () => {
    const compRows: Row[] = [
      { channel: "TikTok", spend: 999 }, // 数值对不上任何聚合
      { channel: "Google", spend: 888 },
      { channel: "Baidu", spend: 777 }, // 查询里不存在
    ];
    const keys = new Set(["channel", "spend"]);
    expect(inferTransform(DETAIL_ROWS, compRows, keys)).toBeNull();
  });
});
