import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import test from "node:test";
import { discoverTunnelEdges, safeDnsResponse, tunnelDnsRelay } from "../scripts/tunnel-network.mjs";

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
  const relay = await tunnelDnsRelay({ address: "127.0.0.1", resolvers: ["127.0.0.1"] }, { resolverPort: upstream.address().port, resolveHttps: async () => null });
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
  const relay = await tunnelDnsRelay({ address: "127.0.0.1", resolvers: ["127.0.0.2", "127.0.0.1"] }, { resolverPort: upstream.address().port, timeoutMs: 50, resolveHttps: async () => null });
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
  const relay = await tunnelDnsRelay({ address: "127.0.0.1", resolvers: ["127.0.0.1"] }, { resolverPort: upstream.address().port, timeoutMs: 50, resolveHttps: async () => null });
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

function dnsAnswer(query, ip) {
  const header = Buffer.from(query);
  header[2] |= 0x80;
  header.writeUInt16BE(1, 6);
  return Buffer.concat([header, Buffer.from("c00c000100010000003c0004", "hex"), Buffer.from(ip.split(".").map(Number))]);
}

test("fake-IP, truncated, mismatched and malformed DNS answers are rejected", () => {
  const query = dnsQuery();
  const valid = dnsAnswer(query, "198.41.192.167");
  assert.equal(safeDnsResponse(query, valid), true);
  for (const ip of ["198.18.0.1", "198.19.255.255"]) assert.equal(safeDnsResponse(query, dnsAnswer(query, ip)), false);
  const truncated = Buffer.from(valid); truncated[2] |= 2;
  const mismatched = Buffer.from(valid); mismatched.writeUInt16BE(0x9999, 0);
  const wrongQuestion = Buffer.from(valid); wrongQuestion[13] = 120;
  const badPointer = Buffer.from(valid); badPointer.writeUInt16BE(0xffff, query.length);
  for (const invalid of [truncated, mismatched, wrongQuestion, badPointer, valid.subarray(0, valid.length - 1), Buffer.alloc(2)]) {
    assert.equal(safeDnsResponse(query, invalid), false);
  }
});

test("encrypted DNS wins without consulting intercepted UDP DNS", async t => {
  const upstream = await listener(t);
  let udpQueries = 0;
  upstream.on("message", () => { udpQueries += 1; });
  const query = dnsQuery();
  const answer = dnsAnswer(query, "198.41.192.167");
  const relay = await tunnelDnsRelay({ address: "127.0.0.1", resolvers: ["127.0.0.1"] }, {
    resolverPort: upstream.address().port, resolveHttps: async packet => { assert.deepEqual(packet, query); return answer; },
  });
  t.after(relay.close);
  assert.deepEqual(await request(t, relay, query), answer);
  assert.equal(udpQueries, 0);
});

test("unavailable or unsafe encrypted DNS falls back to a real UDP answer", async t => {
  const upstream = await listener(t);
  upstream.on("message", (packet, peer) => upstream.send(dnsAnswer(packet, "198.41.200.13"), peer.port, peer.address));
  const relay = await tunnelDnsRelay({ address: "127.0.0.1", resolvers: ["127.0.0.1"] }, {
    resolverPort: upstream.address().port, resolveHttps: async packet => dnsAnswer(packet, "198.18.0.1"),
  });
  t.after(relay.close);
  const query = dnsQuery();
  assert.deepEqual(await request(t, relay, query), dnsAnswer(query, "198.41.200.13"));
});

test("intercepted UDP DNS produces SERVFAIL instead of a fake edge address", async t => {
  const upstream = await listener(t);
  upstream.on("message", (packet, peer) => upstream.send(dnsAnswer(packet, "198.18.0.1"), peer.port, peer.address));
  const relay = await tunnelDnsRelay({ address: "127.0.0.1", resolvers: ["127.0.0.1"] }, {
    resolverPort: upstream.address().port, timeoutMs: 30, resolveHttps: async () => null,
  });
  t.after(relay.close);
  const answer = await request(t, relay, dnsQuery());
  assert.equal(answer[3] & 0x0f, 2);
  assert.equal(answer.readUInt16BE(6), 0);
});

test("closing the DNS relay aborts an in-flight encrypted query", async t => {
  const upstream = await listener(t);
  let queryStarted;
  const started = new Promise(resolveResult => { queryStarted = resolveResult; });
  let aborted = false;
  const relay = await tunnelDnsRelay({ address: "127.0.0.1", resolvers: ["127.0.0.1"] }, {
    resolverPort: upstream.address().port,
    resolveHttps: (_packet, { signal }) => new Promise(resolveResult => {
      signal.addEventListener("abort", () => { aborted = true; resolveResult(null); }, { once: true });
      queryStarted();
    }),
  });
  t.after(relay.close);
  const client = createSocket("udp4");
  t.after(() => client.close());
  client.send(dnsQuery(), Number(relay.resolverAddress.split(":")[1]), "127.0.0.1");
  await started;
  relay.close();
  assert.equal(aborted, true);
});

test("edge discovery keeps both SRV groups, their advertised ports and live DNS addresses", async () => {
  const queries = [];
  const resolver = {
    setServers(servers) { assert.deepEqual(servers, ["127.0.0.1:12345"]); },
    async resolveSrv(name) {
      assert.equal(name, "_v2-origintunneld._tcp.argotunnel.com");
      return [{ name: "region2.v2.argotunnel.com", priority: 2, port: 7844 }, { name: "region1.v2.argotunnel.com", priority: 1, port: 7844 }];
    },
    async resolve4(name) { queries.push(name); return name.startsWith("region1") ? ["198.41.192.7", "198.41.192.27"] : ["198.41.200.13"]; },
  };
  assert.deepEqual(await discoverTunnelEdges({ resolverAddress: "127.0.0.1:12345" }, { resolver }), ["198.41.192.7:7844", "198.41.192.27:7844", "198.41.200.13:7844"]);
  assert.deepEqual(queries, ["region1.v2.argotunnel.com", "region2.v2.argotunnel.com"]);
  resolver.resolve4 = async () => ["198.41.192.47"];
  assert.deepEqual(await discoverTunnelEdges({ resolverAddress: "127.0.0.1:12345" }, { resolver }), ["198.41.192.47:7844"]);
});

test("edge discovery rejects poisoned endpoints and propagates DNS outages for retry", async () => {
  const resolver = {
    setServers() {},
    async resolveSrv() { return [{ name: "region1.v2.argotunnel.com", priority: 1, port: 7844 }]; },
    async resolve4() { return ["198.18.0.1"]; },
  };
  for (const ip of ["198.18.0.1", "198.19.0.1", "127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.1.1", "224.0.0.1", "invalid"]) {
    resolver.resolve4 = async () => [ip];
    await assert.rejects(discoverTunnelEdges({ resolverAddress: "127.0.0.1:12345" }, { resolver }), /虚拟或私有/);
  }
  resolver.resolveSrv = async () => [{ name: "attacker.example", priority: 1, port: 7844 }];
  await assert.rejects(discoverTunnelEdges({ resolverAddress: "127.0.0.1:12345" }, { resolver }), /服务发现/);
  resolver.resolveSrv = async () => { throw new Error("DNS offline"); };
  await assert.rejects(discoverTunnelEdges({ resolverAddress: "127.0.0.1:12345" }, { resolver }), /DNS offline/);
});
