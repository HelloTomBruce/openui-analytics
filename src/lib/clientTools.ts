"use client";

/**
 * OpenUI 客户端本地工具集合 (Client Tool Provider)
 * 允许大模型生成的 OpenUI 界面直接调用浏览器端本地 API，无需往返服务端
 */
export const clientTools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  /**
   * 1. 客户端直接导出 CSV 文件
   */
  export_csv: async (rawArgs: Record<string, unknown>) => {
    const filename = typeof rawArgs.filename === "string" ? rawArgs.filename : "export.csv";
    const data = rawArgs.data;
    const headers = rawArgs.headers as Array<{ key: string; header: string }> | string[] | undefined;

    let rows: Array<Record<string, unknown>> = [];
    if (typeof data === "string") {
      try {
        rows = JSON.parse(data);
      } catch {
        rows = [];
      }
    } else if (Array.isArray(data)) {
      rows = data as Array<Record<string, unknown>>;
    }

    if (rows.length === 0) {
      if (typeof window !== "undefined") {
        alert("⚠️ 没有可导出的数据行");
      }
      return { success: false, message: "No data" };
    }

    const firstRow = rows[0];
    const columnKeys = headers
      ? Array.isArray(headers) && typeof headers[0] === "object"
        ? (headers as Array<{ key: string }>).map((h) => h.key)
        : (headers as string[])
      : Object.keys(firstRow);

    const csvContent =
      "data:text/csv;charset=utf-8,\uFEFF" +
      columnKeys.join(",") +
      "\n" +
      rows
        .map((row) =>
          columnKeys
            .map((k) => {
              const val = row[k] ?? "";
              const str = String(val).replace(/"/g, '""');
              return `"${str}"`;
            })
            .join(",")
        )
        .join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    return { success: true, message: `已成功导出 ${rows.length} 条数据至 ${filename}` };
  },

  /**
   * 2. 复制内容到系统剪贴板
   */
  copy_to_clipboard: async (rawArgs: Record<string, unknown>) => {
    const text = typeof rawArgs.text === "string" ? rawArgs.text : JSON.stringify(rawArgs);
    const label = typeof rawArgs.label === "string" ? rawArgs.label : "内容";

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      if (typeof window !== "undefined") {
        alert(`✅ 已复制 ${label} 到剪贴板！`);
      }
      return { success: true };
    }
    return { success: false, message: "Clipboard API not available" };
  },

  /**
   * 3. 触发浏览器打印/导出 PDF 预览
   */
  print_dashboard: async () => {
    if (typeof window !== "undefined") {
      window.print();
      return { success: true };
    }
    return { success: false };
  },

  /**
   * 4. 模拟服务端变异写入 (Mutation)
   */
  update_business_target: async (rawArgs: Record<string, unknown>) => {
    const metric = typeof rawArgs.metric === "string" ? rawArgs.metric : "指标";
    const newTarget = rawArgs.newTarget;
    console.log(`[OpenUI Mutation] 更新业务目标: ${metric} -> ${newTarget}`);
    return {
      success: true,
      updatedAt: new Date().toISOString(),
      message: `已成功将「${metric}」目标调整为 ${newTarget}`,
    };
  },
};
