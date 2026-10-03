import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedConfig, launch, localOnlyEnvironment, unusedPort } from "./backend-test-runner.mjs";
import { verifyArchive } from "./release-tools.mjs";

const root = path.resolve(import.meta.dirname, "..");

/** Test-owned credentials/config/state only. Caller stops every owned child in finally. */
export async function createFixture({ release, directory, config: previous, origin: previousOrigin, initialize = true } = {}) {
  if (release) release = path.resolve(release);
  const target = directory || await mkdtemp(path.join(tmpdir(), "diantuo-fixture-"));
  await mkdir(path.join(target, "artifacts"), { recursive: true });
  const port = previousOrigin ? Number(new URL(previousOrigin).port) : await unusedPort();
  let inspector = await unusedPort();
  while (inspector === port) inspector = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...localOnlyEnvironment(process.env), CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTS: "false", WRANGLER_WRITE_LOGS: "false", WRANGLER_REGISTRY_PATH: path.join(target, "registry") };
  const base = JSON.parse(await readFile(path.join(root, "wrangler.local.jsonc"), "utf8"));
  let config = previous || isolatedConfig(base, target, root);
  if (release) {
    await verifyArchive(release, "release");
    const compiled = JSON.parse(await readFile(path.join(release, "runtime.json"), "utf8"));
    config = { ...config, main: path.join(release, compiled.main), no_bundle: false, find_additional_modules: false,
      assets: { ...compiled.assets, directory: path.join(release, "assets") },
      d1_databases: config.d1_databases.map(db => ({ ...db, migrations_dir: path.join(release, "migrations") })),
    };
  } else {
    await mkdir(path.join(target, "assets"), { recursive: true });
    await writeFile(path.join(target, "assets/index.html"), "<!doctype html><title>Isolated test</title>");
  }
  const configFile = path.join(target, "wrangler.json"), state = path.join(target, "state"), leaseFile = path.join(target, "runtime-lease.json");
  await writeFile(configFile, JSON.stringify(config));
  const adminFile = path.join(target, "admin-access.json");
  let bootstrapSecret;
  if (initialize) {
    bootstrapSecret = randomBytes(32).toString("hex");
    await writeFile(path.join(target, ".dev.vars"), `BETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}\nBOOTSTRAP_SECRET=${bootstrapSecret}\nAPP_ORIGIN=${origin}\n`, { mode: 0o600 });
    await writeFile(adminFile, JSON.stringify({ username: "fixture_admin", name: "隔离验收管理员", password: randomBytes(24).toString("base64url") }), { mode: 0o600 });
  }
  const children = new Set();
  const run = async (args, childEnv = {}, timeout = 240000, cwd = root) => {
    const child = launch(args, cwd, { ...env, ...childEnv }, timeout); children.add(child);
    try { const code = await child.result; if (code !== 0) throw new Error(`Isolated command exited ${code}`); }
    finally { await child.stop(); children.delete(child); }
  };
  const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  let server;
  const stop = async () => { for (const child of [...children].reverse()) await child.stop(); children.clear(); server = undefined; };
  const start = async () => {
    if (server) throw new Error("Fixture already running");
    server = launch([wrangler, "dev", "--local", "--config", configFile, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspector), "--persist-to", state, "--log-level", "warn", "--no-show-interactive-dev-session"], target, env);
    children.add(server);
    await writeFile(leaseFile, JSON.stringify({ pid: server.child.pid, origin, startedAt: new Date().toISOString() }));
    const deadline = Date.now() + 60000;
    for (;;) {
      if (server.child.exitCode !== null || server.child.signalCode !== null) throw new Error("Fixture worker exited");
      if (Date.now() > deadline) throw new Error("Fixture readiness timeout");
      const response = await fetch(`${origin}/api/session`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
      if (response?.ok && Object.hasOwn(await response.json(), "user")) return;
      await delay(250);
    }
  };
  const testEnv = { DIANTUO_TEST_URL: origin, DIANTUO_TEST_ADMIN_PATH: adminFile, DIANTUO_TEST_ARTIFACT_DIR: path.join(target, "artifacts") };
  try {
    if (initialize) await run([wrangler, "d1", "migrations", "apply", "DB", "--local", "--config", configFile, "--persist-to", state], {}, 120000, target);
    await start();
    if (initialize) {
      const admin = JSON.parse(await readFile(adminFile, "utf8"));
      const result = await fetch(`${origin}/api/bootstrap`, { method: "POST", headers: { origin, "content-type": "application/json", "x-bootstrap-secret": bootstrapSecret }, body: JSON.stringify(admin), signal: AbortSignal.timeout(15000) });
      if (!result.ok) throw new Error(`Fixture bootstrap: HTTP ${result.status}`);
    }
  } catch (error) { await stop(); throw error; }
  return { directory: target, origin, config, state, adminFile, leaseFile, env: testEnv, run, start, stop, get pid() { return server?.child.pid; } };
}
