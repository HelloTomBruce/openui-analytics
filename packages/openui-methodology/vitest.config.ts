import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 纯数据与纯函数包，无 DOM 依赖
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
