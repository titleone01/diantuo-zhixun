import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { persistenceFetch, persistencePaths } from "../scripts/test-persistence.mjs";

test("persistence checks retain old local defaults and independently accept isolated paths", () => {
  const local = fileURLToPath(new URL("../.local/", import.meta.url));
  assert.deepEqual(persistencePaths({}), { artifactDirectory: path.resolve(local), adminPath: path.join(local, "admin-access.json") });
  const artifacts = path.resolve("temp", "isolated", "artifacts");
  const admin = path.resolve("temp", "isolated", "admin-access.json");
  assert.deepEqual(persistencePaths({ DIANTUO_TEST_ARTIFACT_DIR: artifacts, DIANTUO_TEST_ADMIN_PATH: admin }), { artifactDirectory: artifacts, adminPath: admin });
  assert.equal(persistencePaths({ DIANTUO_TEST_ARTIFACT_DIR: artifacts }).adminPath, path.join(local, "admin-access.json"));
});

test("persistence requests use a finite deadline and do not retry a timed-out login", async t => {
  const controller = new AbortController();
  const timeout = t.mock.method(AbortSignal, "timeout", milliseconds => {
    assert.equal(milliseconds, 15000);
    return controller.signal;
  });
  const fetch = t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.method, "POST");
    return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  });
  const request = persistenceFetch("http://localhost/api/auth/sign-in/username", { method: "POST", body: "{}" });
  const rejected = assert.rejects(request, error => error.name === "TimeoutError");
  controller.abort(new DOMException("test timeout", "TimeoutError"));
  await rejected;
  assert.equal(timeout.mock.callCount(), 1);
  assert.equal(fetch.mock.callCount(), 1);
});
