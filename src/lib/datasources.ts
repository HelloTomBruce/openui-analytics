import path from "node:path";
import { createDatasourceManager } from "@openui-analytics/datasources";

/** 应用级单例：配置文件位置由应用注入（包不内置业务目录） */
export const datasources = createDatasourceManager({
  configPath: path.join(process.cwd(), "config", "datasources.json"),
});
