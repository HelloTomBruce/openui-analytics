import path from "node:path";
import { createDatasourceManager } from "@openui-analytics/datasources";

/** 应用级单例：配置与文件落盘位置由应用注入（包不内置业务目录） */
export const datasources = createDatasourceManager({
  configPath: path.join(process.cwd(), "config", "datasources.json"),
  filesDir: path.join(process.cwd(), "data", "files"),
});
