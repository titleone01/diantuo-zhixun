import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// The launcher remains the owner while its connector is between networks.
// A kernel-managed pipe prevents another launch during that gap, without PID kills.
export async function acquireTunnelLauncher(root) {
  const key = createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 32);
  const address = process.platform === "win32" ? `\\\\.\\pipe\\diantuo-tunnel-${key}` : join(tmpdir(), `diantuo-tunnel-${key}.sock`);
  const server = createServer(socket => socket.end());
  await new Promise((resolveResult, reject) => {
    server.once("error", reject);
    server.listen({ path: address, exclusive: true }, resolveResult);
  });
  server.removeAllListeners("error");
  server.on("error", error => console.error(`隧道启动锁错误：${error.message}`));
  return () => new Promise((resolveResult, reject) => server.close(error => error ? reject(error) : resolveResult()));
}

function networkIdentity(profile) {
  return profile ? JSON.stringify([profile.interfaceIndex, profile.name, profile.address, profile.resolvers]) : "system-routing";
}

// Only connectors created here may be stopped. Never adopt an existing PID.
export async function superviseTunnel({ selectNetwork, createDnsRelay, startConnector, signal, onState = () => {}, pollMs = 5000, wait = delay }) {
  let connector;
  let relay;
  let identity;
  let exitResult;
  let selectionError;
  let failures = 0;
  let startedAt;
  const pause = async ms => {
    try { await wait(ms, undefined, { signal }); }
    catch (error) { if (!signal.aborted) throw error; }
  };
  const stopOwned = async () => {
    if (connector) {
      await connector.stop();
      connector = undefined;
    }
    relay?.close();
    relay = undefined;
    exitResult = undefined;
  };
  try {
    while (!signal.aborted) {
      let network;
      try {
        network = await selectNetwork();
        selectionError = undefined;
      } catch (error) {
        if (selectionError !== error.message) onState({ type: "waiting", message: error.message });
        selectionError = error.message;
        // A failed inspection must not terminate a possibly healthy connector.
        // Keep waiting so temporary offline periods do not end the launcher.
        await pause(pollMs);
        continue;
      }
      if (signal.aborted) break;
      const nextIdentity = networkIdentity(network);
      if (!connector || identity !== nextIdentity || exitResult) {
        const previousExit = exitResult;
        const changed = connector && identity !== nextIdentity;
        if (changed) onState({ type: "network-change", network });
        await stopOwned(); // Exit confirmation precedes DNS replacement and spawn.
        if (previousExit?.spawnError) throw new Error("无法运行 cloudflared；请检查程序和隧道日志。");
        if (previousExit && !changed) {
          failures = Date.now() - startedAt >= 60000 ? 1 : failures + 1;
          onState({ type: "retry", delayMs: Math.min(30000, pollMs * 2 ** Math.min(failures - 1, 4)) });
          await pause(Math.min(30000, pollMs * 2 ** Math.min(failures - 1, 4)));
          // Re-read the network after backoff, rather than using an old snapshot.
          continue;
        }
        if (signal.aborted) break;
        try { relay = network ? await createDnsRelay(network) : undefined; }
        catch (error) {
          onState({ type: "waiting", message: `DNS 转发暂不可用：${error.message}` });
          await pause(pollMs);
          continue;
        }
        if (signal.aborted) break;
        connector = await startConnector(network, relay);
        identity = nextIdentity;
        if (changed) failures = 0;
        startedAt = Date.now();
        const owned = connector;
        connector.exited.then(result => { if (connector === owned) exitResult = result; });
        onState({ type: "starting", network });
      }
      await pause(pollMs);
    }
  } finally {
    await stopOwned();
  }
}
