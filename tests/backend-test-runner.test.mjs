import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { assertTemporaryDirectory, isolatedConfig, localOnlyEnvironment, parseTestOptions } from "../scripts/backend-test-runner.mjs";

test("backend test runner defaults to isolation and requires explicit credentials for live writes", () => {
  assert.deepEqual(parseTestOptions([]), { keep: false });
  assert.deepEqual(parseTestOptions(["--keep"]), { keep: true });
  for (const args of [["--url", "http://localhost:3000"], ["--admin-file", "admin.json"], ["--url"], ["--unknown"]]) {
    assert.throws(() => parseTestOptions(args));
  }
  assert.equal(parseTestOptions(["--url", "http://127.0.0.1:43127/", "--admin-file", "admin.json"]).url, "http://127.0.0.1:43127");
});

test("explicit target validation rejects credential-bearing and insecure remote URLs", () => {
  for (const url of ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?token=secret", "file:///tmp"])
    assert.throws(() => parseTestOptions(["--url", url, "--admin-file", "admin.json"]));
});

test("isolated config preserves worker compatibility while separating all writable data", () => {
  const projectRoot = path.resolve("project"), directory = path.resolve("temp", "diantuo-backend-test-example");
  const base = { compatibility_date: "2026-05-22", compatibility_flags: ["nodejs_compat"], assets: { directory: ".local/app", binding: "ASSETS", run_worker_first: ["/api/*"] }, d1_databases: [{ database_id: "production" }], r2_buckets: [{ bucket_name: "production" }] };
  const config = isolatedConfig(base, directory, projectRoot);
  assert.equal(config.compatibility_date, base.compatibility_date);
  assert.equal(config.assets.directory, path.join(directory, "assets"));
  assert.equal(config.main, path.join(projectRoot, "worker", "local.ts"));
  assert.equal(config.d1_databases[0].migrations_dir, path.join(projectRoot, "db", "migrations"));
  assert.notEqual(config.d1_databases[0].database_id, "production");
  assert.notEqual(config.r2_buckets[0].bucket_name, "production");
  assert.equal(base.assets.directory, ".local/app");
});

test("cleanup guard permits only a direct runner-created temporary directory", () => {
  const tempRoot = path.resolve("temp");
  assert.doesNotThrow(() => assertTemporaryDirectory(path.join(tempRoot, "diantuo-backend-test-123"), tempRoot));
  for (const directory of [tempRoot, path.resolve("project"), path.join(tempRoot, "user-data"), path.join(tempRoot, "nested", "diantuo-backend-test-123")])
    assert.throws(() => assertTemporaryDirectory(directory, tempRoot));
});

test("local test subprocesses bypass proxy dispatchers without changing the parent environment", () => {
  const original = { PATH: "runtime", HTTPS_PROXY: "private-proxy", http_proxy: "private-proxy", ALL_PROXY: "private-proxy", NO_PROXY: "localhost" };
  assert.deepEqual(localOnlyEnvironment(original), { PATH: "runtime", NO_PROXY: "localhost" });
  assert.equal(original.HTTPS_PROXY, "private-proxy");
});
