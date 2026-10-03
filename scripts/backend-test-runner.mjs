import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "..");
const prefix = "diantuo-backend-test-";

export function parseTestOptions(args) {
  const options = { keep: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--keep") { options.keep = true; continue; }
    if (!["--url", "--admin-file"].includes(flag)) throw new Error(`未知测试参数：${flag}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} 需要参数`);
    options[flag === "--url" ? "url" : "adminFile"] = value;
  }
  if (Boolean(options.url) !== Boolean(options.adminFile)) {
    throw new Error("现有站点验收必须同时指定 --url 和 --admin-file；默认测试使用独立临时数据库。");
  }
  if (options.url) {
    const url = new URL(options.url);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) {
      throw new Error("测试地址必须是无账号、路径、查询参数的 HTTPS 站点或 HTTP loopback 地址。");
    }
    options.url = url.origin;
    options.adminFile = path.resolve(options.adminFile);
  }
  return options;
}

export function isolatedConfig(base, directory, projectRoot = root) {
  return {
    ...base,
    $schema: undefined,
    name: "diantuo-backend-test",
    main: path.join(projectRoot, "worker", "local.ts"),
    assets: { ...base.assets, directory: path.join(directory, "assets") },
    d1_databases: [{ binding: "DB", database_name: "diantuo-backend-test", database_id: randomUUID(), migrations_dir: path.join(projectRoot, "db", "migrations") }],
    r2_buckets: [{ binding: "MEDIA", bucket_name: "diantuo-backend-test-media" }],
    observability: { enabled: false },
  };
}

export function assertTemporaryDirectory(directory, tempRoot) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tempRoot) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error("拒绝删除非本次测试临时目录。");
  }
}

export function localOnlyEnvironment(environment) {
  const result = { ...environment };
  // Wrangler's proxy dispatcher can retain a TCP handle after local D1 commands.
  // This runner only needs loopback; leave the user's process/system proxy intact.
  for (const key of Object.keys(result)) if (/^(http|https|all)_proxy$/i.test(key)) delete result[key];
  return result;
}

async function unusedPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

// Track only children launched by this runner; never kill a process found by port/name.
function launch(args, cwd, env, timeoutMs) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit", windowsHide: true, detached: process.platform !== "win32" });
  let failure;
  const exited = new Promise(resolve => {
    child.once("error", error => { failure = error; resolve(1); });
    child.once("exit", code => resolve(code ?? 1));
  });
  let stopping;
  const stop = () => {
    if (stopping) return stopping;
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    stopping = (async () => {
      if (process.platform === "win32") {
        await new Promise(resolve => {
          const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          killer.once("error", resolve); killer.once("exit", resolve);
        });
      } else {
        try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
      await exited;
    })();
    return stopping;
  };
  const timeout = timeoutMs ? setTimeout(() => {
    failure = new Error(`测试子进程超过 ${timeoutMs / 1000} 秒，已停止本次进程树。`);
    void stop();
  }, timeoutMs) : undefined;
  const result = exited.then(code => {
    clearTimeout(timeout);
    if (failure) throw failure;
    return code;
  });
  // The server may fail before the readiness loop starts awaiting its result.
  void result.catch(() => undefined);
  return { child, result, stop };
}

export async function runBackendTests(args) {
  const options = parseTestOptions(args);
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, prefix));
  const artifacts = path.join(directory, "artifacts");
  const env = {
    ...(options.url ? process.env : localOnlyEnvironment(process.env)), CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTS: "false", WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: path.join(directory, "logs"), MINIFLARE_REGISTRY_PATH: path.join(directory, "registry"),
    DIANTUO_TEST_ARTIFACT_DIR: artifacts,
  };
  const launched = [];
  let interrupted = false;
  const stopAll = async () => { for (const processChild of [...launched].reverse()) await processChild.stop(); };
  const interrupt = () => { interrupted = true; void stopAll(); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let passed = false;
  try {
    await mkdir(artifacts);
    let origin = options.url;
    let adminFile = options.adminFile;
    if (!origin) {
      const port = await unusedPort();
      let inspectorPort = await unusedPort();
      while (inspectorPort === port) inspectorPort = await unusedPort();
      origin = `http://127.0.0.1:${port}`;
      const configFile = path.join(directory, "wrangler.json");
      const persist = path.join(directory, "state");
      const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
      const base = JSON.parse(await readFile(path.join(root, "wrangler.local.jsonc"), "utf8"));
      await mkdir(path.join(directory, "assets"));
      await writeFile(path.join(directory, "assets", "index.html"), "<!doctype html><title>Isolated API test</title>");
      await writeFile(configFile, JSON.stringify(isolatedConfig(base, directory), null, 2));
      const bootstrapSecret = randomBytes(32).toString("hex");
      await writeFile(path.join(directory, ".dev.vars"), `BETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}\nBOOTSTRAP_SECRET=${bootstrapSecret}\nAPP_ORIGIN=${origin}\n`, { mode: 0o600 });
      const admin = { username: "audit_admin", name: "隔离验收管理员", password: randomBytes(24).toString("base64url") };
      adminFile = path.join(directory, "admin-access.json");
      await writeFile(adminFile, JSON.stringify(admin), { mode: 0o600 });
      console.log(`后端测试使用独立临时 Worker/D1/R2：${origin}（不会读取生产凭据或写生产数据库）`);
      console.log("[1/4] 应用仓库迁移到本次临时数据库…");
      const migration = launch([wrangler, "d1", "migrations", "apply", "DB", "--local", "--config", configFile, "--persist-to", persist], directory, env, 120000);
      launched.push(migration);
      if (await migration.result !== 0 || interrupted) throw new Error("隔离数据库迁移失败或测试已中断。");
      console.log("[2/4] 启动隔离 Worker 并等待会话接口就绪…");
      const server = launch([wrangler, "dev", "--local", "--config", configFile, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort), "--persist-to", persist, "--log-level", "warn", "--no-show-interactive-dev-session"], directory, env);
      launched.push(server);
      const deadline = Date.now() + 60000;
      for (;;) {
        if (interrupted || server.child.exitCode !== null || server.child.signalCode !== null) throw new Error("隔离 Worker 已退出。");
        if (Date.now() > deadline) throw new Error("隔离 Worker 未在 60 秒内就绪。");
        const response = await fetch(`${origin}/api/session`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
        if (response?.ok && Object.hasOwn(await response.json(), "user")) break;
        await delay(250);
      }
      console.log("[3/4] 初始化本次测试管理员…");
      const bootstrap = await fetch(`${origin}/api/bootstrap`, {
        method: "POST", headers: { origin, "content-type": "application/json", "x-bootstrap-secret": bootstrapSecret },
        body: JSON.stringify(admin), signal: AbortSignal.timeout(15000),
      });
      if (!bootstrap.ok) throw new Error(`隔离管理员初始化失败：HTTP ${bootstrap.status}`);
    } else {
      await readFile(adminFile, "utf8"); // Check explicitly selected credentials before running writes.
      console.log(`显式现有站点验收：${origin}；测试账号和作品会保留，证据写入独立临时目录。`);
    }
    if (interrupted) throw new Error("测试已中断。");
    console.log("[4/4] 运行真实 API、权限和持久化集成测试…");
    const testRun = launch(["--test", "tests/backend.integration.test.mjs"], root, {
      ...env, DIANTUO_TEST_URL: origin, DIANTUO_TEST_ADMIN_PATH: adminFile,
    }, 240000);
    launched.push(testRun);
    const exitCode = await testRun.result;
    passed = exitCode === 0 && !interrupted;
    return interrupted ? 1 : exitCode;
  } finally {
    await stopAll();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    if (options.keep || !passed || options.url) {
      console.log(`本次独立测试目录已保留：${directory}（含测试凭据，请勿公开分享）`);
    } else {
      assertTemporaryDirectory(directory, tempRoot);
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
}
