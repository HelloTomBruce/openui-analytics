import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 组件库测试需要 DOM 环境（recharts/testing-library 依赖浏览器 API）
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    env: {
      NODE_ENV: "test",
    },
  },
});
