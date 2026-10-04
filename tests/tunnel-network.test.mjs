import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import test from "node:test";
import { tunnelDnsRelay } from "../scripts/tunnel-network.mjs";

async function listener(t) {
  const server = createSocket("udp4");
  server.bind(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  return server;
}

function dnsQuery(id = 0x1234) {
  const packet = Buffer.from("00000100000100000000000007726567696f6e310276320a6172676f74756e6e656c03636f6d0000010001", "hex");
  packet.writeUInt16BE(id, 0);
  return packet;
}

async function request(t, relay, packet) {
  const client = createSocket("udp4");
  t.after(() => client.close());
  const response = new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => reject(new Error("DNS response timed out")), 1500);
    client.once("error", error => { clearTimeout(timer); reject(error); });
    client.once("message", message => { clearTimeout(timer); resolveResult(message); });
  });
  client.send(packet, Number(relay.resolverAddress.split(":")[1]), "127.0.0.1");
  return response;
}

test("project DNS relay binds loopback, preserves query bytes and ignores mismatched responses", async t => {
  const upstream = await listener(t);
  const query = dnsQuery();
  const valid = Buffer.from(query);
  valid[2] |= 0x80;
  let forwarded;
  upstream.on("message", (packet, peer) => {
    forwarded = { packet, address: peer.address };
    const wrong = Buffer.from(valid);
    wrong.writeUInt16BE(0x9999, 0);
    upstream.send(wrong, peer.port, peer.address);
    upstream.send(valid, peer.port, peer.address);
  });
  const relay = await tunnelDnsRelay({ address: "127.0.0.1", resolvers: ["127.0.0.1"] }, { resolverPort: upstream.address().port });
  t.after(relay.close);
  assert.match(relay.resolverAddress, /^127\.0\.0\.1:\d+$/);
  assert.deepEqual(await request(t, relay, query), valid);
  assert.deepEqual(forwarded.packet, query);
  assert.equal(forwarded.address, "127.0.0.1");
});

test("project DNS relay tries the next resolver after an unreachable one", async t => {
  const upstream = await listener(t);
  upstream.on("message", (packet, peer) => {
    const reply = Buffer.from(packet);
    reply[2] |= 0x80;
    upstream.send(reply, peer.port, peer.address);
  });
  const relay = await tunnelDnsRelay({ address: "127.0.0.1", resolvers: ["127.0.0.2", "127.0.0.1"] }, { resolverPort: upstream.address().port, timeoutMs: 50 });
  t.after(relay.close);
  const reply = await request(t, relay, dnsQuery(0x4321));
  assert.equal(reply.readUInt16BE(0), 0x4321);
  assert.equal(reply[3] & 0x0f, 0);
});

test("project DNS timeout returns SERVFAIL and subsequent requests can recover", async t => {
  const upstream = await listener(t);
  let respond = false;
  upstream.on("message", (packet, peer) => {
    if (!respond) return;
    const reply = Buffer.from(packet);
    reply[2] |= 0x80;
    upstream.send(reply, peer.port, peer.address);
  });
  const relay = await tunnelDnsRelay({ address: "127.0.0.1", resolvers: ["127.0.0.1"] }, { resolverPort: upstream.address().port, timeoutMs: 50 });
  t.after(relay.close);
  const failure = await request(t, relay, dnsQuery());
  assert.equal(failure.readUInt16BE(0), 0x1234);
  assert.equal(failure[2] & 0x80, 0x80);
  assert.equal(failure[3] & 0x0f, 2);
  assert.deepEqual(failure.subarray(6, 12), Buffer.alloc(6));
  respond = true;
  const success = await request(t, relay, dnsQuery(0x4567));
  assert.equal(success.readUInt16BE(0), 0x4567);
  assert.equal(success[3] & 0x0f, 0);
  relay.close();
  relay.close();
});
