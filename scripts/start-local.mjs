import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { connect } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const origin = "http://localhost:3000";
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false", WRANGLER_LOG_PATH: resolve(root, ".wrangler/logs"), MINIFLARE_REGISTRY_PATH: resolve(root, ".wrangler/registry"), CI: "true" };

async function portOccupied() {
  return new Promise(resolveResult => {
    const socket = connect({ host: "127.0.0.1", port: 3000 });
    const finish = value => { socket.destroy(); resolveResult(value); };
    socket.setTimeout(1500, () => finish(true));
    socket.once("connect", () => finish(true));
    socket.once("error", error => finish(error.code !== "ECONNREFUSED"));
  });
}
async function ready() {
  try {
    const response = await fetch(`${origin}/api/session`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const value = await response.json();
    return value && Object.hasOwn(value, "user");
  } catch { return false; }
}
function child(args, options = {}) {
  return spawn(process.execPath, args, { cwd: root, env, stdio: "inherit", windowsHide: true, ...options });
}
async function run(args) {
  const processChild = child(args);
  await new Promise((resolveResult, reject) => {
    processChild.once("error", reject);
    processChild.once("exit", code => code === 0 ? resolveResult() : reject(new Error(`启动步骤失败，退出码 ${code ?? "interrupted"}`)));
  });
}

// Check before preparing, migrating, or building: an existing process is left
// completely alone, including processes owned by another project.
if (await portOccupied()) {
  if (await ready()) {
    console.log(`已有成员站服务正在运行：${origin}。未修改文件、未重启服务。`);
    process.exit(0);
  }
  console.error("3000 端口已被其他服务占用；未停止或修改该服务。请先在对应终端停止它后再运行。");
  process.exit(1);
}

// Once an operator activates an immutable release, the existing desktop entry
// must keep using that release and the original state. Never silently fall back
// to building development sources when an activated release is invalid.
const releaseRuntime = resolve(root, ".wrangler");
let releaseInstalled = false;
try {
  const pointer = await lstat(resolve(releaseRuntime, "active-release.json"));
  if (!pointer.isFile() || pointer.isSymbolicLink()) throw new Error("Invalid active release pointer");
  releaseInstalled = true;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (releaseInstalled) {
  process.argv = [process.execPath, resolve(root, "scripts/start-release.mjs"), releaseRuntime, "3000"];
  await import("./start-release.mjs");
  process.exit(process.exitCode ?? 0);
}

await run(["scripts/bootstrap-admin.mjs", "--prepare"]);
await run([wrangler, "d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state"]);
await run(["scripts/build-local-app.mjs"]);
const server = child([wrangler, "dev", "--config", "wrangler.local.jsonc", "--ip", "127.0.0.1", "--port", "3000", "--persist-to", ".wrangler/state"]);
let stopped = false;
const exited = new Promise(resolveResult => {
  server.once("error", () => { stopped = true; resolveResult(1); });
  server.once("exit", code => { stopped = true; resolveResult(code ?? 0); });
});
let stopping;
function stop() {
  if (stopping || stopped) return stopping || Promise.resolve();
  // Only the process tree launched above is stopped. Never search or kill by
  // executable name or port, because other chats can have independent servers.
  stopping = process.platform === "win32"
    ? new Promise(resolveResult => {
      const killer = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      killer.once("exit", resolveResult); killer.once("error", resolveResult);
    })
    : Promise.resolve(server.kill("SIGTERM"));
  return stopping;
}
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
try {
  const deadline = Date.now() + 60000;
  while (!(await ready())) {
    if (stopped || Date.now() > deadline) throw new Error("本地服务未在 60 秒内就绪，请查看上方 Worker 错误。");
    await delay(300);
  }
  await run(["scripts/bootstrap-admin.mjs", "--url", origin]);
  console.log(`成员站已就绪：${origin}\n管理员凭据：${resolve(root, ".local/admin-access.json")}\n按 Ctrl+C 停止本次启动的服务。`);
  process.exitCode = Number(await exited);
} catch (error) {
  console.error(error instanceof Error ? error.message : "本地启动失败");
  await stop();
  process.exitCode = 1;
}
