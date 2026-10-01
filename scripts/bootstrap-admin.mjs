import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const varsPath = resolve(root, ".dev.vars");
let source = await readFile(varsPath, "utf8").catch(() => "");
function values(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const split = line.indexOf("=");
    return [line.slice(0, split), line.slice(split + 1).replace(/^["']|["']$/g, "")];
  }));
}
if (process.argv.includes("--prepare")) {
  const existing = values(source);
  for (const name of ["BETTER_AUTH_SECRET", "BOOTSTRAP_SECRET"]) {
    if (!existing[name]) source += `\n${name}=${randomBytes(32).toString("hex")}`;
  }
  if (!existing.APP_ORIGIN) source += "\nAPP_ORIGIN=http://localhost:3000";
  await writeFile(varsPath, `${source.trim()}\n`, { mode: 0o600 });
  console.log("本地随机秘密已准备，保存在被 Git 忽略的 .dev.vars；未输出秘密。启动服务后再次运行本脚本初始化管理员。");
  process.exit(0);
}
const env = values(source);
if (!env.BOOTSTRAP_SECRET) throw new Error("请先运行 node scripts/bootstrap-admin.mjs --prepare");
const urlIndex = process.argv.indexOf("--url");
const origin = new URL(urlIndex >= 0 ? process.argv[urlIndex + 1] : env.APP_ORIGIN || "http://localhost:3000").origin;
const localDir = resolve(root, ".local");
const credentialsPath = resolve(localDir, "admin-access.json");
await mkdir(localDir, { recursive: true });
let credentials = JSON.parse(await readFile(credentialsPath, "utf8").catch(() => "null"));
if (!credentials) {
  credentials = { username: "admin", name: "管理员", password: randomBytes(24).toString("base64url"), origin, loginUrl: `${origin}/login`, status: "pending", createdAt: new Date().toISOString() };
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
}
const response = await fetch(`${origin}/api/bootstrap`, {
  method: "POST", headers: { "content-type": "application/json", origin, "x-bootstrap-secret": env.BOOTSTRAP_SECRET },
  body: JSON.stringify({ username: credentials.username, password: credentials.password, name: credentials.name }),
});
const result = await response.json();
if (!response.ok && result.code !== "ALREADY_INITIALIZED") throw new Error(`管理员初始化失败：${result.error || response.status}`);
const login = await fetch(`${origin}/api/auth/sign-in/username`, {
  method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ username: credentials.username, password: credentials.password }),
});
if (!login.ok) throw new Error("管理员已存在，但本地凭据未通过登录验证；未更改已有账号。");
const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const session = await fetch(`${origin}/api/session`, { headers: { cookie } }).then(r => r.json());
if (session.user?.role !== "admin") throw new Error("管理员会话验证失败");
await fetch(`${origin}/api/auth/sign-out`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}" });
credentials.status = "verified";
credentials.verifiedAt = new Date().toISOString();
await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
console.log(`管理员创建与登录已验证。凭据仅保存在 ${credentialsPath}；未输出密码。`);
