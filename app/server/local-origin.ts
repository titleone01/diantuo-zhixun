import { ApiError, json } from "./http";

type LocalOrigins = { APP_ORIGIN?: string; APP_PUBLIC_ORIGIN?: string };
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function configuredOrigin(value: string, remote: boolean): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ApiError(500, "ORIGIN_CONFIG_INVALID", "访问地址配置无效"); }
  if (url.username || url.password || url.hostname.includes("*") || url.pathname !== "/" || url.search || url.hash
    || (remote ? url.protocol !== "https:" || loopbackHosts.has(url.hostname)
      : url.protocol !== "http:" || !loopbackHosts.has(url.hostname))) {
    throw new ApiError(500, "ORIGIN_CONFIG_INVALID", "访问地址配置无效");
  }
  return url;
}

// Only the loopback Worker uses this adapter. The tunnel sends the original
// Host and X-Forwarded-Proto; an arbitrary Origin/X-Forwarded-Host never selects
// an authentication origin. Public hosting keeps its existing canonical URL.
export function normalizeLocalRequest(request: Request, env: LocalOrigins): Request | Response {
  const local = configuredOrigin(env.APP_ORIGIN || "http://localhost:3000", false);
  const remote = env.APP_PUBLIC_ORIGIN ? configuredOrigin(env.APP_PUBLIC_ORIGIN, true) : null;
  const url = new URL(request.url);
  if (url.protocol === local.protocol && url.port === local.port && loopbackHosts.has(url.hostname)) return request;
  if (!remote || url.host !== remote.host) throw new ApiError(421, "HOST_NOT_ALLOWED", "请使用配置的站点地址访问");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  if (url.protocol !== "https:" && forwardedProtocol !== "https") {
    if (request.method !== "GET" && request.method !== "HEAD") throw new ApiError(400, "HTTPS_REQUIRED", "请通过 HTTPS 提交");
    url.protocol = "https:";
    return Response.redirect(url.href, 308);
  }
  if (url.pathname.replace(/\/$/, "") === "/api/bootstrap") return json({ error: "初始化仅限本机", code: "LOCAL_ONLY" }, 403);
  url.protocol = "https:";
  return new Request(url.href, request);
}
