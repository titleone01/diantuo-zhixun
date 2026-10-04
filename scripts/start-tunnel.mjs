import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { physicalWindowsNetwork, tunnelDnsRelay } from "./tunnel-network.mjs";

const root = resolve(import.meta.dirname, "..");
const privateDir = resolve(root, ".local/network-access");
const binary = resolve(root, ".local/tools/cloudflared.exe");
const tokenFile = resolve(privateDir, "tunnel-token.txt");
const metrics = "127.0.0.1:20251";
let dnsRelay;

try {
  await Promise.all([access(binary), access(tokenFile)]);
  const vars = await readFile(resolve(root, ".dev.vars"), "utf8");
  const value = vars.match(/^APP_PUBLIC_ORIGIN\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2");
  const publicUrl = new URL(value ?? "");
  if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) throw new Error("APP_PUBLIC_ORIGIN 必须是完整的 HTTPS 站点地址。");
  const local = await fetch("http://localhost:3000/api/session", { signal: AbortSignal.timeout(2500) });
  if (!local.ok || !Object.hasOwn(await local.json(), "user")) throw new Error("请先在另一个终端运行 npm run start:local，等待成员站就绪。");
  // A running connector is left alone. This command never stops a process
  // found by port, executable name, or a previously recorded PID.
  const existing = await fetch(`http://${metrics}/ready`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
  if (existing?.ok) {
    console.log(`已有隧道连接正在运行。访问：${publicUrl.origin}/`);
  } else {
    const network = await physicalWindowsNetwork();
    const networkArgs = [];
    if (network) {
      dnsRelay = await tunnelDnsRelay(network);
      networkArgs.push("--edge-bind-address", network.address);
      console.log(`隧道使用物理网卡 ${network.name} 和该网卡的 DNS；仅作用于本项目连接。`);
    }
    const runArgs = dnsRelay ? ["--dns-resolver-addrs", dnsRelay.resolverAddress] : [];
    const args = ["tunnel", "--no-autoupdate", "--protocol", "http2", ...networkArgs, "--loglevel", "info", "--metrics", metrics, "--pidfile", resolve(privateDir, "tunnel.pid"), "run", ...runArgs, "--token-file", tokenFile];
    let child;
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      dnsRelay?.close();
      if (!child?.pid || child.exitCode !== null) return;
      if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else child.kill("SIGTERM");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    console.log(`外网入口：${publicUrl.origin}/\n保持本地成员站和本终端运行；按 Ctrl+C 仅停止本次启动的隧道。`);
    for (let attempt = 1; attempt <= 3 && !stopping; attempt += 1) {
      const started = Date.now();
      child = spawn(binary, args, { cwd: root, stdio: "inherit", windowsHide: true });
      const exited = new Promise(resolveResult => {
        child.once("error", error => { console.error(error.message); resolveResult({ code: 1, spawnError: true }); });
        child.once("exit", code => resolveResult({ code: code ?? 0, spawnError: false }));
      });
      if (child.pid) {
        // PID recording is diagnostic; a disk error must not orphan the child.
        await writeFile(resolve(privateDir, "tunnel-launch.pid"), `${child.pid}\n`).catch(error => console.error(`无法记录隧道进程：${error.message}`));
      }
      const result = await exited;
      if (stopping || result.code === 0 || result.spawnError || attempt === 3 || Date.now() - started >= 60000) {
        process.exitCode = stopping ? 0 : result.code;
        break;
      }
      console.log(`隧道首次连接中断，正在重新查询节点并重连（${attempt + 1}/3）。`);
      await delay(1000);
    }
    dnsRelay?.close();
  }
} catch (error) {
  dnsRelay?.close();
  console.error(error instanceof Error ? error.message : "隧道启动失败");
  process.exitCode = 1;
}
