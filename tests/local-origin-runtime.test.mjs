import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { launch, localOnlyEnvironment, unusedPort } from "../scripts/backend-test-runner.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("real Wrangler proxy preserves secure same-origin requests and rejects cross-site origins", { timeout: 60000 }, async () => {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, "diantuo-origin-test-"));
  if (path.dirname(path.resolve(directory)) !== tempRoot || !path.basename(directory).startsWith("diantuo-origin-test-")) throw new Error("Unexpected temporary directory");
  let server;
  try {
    const port = await unusedPort();
    let inspectorPort = await unusedPort();
    while (inspectorPort === port) inspectorPort = await unusedPort();
    const origin = `http://127.0.0.1:${port}`;
    const bundled = await build({ stdin: { contents: `
      import { normalizeLocalRequest } from "./app/server/local-origin";
      import { assertOrigin, ApiError } from "./app/server/http";
      export default { async fetch(request, env) {
        try {
          const normalized = normalizeLocalRequest(request, env);
          if (normalized instanceof Response) return normalized;
          assertOrigin(normalized);
          return Response.json({ url: normalized.url, origin: normalized.headers.get("origin"), body: await normalized.text() });
        } catch (error) {
          if (error instanceof ApiError) return Response.json({ code: error.code }, { status: error.status });
          return new Response(null, { status: 500 });
        }
      } };`, resolveDir: root }, bundle: true, format: "esm", platform: "browser", write: false });
    await writeFile(path.join(directory, "worker.js"), bundled.outputFiles[0].text);
    const config = path.join(directory, "wrangler.jsonc");
    await writeFile(config, JSON.stringify({ name: "isolated-origin-test", main: "worker.js", compatibility_date: "2026-05-22", vars: { APP_ORIGIN: origin, APP_PUBLIC_ORIGIN: "https://train.example.com" } }));
    server = launch([path.join(root, "node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--config", config, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort), "--log-level", "warn", "--no-show-interactive-dev-session"], directory, {
      ...localOnlyEnvironment(process.env), CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTS: "false", WRANGLER_WRITE_LOGS: "false", WRANGLER_REGISTRY_PATH: path.join(directory, "registry"),
    });
    const deadline = Date.now() + 30000;
    while (!(await fetch(origin + "/ready", { signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok) {
      if (server.child.exitCode !== null || Date.now() > deadline) throw new Error("Isolated origin worker did not become ready");
      await delay(150);
    }
    const call = (headers, route = "/api/auth/sign-in/username") => new Promise((resolve, reject) => {
      const request = httpRequest(origin + route, { method: "POST", headers: { host: "train.example.com", "x-forwarded-proto": "https", "content-type": "application/json", ...headers }, timeout: 5000 }, response => {
        let body = "";
        response.on("data", chunk => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, data: JSON.parse(body) }));
      });
      request.on("error", reject);
      request.on("timeout", () => request.destroy(new Error("Isolated request timed out")));
      request.end('{"synthetic":true}');
    });
    const passed = await call({ origin: "https://train.example.com", "sec-fetch-site": "same-origin" });
    assert.equal(passed.status, 200);
    assert.deepEqual(passed.data, { url: "https://train.example.com/api/auth/sign-in/username", origin: "https://train.example.com", body: '{"synthetic":true}' });
    for (const site of ["same-site", "cross-site", "none"]) {
      assert.equal((await call({ origin: "http://train.example.com", "sec-fetch-site": site })).status, 403);
    }
    assert.equal((await call({ origin: "https://train.example.com" })).status, 403);
    assert.equal((await call({ origin: "https://evil.example", "sec-fetch-site": "same-origin" })).status, 403);
    assert.equal((await call({ origin: "https://train.example.com", "sec-fetch-site": "same-origin", host: "evil.example" })).status, 421);
    assert.equal((await call({ origin: "https://train.example.com", "sec-fetch-site": "same-origin", "x-forwarded-proto": "http" })).status, 400);
    assert.equal((await call({ origin: "https://train.example.com", "sec-fetch-site": "same-origin" }, "/api/bootstrap")).status, 403);
  } finally {
    await server?.stop();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
