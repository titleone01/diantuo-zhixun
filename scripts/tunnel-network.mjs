import { execFile } from "node:child_process";
import { createSocket } from "node:dgram";
import { Resolver } from "node:dns/promises";
import { Agent, request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { isIPv4 } from "node:net";
import { promisify } from "node:util";
import { connectThroughProxy, findLoopbackProxy } from "./tunnel-egress.mjs";

const execute = promisify(execFile);

function closeSocket(socket) {
  try { socket.close(); } catch (error) {
    if (error.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") throw error;
  }
}

function skipDnsName(packet, start) {
  let offset = start;
  while (offset < packet.length) {
    const length = packet[offset++];
    if (length === 0) return offset;
    if ((length & 0xc0) === 0xc0) {
      if (offset >= packet.length || (((length & 0x3f) << 8) | packet[offset]) >= packet.length) break;
      return offset + 1;
    }
    if (length > 63 || offset + length >= packet.length) break;
    offset += length;
  }
  throw new Error("Invalid DNS name");
}

// Reject malformed packets and proxy fake-IP answers before cloudflared sees them.
export function safeDnsResponse(query, response) {
  try {
    if (!Buffer.isBuffer(response) || response.length < 12 || response.length > 4096
      || response.readUInt16BE(0) !== query.readUInt16BE(0) || !(response[2] & 0x80)
      || (response[2] & 0x7a) !== (query[2] & 0x78) || [2, 5].includes(response[3] & 0x0f)
      || response.readUInt16BE(4) !== 1 || query.readUInt16BE(4) !== 1) return false;
    const questionEnd = skipDnsName(query, 12) + 4;
    let offset = skipDnsName(response, 12) + 4;
    if (offset !== questionEnd || !query.subarray(12, questionEnd).equals(response.subarray(12, offset))) return false;
    const count = response.readUInt16BE(6) + response.readUInt16BE(8) + response.readUInt16BE(10);
    for (let index = 0; index < count; index += 1) {
      offset = skipDnsName(response, offset);
      const type = response.readUInt16BE(offset);
      const length = response.readUInt16BE(offset + 8);
      offset += 10;
      if (offset + length > response.length || (type === 1 && length !== 4) || (type === 28 && length !== 16)) return false;
      const ipv4 = type === 1 ? offset : type === 28 && response.subarray(offset, offset + 12).equals(Buffer.from("00000000000000000000ffff", "hex")) ? offset + 12 : undefined;
      if (ipv4 !== undefined && response[ipv4] === 198 && [18, 19].includes(response[ipv4 + 1])) return false;
      offset += length;
    }
    return offset === response.length;
  } catch { return false; }
}

// Bootstrap resolver IPs only; edge addresses still come from live SRV/A/AAAA DNS.
// HTTPS validates the provider certificate and works through DNS-intercepting routers.
export async function httpsDnsQuery(query, { address, signal, timeoutMs = 2500 } = {}) {
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const providers = [
    { hostname: "dns.alidns.com", ip: "223.5.5.5" },
    { hostname: "cloudflare-dns.com", ip: "1.1.1.1" },
    { hostname: "dns.google", ip: "8.8.8.8" },
  ];
  const sources = address ? [address, undefined] : [undefined];
  const agents = [];
  function requestProvider(provider, localAddress, proxy) { return new Promise((resolveResult, reject) => {
    let agent = false;
    if (proxy) {
      agent = new Agent({ keepAlive: false });
      agents.push(agent);
      agent.createConnection = (_options, callback) => {
        void connectThroughProxy(`${provider.hostname}:443`, proxy, { signal: requestSignal, timeoutMs }).then(socket => {
          const secure = tlsConnect({ socket, servername: provider.hostname, rejectUnauthorized: true });
          let completed = false;
          const finish = error => {
            if (completed) return;
            completed = true;
            callback(error, error ? undefined : secure);
          };
          const abort = () => secure.destroy(new Error("DNS HTTPS aborted"));
          requestSignal.addEventListener("abort", abort, { once: true });
          secure.once("close", () => requestSignal.removeEventListener("abort", abort));
          secure.once("secureConnect", () => finish(null));
          secure.on("error", finish);
          if (requestSignal.aborted) abort();
          secure.resume();
        }).catch(callback);
      };
    }
    const req = httpsRequest({
      hostname: provider.hostname, path: "/dns-query", method: "POST", agent,
      localAddress, signal: requestSignal,
      lookup: (_hostname, _options, callback) => callback(null, provider.ip, 4),
      headers: { accept: "application/dns-message", "content-type": "application/dns-message", "content-length": query.length },
    }, res => {
      if (res.statusCode !== 200 || !res.headers["content-type"]?.startsWith("application/dns-message")) {
        res.resume(); reject(new Error("DNS HTTPS response unavailable")); return;
      }
      const chunks = [];
      let bytes = 0;
      res.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > 4096) req.destroy(new Error("DNS HTTPS response too large"));
        else chunks.push(chunk);
      });
      res.once("error", reject);
      res.once("end", () => {
        const response = Buffer.concat(chunks);
        if (safeDnsResponse(query, response)) resolveResult(response);
        else reject(new Error("Unsafe DNS HTTPS response"));
      });
    });
    const timer = setTimeout(() => req.destroy(new Error("DNS HTTPS timeout")), timeoutMs);
    req.once("close", () => clearTimeout(timer));
    req.once("error", reject);
    req.end(query);
  }); }
  const requests = sources.flatMap(localAddress => providers.map(provider => requestProvider(provider, localAddress)));
  requests.push(findLoopbackProxy().then(async proxy => {
    if (!proxy || requestSignal.aborted) throw new Error("No local proxy");
    return Promise.any(providers.map(provider => requestProvider(provider, undefined, proxy)));
  }));
  try { return await Promise.any(requests); }
  catch { return null; }
  finally { controller.abort(); for (const agent of agents) agent.destroy(); }
}

export async function discoverTunnelEdges(relay, { resolver = new Resolver({ timeout: 5000, tries: 1 }) } = {}) {
  resolver.setServers([relay.resolverAddress]);
  const records = await resolver.resolveSrv("_v2-origintunneld._tcp.argotunnel.com");
  if (!records.length || records.some(record => record.port !== 7844 || !/^[a-z0-9.-]+\.argotunnel\.com\.?$/i.test(record.name))) {
    throw new Error("Cloudflare 隧道服务发现结果无效。");
  }
  const groups = await Promise.all(records.sort((a, b) => a.priority - b.priority).map(async record => {
    const addresses = await resolver.resolve4(record.name);
    if (!addresses.length || addresses.some(ip => {
      if (!isIPv4(ip)) return true;
      const [first, second] = ip.split(".").map(Number);
      return first === 0 || first === 10 || first === 127 || first >= 224
        || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168) || (first === 198 && [18, 19].includes(second));
    })) throw new Error("隧道 DNS 返回虚拟或私有地址，等待安全解析恢复。");
    return addresses.map(ip => `${ip}:${record.port}`);
  }));
  return [...new Set(groups.flat())];
}

// Bind only this project's connector and DNS traffic to a physical interface.
// Windows strong-host routing then leaves an unrelated VPN/TUN configuration alone.
export async function physicalWindowsNetwork() {
  if (process.platform !== "win32") return null;
  const command = `
    $ErrorActionPreference = 'Stop'
    $profiles = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
      $adapter = $_
      $route = Get-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
      $interface = Get-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
      $address = Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1
      $dns = Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
      if ($route -and $address -and $dns.ServerAddresses) {
        [pscustomobject]@{ name=$adapter.Name; interfaceIndex=$adapter.ifIndex; address=$address.IPAddress; resolvers=@($dns.ServerAddresses); metric=([int]$route.RouteMetric + [int]$interface.InterfaceMetric) }
      }
    }
    $profiles | Sort-Object metric | Select-Object -First 1 | ConvertTo-Json -Compress
  `;
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 10000, maxBuffer: 65536 });
  if (!stdout.trim()) throw new Error("没有找到可联网的物理 IPv4 网卡和 DNS，请检查有线或无线网络。");
  const profile = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
  if (!isIPv4(profile.address) || !Array.isArray(profile.resolvers)) throw new Error("物理网卡的 IPv4/DNS 配置无效。");
  profile.resolvers = profile.resolvers.filter(address => isIPv4(address) && !address.startsWith("127.") && !/^198\.(18|19)\./.test(address));
  if (!profile.resolvers.length) throw new Error("物理网卡没有可用的 DNS 地址，请检查网络配置。");
  return profile;
}

// cloudflared's custom DNS flag does not bind upstream DNS to edge-bind-address.
// A loopback-only relay preserves normal SRV/A/AAAA/TXT discovery without fake IPs,
// hosts-file changes, fixed Cloudflare IPs, or disabled certificate verification.
export async function tunnelDnsRelay({ address, resolvers }, { timeoutMs = 2000, resolverPort = 53, resolveHttps = httpsDnsQuery } = {}) {
  if (!isIPv4(address) || !resolvers.length || resolvers.some(resolver => !isIPv4(resolver))) throw new Error("隧道 DNS 配置无效。");
  const server = createSocket("udp4");
  const pending = new Set();
  let closed = false;
  let requests = 0;
  const controller = new AbortController();

  function close() {
    if (closed) return;
    closed = true;
    controller.abort();
    for (const cancel of pending) cancel();
    closeSocket(server);
  }

  function queryResolver(query, resolver) {
    return new Promise(resolveResult => {
      const upstream = createSocket("udp4");
      let finished = false;
      const finish = response => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        pending.delete(cancel);
        closeSocket(upstream);
        resolveResult(response);
      };
      const cancel = () => finish(null);
      const timer = setTimeout(cancel, timeoutMs);
      pending.add(cancel);
      upstream.once("error", cancel);
      upstream.on("message", response => {
        if (safeDnsResponse(query, response)) finish(response);
      });
      upstream.bind(0, address, () => {
        if (finished) return;
        upstream.connect(resolverPort, resolver, () => {
          if (!finished) upstream.send(query, error => { if (error) cancel(); });
        });
      });
    });
  }

  server.on("message", (query, peer) => {
    if (closed || peer.address !== "127.0.0.1" || requests >= 32 || query.length < 12 || query.length > 4096 || (query[2] & 0x80)) return;
    requests += 1;
    void (async () => {
      try {
        let response = await resolveHttps(query, { address, signal: controller.signal }).catch(() => null);
        if (response && !safeDnsResponse(query, response)) response = null;
        for (const resolver of response ? [] : resolvers) {
          if (closed) return;
          response = await queryResolver(query, resolver);
          if (response) break;
        }
        if (closed) return;
        if (!response) {
          response = Buffer.from(query);
          response[2] |= 0x80;
          response[3] = (response[3] & 0xf0) | 2; // SERVFAIL after all resolvers fail.
          response.fill(0, 6, 12);
        }
        server.send(response, peer.port, peer.address, () => {});
      } finally {
        requests -= 1;
      }
    })();
  });
  await new Promise((resolveResult, reject) => {
    server.once("error", reject);
    server.bind(0, "127.0.0.1", resolveResult);
  }).catch(error => { close(); throw error; });
  server.removeAllListeners("error");
  server.on("error", error => { console.error(`隧道专用 DNS 转发失败：${error.message}`); close(); });
  return { resolverAddress: `127.0.0.1:${server.address().port}`, close };
}
