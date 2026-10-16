import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { probeMemberSite } from "./site-readiness.mjs";

export function launcherOwnerAddress(root, kind, platform = process.platform) {
  if (!["relay", "tunnel"].includes(kind)) throw new Error("Unknown launcher owner");
  const key = createHash("sha256").update(resolve(root).toLowerCase()).digest("hex").slice(0, kind === "relay" ? 20 : 32);
  const name = `diantuo-${kind === "relay" ? "https-relay" : "tunnel"}-${key}`;
  return platform === "win32" ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
}

export function probeLauncherOwner(address, timeoutMs = 1000) {
  return new Promise(resolveResult => {
    const socket = connect(address);
    let value = "";
    let alive = false;
    const timer = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timer);
      socket.destroy();
      const state = value.trim();
      resolveResult({ alive, state: ["starting", "connected", "network-changed", "transport-retry"].includes(state) ? state : "unknown" });
    }
    socket.once("connect", () => { alive = true; });
    socket.on("data", data => { value += data.toString("utf8").slice(0, 64); if (value.length >= 64) finish(); });
    socket.once("end", finish);
    socket.once("error", finish);
  });
}

// Ownership stays valid while a connector waits for Wi-Fi or a local proxy.
export async function ensureDesktopServices({ publicOrigin, tunnelEnabled = true, localWaitMs = 180000, ownerWaitMs = 10000, publicWaitMs = 30000 }, deps) {
  const { probeLocal, portOccupied, owner, launch, probePublic, tunnelReady, now = Date.now, wait = delay } = deps;
  const started = [];
  const warnings = [];
  async function waitFor(probe, child, deadlineMs, message) {
    const deadline = now() + deadlineMs;
    do {
      if (await probe()) return;
      if (child.hasExited()) {
        if (await probe()) return;
        throw new Error(message);
      }
      await wait(500);
    } while (now() < deadline);
    throw new Error(message);
  }

  if (!(await probeLocal()).ready) {
    if (await portOccupied()) throw new Error("3000 端口已有服务，但成员站检查未通过；现有进程已保留，请查看服务日志。");
    const child = await launch("origin");
    started.push("origin");
    await waitFor(async () => (await probeLocal()).ready, child, localWaitMs, "已激活的网页服务未能启动，请查看启动日志。");
  }

  // The 443 connector starts before the fallback tunnel, without waiting for it.
  for (const kind of ["relay", ...(tunnelEnabled ? ["tunnel"] : [])]) {
    if ((await owner(kind)).alive) continue;
    try {
      const child = await launch(kind);
      started.push(kind);
      await waitFor(async () => (await owner(kind)).alive, child, ownerWaitMs, kind === "relay" ? "443 转发程序启动失败，请查看日志并保留原凭据。" : "备用隧道启动失败。");
    } catch (error) {
      if (kind === "relay") throw error;
      warnings.push(error.message);
    }
  }

  const deadline = now() + publicWaitMs;
  let publicCheck;
  do {
    publicCheck = await probePublic(publicOrigin, Math.max(1, Math.min(2500, Math.floor((deadline - now()) / 3))));
    if (publicCheck.ready || now() >= deadline) break;
    if (!(await owner("relay")).alive) throw new Error("443 转发程序已退出，请查看启动日志。");
    await wait(Math.min(1000, Math.max(1, deadline - now())));
  } while (now() < deadline);
  const relay = await owner("relay");
  if (!relay.alive) throw new Error("443 转发程序已退出，请查看启动日志。");
  return {
    checkedAt: new Date(now()).toISOString(), status: publicCheck?.ready ? "ready" : "waiting-for-public-access",
    localReady: true, relayRunning: true, relayState: relay.state,
    tunnelReady: await tunnelReady(), publicReady: !!publicCheck?.ready,
    publicCheckCode: publicCheck?.code ?? null, publicUrl: publicOrigin, started, warnings,
  };
}

function configuredPath(root, value) {
  if (typeof value !== "string" || !value) throw new Error("桌面启动缺少 443 转发配置，请重新安装快捷方式。");
  const path = resolve(root, value);
  const within = relative(root, path);
  if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) throw new Error("启动文件必须保存在当前项目内。");
  return path;
}

function occupiedPort() {
  return new Promise(resolveResult => {
    const socket = connect({ host: "127.0.0.1", port: 3000 });
    const finish = occupied => { socket.destroy(); resolveResult(occupied); };
    socket.setTimeout(1500, () => finish(true));
    socket.once("connect", () => finish(true));
    socket.once("error", error => finish(error.code !== "ECONNREFUSED"));
  });
}

async function runDesktopServices(root) {
  const logDir = resolve(root, ".local/desktop-launcher");
  await mkdir(logDir, { recursive: true });
  try {
    const config = JSON.parse((await readFile(resolve(root, ".local/windows-launcher.json"), "utf8")).replace(/^\uFEFF/, ""));
    const publicUrl = new URL(config.publicOrigin);
    if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) throw new Error("没有有效的固定 HTTPS 网址配置。");
    const relayScript = configuredPath(root, config.relayScript);
    const relayCredential = configuredPath(root, config.relayCredential);
    // Only check existence; the connector itself decrypts its private credential.
    await Promise.all([access(relayScript), access(relayCredential)]);
    const runtime = resolve(root, ".wrangler");
    const pointer = await lstat(resolve(runtime, "active-release.json"));
    if (!pointer.isFile() || pointer.isSymbolicLink()) throw new Error("缺少有效的已激活发布，启动器不会初始化新数据库。");
    const tunnelEnabled = await Promise.all([".local/tools/cloudflared.exe", ".local/network-access/tunnel-token.txt"].map(file => access(resolve(root, file)).then(() => true, () => false))).then(files => files.every(Boolean));
    const scripts = { origin: [resolve(root, "scripts/start-release.mjs"), runtime, "3000"], relay: [relayScript], tunnel: [resolve(root, "scripts/start-tunnel.mjs")] };
    const result = await ensureDesktopServices({ publicOrigin: publicUrl.origin, tunnelEnabled }, {
      probeLocal: () => probeMemberSite("http://127.0.0.1:3000", { timeoutMs: 2500 }),
      portOccupied: occupiedPort,
      async owner(kind) {
        const state = await probeLauncherOwner(launcherOwnerAddress(root, kind));
        if (kind === "tunnel" && !state.alive && await tunnelReady()) return { alive: true, state: "connected" };
        return state;
      },
      async launch(kind) {
        const stamp = `${Date.now()}-${process.pid}-${kind}`;
        const stdout = openSync(resolve(logDir, `${stamp}.out.log`), "a");
        const stderr = openSync(resolve(logDir, `${stamp}.err.log`), "a");
        let child;
        try {
          child = spawn(process.execPath, scripts[kind], { cwd: root, detached: true, windowsHide: true, stdio: ["ignore", stdout, stderr] });
          await new Promise((resolveSpawn, reject) => { child.once("spawn", resolveSpawn); child.once("error", reject); });
          child.unref();
        } finally { closeSync(stdout); closeSync(stderr); }
        return { hasExited: () => child.exitCode !== null || child.signalCode !== null };
      },
      probePublic: (origin, timeoutMs) => probeMemberSite(origin, { timeoutMs }), tunnelReady,
    });
    await writeFile(resolve(logDir, "last-result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    const message = error.code === "ENOENT" ? "缺少启动配置、转发程序、加密凭据或已激活发布；请保留完整项目并查看启动日志。" : error.message;
    await writeFile(resolve(logDir, "last-error.txt"), message);
    console.error(message);
    process.exitCode = 1;
  }
}

async function tunnelReady() {
  try { return (await fetch("http://127.0.0.1:20251/ready", { signal: AbortSignal.timeout(1500) })).ok; }
  catch { return false; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runDesktopServices(resolve(import.meta.dirname, ".."));
