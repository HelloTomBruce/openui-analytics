import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // 根自身作为 project（应用测试，jsdom）+ packages/* 子包（各自配置，node 环境）
    projects: [".", "packages/*"],
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // 强制 test 环境：shell 中若已有 NODE_ENV=production，vitest 不会覆盖，
    // React 会因此加载 production 构建（无 React.act），导致组件测试全部失败。
    env: {
      NODE_ENV: "test",
    },
  },
});
