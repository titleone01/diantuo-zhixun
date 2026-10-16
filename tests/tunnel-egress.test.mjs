import assert from "node:assert/strict";
import { connect, createServer } from "node:net";
import { once } from "node:events";
import test from "node:test";
import { connectThroughProxy, findLoopbackProxy, proxyEdgeRelay, tunnelConnectionPlan } from "../scripts/tunnel-egress.mjs";

async function listen(t, handler) {
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
    handler(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  return { host: "127.0.0.1", port: server.address().port };
}

test("proxy detection stays on loopback and finds a configured port without credentials", async t => {
  const proxy = await listen(t, socket => socket.end());
  assert.deepEqual(await findLoopbackProxy({ env: { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}` }, ports: [] }), proxy);
  assert.equal(await findLoopbackProxy({ env: { HTTPS_PROXY: "http://external.example:8080", HTTP_PROXY: "http://user:password@127.0.0.1:8080" }, ports: [] }), null);
});

test("CONNECT accepts split headers and preserves the first opaque upstream bytes", { timeout: 3000 }, async t => {
  const firstBytes = Buffer.from([0x16, 0x03, 0x03, 0x00, 0x02]);
  const proxy = await listen(t, socket => {
    socket.once("data", data => {
      assert.match(data.toString(), /^CONNECT 198\.41\.192\.167:7844 HTTP\/1\.1\r\n/);
      socket.write("HTTP/1.1 200 Connection");
      setImmediate(() => socket.write(Buffer.concat([Buffer.from(" established\r\n\r\n"), firstBytes])));
    });
  });
  const socket = await connectThroughProxy("198.41.192.167:7844", proxy);
  t.after(() => socket.destroy());
  const reply = once(socket, "data");
  socket.resume();
  assert.deepEqual((await reply)[0], firstBytes);
});

test("CONNECT refuses authentication, oversized headers, timeouts and cancellation", async t => {
  const rejected = await listen(t, socket => socket.once("data", () => socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")));
  await assert.rejects(connectThroughProxy("198.41.192.167:7844", rejected), /refused/);
  const oversized = await listen(t, socket => socket.once("data", () => socket.write("x".repeat(8193))));
  await assert.rejects(connectThroughProxy("198.41.192.167:7844", oversized), /too large/);
  const silent = await listen(t, () => {});
  await assert.rejects(connectThroughProxy("198.41.192.167:7844", silent, { timeoutMs: 30 }), /timed out/);
  const controller = new AbortController();
  const pending = connectThroughProxy("198.41.192.167:7844", silent, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /aborted/);
  await assert.rejects(connectThroughProxy("198.41.192.167:7844\r\nBad: value", silent), /Invalid/);
});

test("four loopback relays forward both directions through the proxy and close owned sockets", { timeout: 5000 }, async t => {
  const receivedTargets = [];
  const echo = await listen(t, socket => socket.pipe(socket));
  const proxy = await listen(t, socket => {
    socket.once("data", packet => {
      const target = packet.toString().match(/^CONNECT ([^ ]+) /)?.[1];
      receivedTargets.push(target);
      const upstream = connect(echo);
      upstream.on("error", () => socket.destroy());
      socket.once("close", () => upstream.destroy());
      upstream.once("connect", () => {
        socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
        socket.pipe(upstream); upstream.pipe(socket);
      });
    });
  });
  const relay = await proxyEdgeRelay(["198.41.192.167:7844", "198.41.200.13:7844"], proxy);
  t.after(relay.close);
  assert.equal(relay.edgeAddresses.length, 4);
  await Promise.all(relay.edgeAddresses.map(async address => {
    assert.match(address, /^127\.0\.0\.[1-4]:\d+$/);
    const socket = connect({ host: address.split(":")[0], port: Number(address.split(":")[1]) });
    t.after(() => socket.destroy());
    socket.setTimeout(1500, () => socket.destroy(new Error("relay timed out")));
    await once(socket, "connect");
    const reply = once(socket, "data");
    socket.write(Buffer.from([0x16, 0x03, 0x03, 0x01]));
    assert.deepEqual((await reply)[0], Buffer.from([0x16, 0x03, 0x03, 0x01]));
    socket.destroy();
  }));
  assert.deepEqual(receivedTargets.sort(), ["198.41.192.167:7844", "198.41.192.167:7844", "198.41.200.13:7844", "198.41.200.13:7844"]);
  relay.close();
  relay.close();
});

test("connection plans cover proxy, TCP, UDP, physical adapter and system route", () => {
  const withProxy = { proxy: { host: "127.0.0.1", port: 7897 } };
  assert.deepEqual(Array.from({ length: 5 }, (_, attempt) => tunnelConnectionPlan(withProxy, attempt)), [
    { protocol: "http2", route: "physical" }, { protocol: "http2", route: "proxy" }, { protocol: "quic", route: "physical" },
    { protocol: "http2", route: "system" }, { protocol: "quic", route: "system" },
  ]);
  assert.deepEqual(Array.from({ length: 4 }, (_, attempt) => tunnelConnectionPlan({}, attempt)), [
    { protocol: "http2", route: "physical" }, { protocol: "quic", route: "physical" },
    { protocol: "http2", route: "system" }, { protocol: "quic", route: "system" },
  ]);
  assert.deepEqual(tunnelConnectionPlan(withProxy, 5), { protocol: "http2", route: "physical" });
});
