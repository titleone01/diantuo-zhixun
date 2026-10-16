import { connect, createServer } from "node:net";

// Only reuse unauthenticated loopback proxies. Never change proxy configuration.
export async function findLoopbackProxy({ env = process.env, ports = [7897, 7890], timeoutMs = 250 } = {}) {
  const candidates = [];
  for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"]) {
    try {
      const url = new URL(env[key]);
      if (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && !url.username && !url.password) {
        candidates.push({ host: "127.0.0.1", port: Number(url.port || 80) });
      }
    } catch { /* No configured local HTTP proxy. */ }
  }
  candidates.push(...ports.map(port => ({ host: "127.0.0.1", port })));
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.host}:${candidate.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const available = await new Promise(resolveResult => {
      const socket = connect(candidate);
      const timer = setTimeout(() => finish(false), timeoutMs);
      function finish(value) { clearTimeout(timer); socket.destroy(); resolveResult(value); }
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
    if (available) return candidate;
  }
  return null;
}

export function tunnelConnectionPlan(network, attempt = 0) {
  if (network?.proxy) {
    const slot = attempt % 5;
    if (slot === 1) return { protocol: "http2", route: "proxy" };
    return { protocol: slot === 0 || slot === 3 ? "http2" : "quic", route: slot <= 2 ? "physical" : "system" };
  }
  return { protocol: attempt % 2 ? "quic" : "http2", route: attempt % 4 < 2 ? "physical" : "system" };
}

// CONNECT transports opaque bytes; TLS identity and Tunnel authentication stay
// inside cloudflared (or the HTTPS client). No TLS termination or bypass here.
export function connectThroughProxy(target, proxy, { signal, timeoutMs = 5000 } = {}) {
  if (!/^[a-z0-9.-]+:\d{1,5}$/i.test(target) || proxy.host !== "127.0.0.1"
    || !Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) {
    return Promise.reject(new Error("Invalid local proxy target"));
  }
  return new Promise((resolveResult, reject) => {
    if (signal?.aborted) { reject(new Error("Proxy connection aborted")); return; }
    const socket = connect(proxy);
    let packet = Buffer.alloc(0);
    let ended = false;
    const timer = setTimeout(() => finish(new Error("Proxy connection timed out")), timeoutMs);
    const abort = () => finish(new Error("Proxy connection aborted"));
    function finish(error) {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.removeListener("data", receive);
      if (error) { socket.destroy(); reject(error); }
      else { socket.pause(); resolveResult(socket); }
    }
    function receive(chunk) {
      packet = Buffer.concat([packet, chunk]);
      const end = packet.indexOf("\r\n\r\n");
      if (end < 0) {
        if (packet.length > 8192) finish(new Error("Proxy response too large"));
        return;
      }
      if (end > 8192 || !/^HTTP\/1\.[01] 200(?: |\r\n)/.test(packet.toString("latin1", 0, end + 2))) {
        finish(new Error("Local proxy refused CONNECT")); return;
      }
      socket.pause();
      socket.removeListener("data", receive);
      if (packet.length > end + 4) socket.unshift(packet.subarray(end + 4));
      finish();
    }
    signal?.addEventListener("abort", abort, { once: true });
    socket.once("connect", () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    socket.on("data", receive);
    socket.on("error", error => finish(error));
    socket.once("end", () => finish(new Error("Proxy closed before CONNECT")));
  });
}

export async function proxyEdgeRelay(edgeAddresses, proxy) {
  if (!edgeAddresses.length) throw new Error("No discovered Tunnel edges");
  const servers = [];
  const sockets = new Set();
  const controller = new AbortController();
  let next = 0;
  const middle = Math.ceil(edgeAddresses.length / 2);
  const targets = edgeAddresses.slice(0, middle).flatMap((address, index) => [address, edgeAddresses[middle + index]].filter(Boolean));
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    controller.abort();
    for (const socket of sockets) socket.destroy();
    for (const server of servers) if (server.listening) server.close();
  }
  try {
    for (let index = 0; index < 4; index += 1) {
      const server = createServer(client => {
        if (sockets.size >= 64) { client.destroy(); return; }
        sockets.add(client);
        client.pause();
        client.on("error", () => client.destroy());
        client.once("close", () => sockets.delete(client));
        const target = targets[next++ % targets.length];
        void connectThroughProxy(target, proxy, { signal: controller.signal }).then(upstream => {
          if (client.destroyed || controller.signal.aborted) { upstream.destroy(); return; }
          sockets.add(upstream);
          upstream.on("error", () => { upstream.destroy(); client.destroy(); });
          upstream.once("close", () => { sockets.delete(upstream); client.destroy(); });
          client.once("close", () => upstream.destroy());
          client.pipe(upstream);
          upstream.pipe(client);
          client.resume();
          upstream.resume();
        }).catch(() => client.destroy());
      });
      servers.push(server);
      await new Promise((resolveResult, reject) => {
        server.once("error", reject);
        server.listen(0, `127.0.0.${index + 1}`, resolveResult);
      });
      server.removeAllListeners("error");
      server.on("error", close);
    }
    return { edgeAddresses: servers.map(server => `${server.address().address}:${server.address().port}`), close };
  } catch (error) { close(); throw error; }
}
