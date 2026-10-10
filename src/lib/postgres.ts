import { Pool } from "pg";

// 统一 PostgreSQL 连接池单例
export const pool = new Pool({
  user: process.env.PGUSER || process.env.USER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "openui_analytics",
  password: process.env.PGPASSWORD || "",
  port: parseInt(process.env.PGPORT || "5432", 10),
  max: 10,
  idleTimeoutMillis: 30000,
});

let isInitialized = false;

/**
 * 自动初始化数据表与初始样本数据
 */
export async function initDatabase(): Promise<void> {
  if (isInitialized) return;
  const client = await pool.connect();
  try {
    // 1. 创建渠道营销投放表
    await client.query(`
      CREATE TABLE IF NOT EXISTS channel_metrics (
        id SERIAL PRIMARY KEY,
        channel VARCHAR(100) NOT NULL,
        month VARCHAR(10) NOT NULL,
        spend NUMERIC(12, 2) NOT NULL,
        impressions INTEGER NOT NULL,
        clicks INTEGER NOT NULL,
        leads INTEGER NOT NULL,
        cac NUMERIC(10, 2) NOT NULL,
        cvr NUMERIC(6, 2) NOT NULL,
        roi NUMERIC(6, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. 创建销售代表业绩表
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_rep_performance (
        id SERIAL PRIMARY KEY,
        rep_name VARCHAR(100) NOT NULL,
        region VARCHAR(50) NOT NULL,
        target_revenue NUMERIC(14, 2) NOT NULL,
        actual_revenue NUMERIC(14, 2) NOT NULL,
        deals_closed INTEGER NOT NULL,
        win_rate NUMERIC(6, 2) NOT NULL,
        month VARCHAR(10) NOT NULL DEFAULT '2026-Q3',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. 创建月度经营大盘表
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_trends (
        id SERIAL PRIMARY KEY,
        month VARCHAR(10) NOT NULL UNIQUE,
        revenue NUMERIC(14, 2) NOT NULL,
        marketing_cost NUMERIC(12, 2) NOT NULL,
        new_leads INTEGER NOT NULL,
        paying_customers INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 检查是否有数据，若无则初始化 Seed 数据
    const checkCount = await client.query(`SELECT COUNT(*) as count FROM channel_metrics`);
    if (parseInt(checkCount.rows[0].count, 10) === 0) {
      // 填充 channel_metrics
      await client.query(`
        INSERT INTO channel_metrics (channel, month, spend, impressions, clicks, leads, cac, cvr, roi) VALUES
        ('Google Search', '2026-07', 12500.00, 320000, 14200, 410, 30.50, 2.88, 3.40),
        ('Google Search', '2026-08', 13800.00, 350000, 15800, 480, 28.75, 3.03, 3.60),
        ('Google Search', '2026-09', 14500.00, 390000, 17500, 560, 25.89, 3.20, 4.10),
        ('Meta Ads', '2026-07', 14000.00, 450000, 12000, 310, 45.16, 2.58, 2.50),
        ('Meta Ads', '2026-08', 15200.00, 490000, 13100, 340, 44.70, 2.59, 2.60),
        ('Meta Ads', '2026-09', 16000.00, 520000, 14200, 380, 42.10, 2.67, 2.80),
        ('TikTok Ads', '2026-07', 11000.00, 680000, 21000, 510, 21.56, 2.42, 3.90),
        ('TikTok Ads', '2026-08', 13500.00, 790000, 25400, 680, 19.85, 2.67, 4.30),
        ('TikTok Ads', '2026-09', 16200.00, 920000, 31000, 890, 18.20, 2.87, 4.80),
        ('LinkedIn Ads', '2026-07', 6800.00, 85000, 2800, 95, 71.57, 3.39, 2.10),
        ('LinkedIn Ads', '2026-08', 7200.00, 92000, 3100, 110, 65.45, 3.54, 2.30),
        ('LinkedIn Ads', '2026-09', 8000.00, 98000, 3400, 135, 59.25, 3.97, 2.40);
      `);

      // 填充 sales_rep_performance
      await client.query(`
        INSERT INTO sales_rep_performance (rep_name, region, target_revenue, actual_revenue, deals_closed, win_rate, month) VALUES
        ('张伟', '华东', 1000000.00, 1280000.00, 32, 42.50, '2026-Q3'),
        ('李娜', '华北', 850000.00, 920000.00, 24, 38.00, '2026-Q3'),
        ('王强', '华南', 900000.00, 870000.00, 19, 31.50, '2026-Q3'),
        ('陈静', '西南', 600000.00, 750000.00, 18, 45.00, '2026-Q3'),
        ('刘洋', '华中', 550000.00, 510000.00, 12, 28.00, '2026-Q3'),
        ('赵敏', '华东', 800000.00, 890000.00, 22, 41.20, '2026-Q3'),
        ('孙磊', '华北', 700000.00, 670000.00, 15, 33.40, '2026-Q3');
      `);

      // 填充 monthly_trends
      await client.query(`
        INSERT INTO monthly_trends (month, revenue, marketing_cost, new_leads, paying_customers) VALUES
        ('2026-05', 3100000.00, 38000.00, 1120, 145),
        ('2026-06', 3450000.00, 41000.00, 1280, 168),
        ('2026-07', 3920000.00, 44300.00, 1325, 180),
        ('2026-08', 4380000.00, 49700.00, 1610, 215),
        ('2026-09', 4850000.00, 54700.00, 1975, 260);
      `);
    }

    isInitialized = true;
  } finally {
    client.release();
  }
}

/**
 * 只读 SQL 安全校验：仅允许 SELECT / WITH，禁止多语句与 DDL/DML 危险关键字。
 * 校验不通过时抛出包含「安全限制」的错误。
 */
export function assertReadOnlySql(sql: string): void {
  const cleanSql = sql.trim().replace(/;+$/, "");

  // 严禁包含多语句分号（防止通过分号执行多条恶意指令）
  if (cleanSql.includes(";")) {
    throw new Error("安全限制：禁止执行包含多个分号语句的复合 SQL！");
  }

  // 安全校验：只允许 SELECT / WITH 语句开头
  const lower = cleanSql.toLowerCase();
  if (
    !lower.startsWith("select") &&
    !lower.startsWith("with")
  ) {
    throw new Error("安全限制：仅允许执行只读 SELECT / WITH 查询！");
  }

  // 严禁 DDL / DML 危险关键字
  const dangerousKeywords = [
    "drop", "delete", "update", "insert", "alter", "truncate",
    "create", "grant", "revoke", "exec", "execute", "call", "copy"
  ];
  for (const kw of dangerousKeywords) {
    const regex = new RegExp(`(^|\\s|;)(${kw})(\\s|;|\$|\\()`, "i");
    if (regex.test(lower)) {
      throw new Error(`安全限制：检测到禁止的 SQL 指令 [${kw.toUpperCase()}]`);
    }
  }
}

/**
 * 安全执行只读 SQL 查询
 */
export async function executeReadOnlySql(sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  await initDatabase();

  assertReadOnlySql(sql);

  const cleanSql = sql.trim().replace(/;+$/, "");
  const lower = cleanSql.toLowerCase();

  // 限制最大返回行数
  let finalSql = cleanSql;
  if (!lower.includes("limit")) {
    finalSql += " LIMIT 200";
  }

  const result = await pool.query(finalSql);
  return {
    rows: result.rows as Record<string, unknown>[],
    rowCount: result.rowCount || 0,
  };
}

/**
 * 动态获取当前数据库的真实表结构及字段说明
 */
export async function getLiveDatabaseSchema(): Promise<string> {
  await initDatabase();
  const res = await pool.query(`
    SELECT 
      table_name, 
      column_name, 
      data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name IN ('channel_metrics', 'sales_rep_performance', 'monthly_trends')
    ORDER BY table_name, ordinal_position;
  `);

  const tables: Record<string, string[]> = {};
  res.rows.forEach((r) => {
    if (!tables[r.table_name]) {
      tables[r.table_name] = [];
    }
    tables[r.table_name].push(`${r.column_name} (${r.data_type})`);
  });

  return Object.entries(tables)
    .map(([tName, cols]) => `Table: ${tName}\nColumns:\n${cols.map((c) => `  - ${c}`).join("\n")}`)
    .join("\n\n");
}
