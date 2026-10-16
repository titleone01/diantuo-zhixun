import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { ensureDesktopServices, launcherOwnerAddress, probeLauncherOwner } from "../scripts/desktop-services.mjs";

const options = { publicOrigin: "https://train.example.com", localWaitMs: 2000, ownerWaitMs: 1000, publicWaitMs: 2000 };
function fixture({ localReady = true, occupied = false, connected = true, owners = {} } = {}) {
  let time = 0;
  const launched = [];
  const status = { ...owners };
  const deps = {
    now: () => time, wait: async ms => { time += ms; },
    probeLocal: async () => ({ ready: localReady }), portOccupied: async () => occupied,
    owner: async kind => status[kind] ?? { alive: false, state: "unknown" },
    launch: async kind => {
      launched.push(kind);
      if (kind === "origin") localReady = true;
      else status[kind] = { alive: true, state: connected ? "connected" : "transport-retry" };
      return { hasExited: () => false };
    },
    probePublic: async () => ({ ready: connected, ...(!connected ? { code: "REQUEST_FAILED" } : {}) }),
    tunnelReady: async () => connected && !!status.tunnel?.alive,
  };
  return { deps, launched, status, online: () => { connected = true; status.relay.state = "connected"; } };
}

test("cold startup brings up the existing origin, 443 relay and fallback in order", async () => {
  const f = fixture({ localReady: false });
  const result = await ensureDesktopServices(options, f.deps);
  assert.deepEqual(f.launched, ["origin", "relay", "tunnel"]);
  assert.equal(result.status, "ready");
  assert.equal(result.publicReady, true);
  assert.equal(result.relayRunning, true);
});

test("repeated startup reuses healthy and temporarily offline owners", async () => {
  const f = fixture({ connected: false });
  const first = await ensureDesktopServices(options, f.deps);
  const second = await ensureDesktopServices(options, f.deps);
  assert.equal(first.status, "waiting-for-public-access");
  assert.equal(first.localReady, true);
  assert.equal(first.publicReady, false);
  assert.equal(first.relayState, "transport-retry");
  assert.deepEqual(second.started, []);
  assert.deepEqual(f.launched, ["relay", "tunnel"]);
  f.online();
  const recovered = await ensureDesktopServices(options, f.deps);
  assert.equal(recovered.status, "ready");
  assert.deepEqual(recovered.started, []);
});

test("an unhealthy old tunnel never blocks the ready 443 path", async () => {
  const f = fixture();
  const launch = f.deps.launch;
  f.deps.launch = async kind => kind === "tunnel" ? { hasExited: () => true } : launch(kind);
  const result = await ensureDesktopServices(options, f.deps);
  assert.equal(result.publicReady, true);
  assert.equal(result.tunnelReady, false);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(f.launched, ["relay"]);
});

test("an occupied unverified origin is preserved and nothing is launched", async () => {
  const f = fixture({ localReady: false, occupied: true });
  await assert.rejects(ensureDesktopServices(options, f.deps), /3000/);
  assert.deepEqual(f.launched, []);
});

test("origin failure prevents starting public forwarders", async () => {
  const f = fixture({ localReady: false });
  f.deps.launch = async kind => { f.launched.push(kind); return { hasExited: () => true }; };
  await assert.rejects(ensureDesktopServices(options, f.deps), /网页服务/);
  assert.deepEqual(f.launched, ["origin"]);
});

test("443 launch failure is reported even if the old public path is reachable", async () => {
  const f = fixture();
  f.deps.launch = async () => ({ hasExited: () => true });
  await assert.rejects(ensureDesktopServices(options, f.deps), /443/);
});

test("an owner that dies after startup is not mistaken for an offline retry loop", async () => {
  const f = fixture({ connected: false });
  f.deps.probePublic = async () => { delete f.status.relay; return { ready: false }; };
  await assert.rejects(ensureDesktopServices(options, f.deps), /已退出/);
});

test("missing fallback configuration still permits complete 443 startup", async () => {
  const f = fixture();
  const result = await ensureDesktopServices({ ...options, tunnelEnabled: false }, f.deps);
  assert.equal(result.publicReady, true);
  assert.deepEqual(f.launched, ["relay"]);
});

test("kernel owner probes distinguish a retrying owner from an absent process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "diantuo-owner-test-"));
  const address = launcherOwnerAddress(directory, "relay");
  const server = createServer(socket => { socket.on("error", () => undefined); socket.end("transport-retry\n"); });
  try {
    await new Promise((resolveReady, reject) => { server.once("error", reject); server.listen(address, resolveReady); });
    assert.deepEqual(await probeLauncherOwner(address), { alive: true, state: "transport-retry" });
    await new Promise(resolveClosed => server.close(resolveClosed));
    assert.equal((await probeLauncherOwner(address)).alive, false);
  } finally {
    if (server.listening) await new Promise(resolveClosed => server.close(resolveClosed));
    await rm(directory, { recursive: true, force: true });
  }
});

test("owner pipe identity matches the production guards", () => {
  const root = resolve(".");
  assert.match(launcherOwnerAddress(root, "relay", "win32"), /^\\\\\.\\pipe\\diantuo-https-relay-[a-f0-9]{20}$/);
  assert.match(launcherOwnerAddress(root, "tunnel", "win32"), /^\\\\\.\\pipe\\diantuo-tunnel-[a-f0-9]{32}$/);
  assert.equal(launcherOwnerAddress(root, "relay"), launcherOwnerAddress(root.toUpperCase(), "relay"));
});

test("Windows desktop launcher supports Unicode paths and rejects simultaneous duplicate work", { skip: process.platform !== "win32", timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "diantuo-desktop-中文-"));
  const script = join(directory, "scripts/start-desktop.ps1");
  const marker = join(directory, "calls.txt");
  const release = join(directory, "release.txt");
  const powershell = join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const children = [];
  try {
    await mkdir(join(directory, "scripts"));
    await mkdir(join(directory, ".local"));
    await writeFile(script, await readFile(new URL("../scripts/start-desktop.ps1", import.meta.url)));
    await writeFile(join(directory, ".local/windows-launcher.json"), JSON.stringify({ nodePath: process.execPath }));
    await writeFile(join(directory, "scripts/desktop-services.mjs"), `import { appendFileSync, existsSync } from 'node:fs';
appendFileSync(${JSON.stringify(marker)}, 'startup\\n');
const deadline = Date.now() + 15000;
while (!existsSync(${JSON.stringify(release)}) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
console.log(JSON.stringify({ publicReady:true, publicUrl:'https://train.example.com' }));\n`);
    const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-NoOpen", "-NoDialog"];
    const first = spawn(powershell, args, { windowsHide: true, stdio: "pipe" });
    children.push(first);
    let firstOutput = "";
    first.stdout.on("data", data => { firstOutput += data; });
    const firstExit = new Promise((resolveExit, reject) => { first.once("exit", resolveExit); first.once("error", reject); });
    const deadline = Date.now() + 10000;
    while (!(await access(marker).then(() => true, () => false))) {
      if (Date.now() >= deadline || first.exitCode !== null) throw new Error("Fixture launcher did not start");
      await delay(25);
    }
    const second = await promisify(execFile)(powershell, args, { windowsHide: true, encoding: "utf8" });
    await writeFile(release, "finished");
    assert.equal(await firstExit, 0);
    assert.match(firstOutput, /https:\/\/train.example.com/);
    assert.match(firstOutput, /电拓智训已在后台运行/);
    assert.ok(second.stdout.length > 0);
    assert.equal((await readFile(marker, "utf8")).trim().split("\n").length, 1);
  } finally {
    await writeFile(release, "finished").catch(() => undefined);
    for (const child of children) if (child.exitCode === null) child.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
