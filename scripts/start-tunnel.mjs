import { execFile, spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { physicalWindowsNetwork, tunnelDnsRelay } from "./tunnel-network.mjs";
import { probeMemberSite } from "./site-readiness.mjs";
import { acquireTunnelLauncher, superviseTunnel } from "./tunnel-supervisor.mjs";

const root = resolve(import.meta.dirname, "..");
const privateDir = resolve(root, ".local/network-access");
const binary = resolve(root, ".local/tools/cloudflared.exe");
const tokenFile = resolve(privateDir, "tunnel-token.txt");
const metrics = "127.0.0.1:20251";
const execute = promisify(execFile);
let releaseLauncher;
const controller = new AbortController();
const stop = () => controller.abort();

async function startConnector(network, dnsRelay) {
  const networkArgs = network ? ["--edge-bind-address", network.address] : [];
  const runArgs = dnsRelay ? ["--dns-resolver-addrs", dnsRelay.resolverAddress] : [];
  const args = ["tunnel", "--no-autoupdate", "--protocol", "http2", ...networkArgs, "--loglevel", "info", "--metrics", metrics, "--pidfile", resolve(privateDir, "tunnel.pid"), "run", ...runArgs, "--token-file", tokenFile];
  const child = spawn(binary, args, { cwd: root, stdio: "inherit", windowsHide: true });
  let ended = false;
  const exited = new Promise(resolveResult => {
    child.once("error", error => { ended = true; console.error(error.message); resolveResult({ code: 1, spawnError: true }); });
    child.once("exit", code => { ended = true; resolveResult({ code: code ?? 0, spawnError: false }); });
  });
  if (child.pid) await writeFile(resolve(privateDir, "tunnel-launch.pid"), `${child.pid}\n`).catch(error => console.error(`无法记录隧道进程：${error.message}`));
  return {
    exited,
    async stop() {
      if (ended || !child.pid) return;
      // This PID comes from our live ChildProcess, never from a file or port scan.
      if (process.platform === "win32") {
        await execute("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }).catch(error => { if (!ended) throw error; });
      } else child.kill("SIGTERM");
      const timeout = new AbortController();
      try {
        await Promise.race([exited, delay(10000, undefined, { signal: timeout.signal }).then(() => { throw new Error("旧隧道尚未退出，已停止启动新连接。"); })]);
      } finally { timeout.abort(); }
    },
  };
}

async function main() {
try {
  await Promise.all([access(binary), access(tokenFile)]);
  const vars = await readFile(resolve(root, ".dev.vars"), "utf8");
  const value = vars.match(/^APP_PUBLIC_ORIGIN\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2");
  const publicUrl = new URL(value ?? "");
  if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) throw new Error("APP_PUBLIC_ORIGIN 必须是完整的 HTTPS 站点地址。");
  if (!(await probeMemberSite("http://localhost:3000", { timeoutMs: 2500 })).ready) throw new Error("本机页面、会话或同源请求检查未通过；请运行 npm run start:local 并检查服务日志。");
  // Keep existing connectors under their original owner.
  const existing = await fetch(`http://${metrics}/ready`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
  if (existing?.ok) {
    if (!(await probeMemberSite(publicUrl.origin, { timeoutMs: 10000 })).ready) throw new Error("已有隧道连接，但公网页面、会话或同源请求检查未通过；请检查成员站日志。");
    console.log(`已有隧道连接正在运行。访问：${publicUrl.origin}/`);
  } else {
    try { releaseLauncher = await acquireTunnelLauncher(root); }
    catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      console.log("本项目隧道启动器已在运行，正在等待网络或恢复连接；无需重复启动。");
      return;
    }
    // An older/foreign unhealthy connector must not cause a duplicate launch.
    const occupied = await fetch(`http://${metrics}/ready`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (occupied) throw new Error("已有隧道进程占用连接端口；请先核对并停止本项目旧启动器，再启动新版。不会自动结束其他进程。");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    console.log(`外网入口：${publicUrl.origin}/\n保持本地成员站和本终端运行；按 Ctrl+C 仅停止本次启动的隧道。`);
    await superviseTunnel({
      selectNetwork: physicalWindowsNetwork,
      createDnsRelay: tunnelDnsRelay,
      startConnector,
      signal: controller.signal,
      onState(event) {
        if (event.type === "waiting") console.log(`等待可用网络：${event.message}`);
        if (event.type === "network-change") console.log("检测到网卡、IP 或 DNS 变化，正在重新连接隧道。");
        if (event.type === "retry") console.log(`隧道连接退出，${Math.ceil(event.delayMs / 1000)} 秒后重新检测网络。`);
        if (event.type === "starting") console.log(event.network ? `隧道使用当前物理网卡 ${event.network.name}（${event.network.address}）及其 DNS，换网后会自动重连。` : "隧道使用系统路由。");
      },
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "隧道启动失败");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  await releaseLauncher?.();
}
}
await main();
