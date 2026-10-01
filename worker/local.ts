import { handleApi } from "../app/server/api";
import type { AppEnv } from "../app/server/auth";
import { normalizeLocalRequest } from "../app/server/local-origin";
import { ApiError, json } from "../app/server/http";

// The same API and bindings as the vinext route, with a bundled React shell.
// This avoids Vite's experimental RSC optimizer during local acceptance.
export default {
  async fetch(request: Request, env: AppEnv & { ASSETS: Fetcher }): Promise<Response> {
    try {
      const normalized = normalizeLocalRequest(request, env);
      if (normalized instanceof Response) return normalized;
      if (new URL(normalized.url).pathname.startsWith("/api/")) {
        return handleApi(normalized, { ...env, APP_ORIGIN: new URL(normalized.url).origin });
      }
      return env.ASSETS.fetch(normalized);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
      return json({ error: "本地访问服务暂时不可用", code: "LOCAL_ORIGIN_FAILED" }, 500);
    }
  },
};
