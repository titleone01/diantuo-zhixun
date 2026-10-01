import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const privateDir = resolve(root, ".local/network-access");
const binary = resolve(root, ".local/tools/cloudflared.exe");
const tokenFile = resolve(privateDir, "tunnel-token.txt");
const metrics = "127.0.0.1:20251";

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
    const child = spawn(binary, ["tunnel", "--no-autoupdate", "--loglevel", "info", "--metrics", metrics, "--pidfile", resolve(privateDir, "tunnel.pid"), "run", "--token-file", tokenFile], { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", error => { console.error(error.message); process.exitCode = 1; });
    child.once("exit", code => { process.exitCode = code ?? 0; });
    if (child.pid) await writeFile(resolve(privateDir, "tunnel-launch.pid"), `${child.pid}\n`);
    let stopping = false;
    const stop = () => {
      if (stopping || child.exitCode !== null || !child.pid) return;
      stopping = true;
      if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else child.kill("SIGTERM");
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    console.log(`外网入口：${publicUrl.origin}/\n保持本地成员站和本终端运行；按 Ctrl+C 仅停止本次启动的隧道。`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "隧道启动失败");
  process.exitCode = 1;
}
