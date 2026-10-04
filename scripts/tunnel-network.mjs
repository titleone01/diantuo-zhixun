import { execFile } from "node:child_process";
import { createSocket } from "node:dgram";
import { isIPv4 } from "node:net";
import { promisify } from "node:util";

const execute = promisify(execFile);

function closeSocket(socket) {
  try { socket.close(); } catch (error) {
    if (error.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") throw error;
  }
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
        [pscustomobject]@{ name=$adapter.Name; address=$address.IPAddress; resolvers=@($dns.ServerAddresses); metric=([int]$route.RouteMetric + [int]$interface.InterfaceMetric) }
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
export async function tunnelDnsRelay({ address, resolvers }, { timeoutMs = 2000, resolverPort = 53 } = {}) {
  if (!isIPv4(address) || !resolvers.length || resolvers.some(resolver => !isIPv4(resolver))) throw new Error("隧道 DNS 配置无效。");
  const server = createSocket("udp4");
  const pending = new Set();
  let closed = false;
  let requests = 0;

  function close() {
    if (closed) return;
    closed = true;
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
        if (response.length >= 12 && response.readUInt16BE(0) === query.readUInt16BE(0) && (response[2] & 0x80)) finish(response);
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
        let response;
        for (const resolver of resolvers) {
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
