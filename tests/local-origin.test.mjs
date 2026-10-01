import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundled = await build({ stdin: { contents: 'export * from "./app/server/local-origin"; export * from "./app/server/http";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false });
const { normalizeLocalRequest, assertOrigin } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const env = { APP_ORIGIN: "http://localhost:3000", APP_PUBLIC_ORIGIN: "https://train.example.com" };

test("HTTPS tunnel retains the same-origin mutation and request body", async () => {
  const request = new Request("http://train.example.com/api/circuits?revision=4", { method: "POST", headers: { origin: env.APP_PUBLIC_ORIGIN, "x-forwarded-proto": "https", "content-type": "application/json", cookie: "test=session", "sec-fetch-site": "same-origin" }, body: '{"title":"远程草稿"}' });
  const normalized = normalizeLocalRequest(request, env);
  assert.equal(normalized.url, "https://train.example.com/api/circuits?revision=4");
  assert.equal(normalized.headers.get("cookie"), "test=session");
  assert.equal(await normalized.text(), '{"title":"远程草稿"}');
  assert.doesNotThrow(() => assertOrigin(normalized));
});

test("loopback and the fixed HTTPS origin stay isolated; spoofed hosts and origins fail", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const request = new Request(`http://${host}:3000/api/session`);
    assert.equal(normalizeLocalRequest(request, env), request);
  }
  const crossSite = new Request("http://train.example.com/api/circuits", { method: "POST", headers: { origin: "https://evil.example", "x-forwarded-proto": "https" } });
  assert.throws(() => assertOrigin(normalizeLocalRequest(crossSite, env)), error => error.status === 403);
  const fakeHost = new Request("http://evil.example/api/session", { headers: { origin: env.APP_PUBLIC_ORIGIN, "x-forwarded-host": "train.example.com", "x-forwarded-proto": "https" } });
  assert.throws(() => normalizeLocalRequest(fakeHost, env), error => error.status === 421);
  const fakeForward = new Request("http://localhost:3000/api/circuits", { method: "POST", headers: { origin: env.APP_PUBLIC_ORIGIN, "x-forwarded-host": "train.example.com", "x-forwarded-proto": "https" } });
  assert.throws(() => assertOrigin(normalizeLocalRequest(fakeForward, env)), error => error.status === 403);
  assert.throws(() => normalizeLocalRequest(new Request("http://localhost:3001/api/session"), env), error => error.status === 421);
  assert.throws(() => normalizeLocalRequest(new Request("http://train.example.com/api/session"), { APP_ORIGIN: env.APP_ORIGIN }), error => error.status === 421);
});

test("HTTP public navigation redirects to HTTPS, mutations require HTTPS, and bootstrap stays local", () => {
  const redirect = normalizeLocalRequest(new Request("http://train.example.com/login?from=profile"), env);
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "https://train.example.com/login?from=profile");
  assert.throws(() => normalizeLocalRequest(new Request("http://train.example.com/api/circuits", { method: "POST" }), env), error => error.code === "HTTPS_REQUIRED");
  const bootstrap = normalizeLocalRequest(new Request("http://train.example.com/api/bootstrap", { method: "POST", headers: { "x-forwarded-proto": "https" } }), env);
  assert.equal(bootstrap.status, 403);
  const localBootstrap = new Request("http://localhost:3000/api/bootstrap", { method: "POST" });
  assert.equal(normalizeLocalRequest(localBootstrap, env), localBootstrap);
});

test("origin configuration rejects cleartext, credentials, paths, queries, and wildcard hosts", () => {
  for (const remote of ["http://train.example.com", "https://user:pass@train.example.com", "https://train.example.com/path", "https://train.example.com/?query=1", "https://train.example.com/#fragment", "https://localhost:3000", "https://*.example.com", "*"]) {
    assert.throws(() => normalizeLocalRequest(new Request("http://localhost:3000/api/session"), { ...env, APP_PUBLIC_ORIGIN: remote }), error => error.code === "ORIGIN_CONFIG_INVALID");
  }
});
