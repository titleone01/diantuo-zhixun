import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { acquireTunnelLauncher, superviseTunnel } from "../scripts/tunnel-supervisor.mjs";

const router = { name: "WLAN", interfaceIndex: 7, address: "192.168.8.37", resolvers: ["192.168.8.1"] };
const hotspot = { ...router, address: "192.168.43.18", resolvers: ["192.168.43.1"] };

function fixture(profiles, { exitOnStart, relayError } = {}) {
  const controller = new AbortController();
  const events = [];
  const states = [];
  const starts = [];
  const delays = [];
  let selections = 0;
  let active = 0;
  let liveRelays = 0;
  let relayAttempts = 0;
  return {
    events, states, starts, delays,
    options: {
      signal: controller.signal,
      pollMs: 1,
      async selectNetwork() {
        if (selections >= profiles.length) { controller.abort(); return profiles.at(-1); }
        const profile = profiles[selections++];
        if (profile instanceof Error) throw profile;
        return profile;
      },
      async createDnsRelay(profile) {
        if (relayError?.(++relayAttempts)) throw new Error("IP disappeared during DNS bind");
        assert.equal(liveRelays, 0, "previous DNS relay must close before replacement");
        liveRelays += 1;
        events.push(["dns", profile.address, ...profile.resolvers]);
        let closed = false;
        return {
          resolverAddress: "127.0.0.1:12345",
          close() { if (!closed) { closed = true; liveRelays -= 1; events.push(["dns-close", profile.address]); } },
        };
      },
      async startConnector(profile, relay) {
        assert.equal(active, 0, "never overlap connectors");
        assert.equal(liveRelays, profile ? 1 : 0);
        active += 1;
        starts.push(profile);
        events.push(["start", profile?.address]);
        let resolveExit;
        let ended = false;
        const exited = new Promise(resolveResult => { resolveExit = resolveResult; });
        function end(result) { if (!ended) { ended = true; active -= 1; resolveExit(result); } }
        const result = exitOnStart?.(starts.length);
        if (result) end(result);
        assert.equal(relay?.resolverAddress, profile ? "127.0.0.1:12345" : undefined);
        return {
          exited,
          async stop() {
            events.push(["stop", profile?.address]);
            await nextTurn(); // Exercise delayed exit rather than synchronous fake kills.
            end({ code: 0 });
            await exited;
            events.push(["stopped", profile?.address]);
          },
        };
      },
      onState(event) { states.push(event); },
      async wait(ms) { delays.push(ms); await nextTurn(); },
    },
    assertClosed() { assert.equal(active, 0); assert.equal(liveRelays, 0); },
  };
}

test("router to hotspot to router rebinds IP and DNS after confirmed connector exit", async () => {
  const f = fixture([router, { ...router }, hotspot, hotspot, router]);
  await superviseTunnel(f.options);
  assert.deepEqual(f.starts, [router, hotspot, router]);
  assert.equal(f.states.filter(e => e.type === "network-change").length, 2);
  const hotspotStart = f.events.findIndex(e => e[0] === "start" && e[1] === hotspot.address);
  assert.deepEqual(f.events.slice(hotspotStart - 4, hotspotStart), [
    ["stop", router.address], ["stopped", router.address], ["dns-close", router.address], ["dns", hotspot.address, ...hotspot.resolvers],
  ]);
  f.assertClosed();
});

test("temporary offline periods keep the launcher alive until a new network is available", async () => {
  const offline = new Error("no physical IPv4 network");
  const f = fixture([offline, offline, router, offline, offline, hotspot]);
  await superviseTunnel(f.options);
  assert.deepEqual(f.starts, [router, hotspot]);
  assert.equal(f.states.filter(e => e.type === "waiting").length, 2);
  f.assertClosed();
});

test("DNS or physical interface changes trigger rebinding even when the IPv4 is unchanged", async () => {
  const newDns = { ...router, resolvers: ["192.168.8.2"] };
  const ethernet = { ...newDns, name: "Ethernet", interfaceIndex: 9 };
  const f = fixture([router, newDns, ethernet]);
  await superviseTunnel(f.options);
  assert.deepEqual(f.starts, [router, newDns, ethernet]);
  f.assertClosed();
});

test("failed network inspection preserves an existing connector instead of spawning a second", async () => {
  const f = fixture([router, new Error("PowerShell inspection timed out"), router]);
  await superviseTunnel(f.options);
  assert.equal(f.starts.length, 1);
  f.assertClosed();
});

test("unexpected exits continue retrying beyond three attempts with capped backoff", async () => {
  const f = fixture(Array(18).fill(router), { exitOnStart: n => n <= 6 ? { code: 1 } : undefined });
  f.options.pollMs = 5000;
  await superviseTunnel(f.options);
  assert.equal(f.starts.length, 7);
  assert.deepEqual(f.states.filter(e => e.type === "retry").map(e => e.delayMs), [5000, 10000, 20000, 30000, 30000, 30000]);
  f.assertClosed();
});

test("an executable spawn failure stops retries and closes the owned DNS relay", async () => {
  const f = fixture([router, router], { exitOnStart: () => ({ code: 1, spawnError: true }) });
  await assert.rejects(superviseTunnel(f.options), /无法运行 cloudflared/);
  assert.equal(f.starts.length, 1);
  f.assertClosed();
});

test("an address disappearing between inspection and DNS bind is retried with a fresh profile", async () => {
  const f = fixture([router, hotspot], { relayError: n => n === 1 });
  await superviseTunnel(f.options);
  assert.deepEqual(f.starts, [hotspot]);
  f.assertClosed();
});

test("stopping during DNS setup creates no connector and releases the relay", async () => {
  const f = fixture([router]);
  const controller = new AbortController();
  const createRelay = f.options.createDnsRelay;
  f.options.signal = controller.signal;
  f.options.createDnsRelay = async profile => { const relay = await createRelay(profile); controller.abort(); return relay; };
  await superviseTunnel(f.options);
  assert.equal(f.starts.length, 0);
  f.assertClosed();
});

test("replacement is refused when the owned connector cannot be stopped", async () => {
  const f = fixture([router, hotspot]);
  const start = f.options.startConnector;
  f.options.startConnector = async (...args) => {
    const connector = await start(...args);
    return { ...connector, stop: async () => { throw new Error("owned child did not exit"); } };
  };
  await assert.rejects(superviseTunnel(f.options), /owned child did not exit/);
  assert.equal(f.starts.length, 1);
  assert.equal(f.events.filter(e => e[0] === "dns").length, 1);
});

test("launcher ownership excludes a second launch and is released on shutdown", async () => {
  const root = `tunnel-supervisor-test-${randomUUID()}`;
  const close = await acquireTunnelLauncher(root);
  try { await assert.rejects(acquireTunnelLauncher(root), { code: "EADDRINUSE" }); }
  finally { await close(); }
  const closeAgain = await acquireTunnelLauncher(root);
  await closeAgain();
});
