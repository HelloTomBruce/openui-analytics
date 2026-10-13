/**
 * 部署鉴权访问令牌（对应服务端 OPENUI_API_AUTH_TOKEN）。
 * 本地开发未配置服务端 token 时留空即可。
 */

export const ACCESS_TOKEN_STORAGE_KEY = "openui_access_token";

export function getAccessToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || "";
}

/** 为 API 请求生成鉴权头；未配置令牌时为空对象（可安全展开）。 */
export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
