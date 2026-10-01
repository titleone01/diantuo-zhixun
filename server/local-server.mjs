import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync, readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scrypt = promisify(scryptCallback);
const SESSION_MS = 12 * 60 * 60 * 1000;
const FORM_MS = 20 * 60 * 1000;
const MAX_DRAWING = 12 * 1024 * 1024;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = () => randomBytes(32).toString("hex");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const loopbackAddress = (value) => value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
const loopbackHost = (value) => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(value.toLowerCase());
const publicUser = (user) => ({ id: user.id, username: user.username, role: user.role });
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((item) => item.trim().split("=")).filter(([name, value]) => name && value));
const secureRequest = (req) => Boolean(req.socket.encrypted);
const cookie = (req, name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secureRequest(req) ? "; Secure" : ""}`;
const constantEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".pdf": "application/pdf" };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readBody(req, maxBytes = 16 * 1024) {
  if (Number(req.headers["content-length"]) > maxBytes) {
    req.resume();
    throw new HttpError(413, "文件或请求超过大小限制");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "文件或请求超过大小限制");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readFields(req) {
  const raw = (await readBody(req)).toString("utf8");
  if ((req.headers["content-type"] || "").startsWith("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  if (!(req.headers["content-type"] || "").startsWith("application/json")) throw new HttpError(415, "请使用 JSON 请求");
  try {
    const result = JSON.parse(raw);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new HttpError(400, "请求格式不正确"); }
}

function accountFields(body) {
  const username = typeof body.username === "string" ? body.username.normalize("NFKC").trim().toLowerCase() : "";
  if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) throw new HttpError(400, "账号需为 3–32 个字母、汉字、数字、下划线、点或短横线");
  if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 256) throw new HttpError(400, "密码需为 10–256 个字符");
  return { username, password: body.password };
}

function drawingType(data, suppliedType) {
  const type = (suppliedType || "").split(";")[0].trim().toLowerCase();
  const matches = type === "application/pdf" ? data.subarray(0, 5).equals(Buffer.from("%PDF-"))
    : type === "image/png" ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : type === "image/jpeg" ? data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255 : false;
  if (!matches) throw new HttpError(415, "只接受文件内容与类型一致的 PDF、PNG 或 JPEG 图纸");
  return type;
}

export function createLocalServer({ dataDir = path.join(ROOT, ".local-training"), staticDir = path.join(ROOT, "pages-dist"), host = "127.0.0.1" } = {}) {
  const projects = JSON.parse(readFileSync(path.join(ROOT, "shared/training-projects.json"), "utf8"));
  if (!Array.isArray(projects) || projects.length !== 10 || projects.some((item, index) => item.id !== `project-${String(index + 1).padStart(2, "0")}` || typeof item.name !== "string" || !["dol", "pending"].includes(item.simulation))) throw new Error("训练项目目录无效");
  const staticRoot = path.resolve(staticDir);
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "training.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','student')), disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS drawings (project_id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, updated_at TEXT NOT NULL, content BLOB NOT NULL);`);
  const hasAdmin = () => Boolean(db.prepare("SELECT id FROM users WHERE role='admin' AND disabled=0 LIMIT 1").get());
  if (!hasAdmin() && !loopbackHost(host)) { db.close(); throw new Error("尚未设置管理员。请先以 HOST=127.0.0.1 启动并在本机 /login 创建管理员，再开放局域网。"); }
  const challenges = new Map();
  const loginAttempts = new Map();

  const json = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); };
  const redirect = (res, location) => { res.writeHead(303, { Location: location }); res.end(); };
  const authenticate = (req) => {
    const session = cookies(req).dt_session;
    if (!session || !/^[a-f0-9]{64}$/.test(session)) return null;
    return db.prepare("SELECT users.id, users.username, users.role, sessions.csrf_token, sessions.token_hash FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.disabled=0").get(digest(session), Date.now()) || null;
  };
  const sameOrigin = (req) => {
    const expected = `${secureRequest(req) ? "https" : "http"}://${req.headers.host}`;
    if (req.headers.origin !== expected || req.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "请求来源不匹配，请从本站页面操作");
  };
  const requireCsrf = (req, user) => {
    sameOrigin(req);
    if (!constantEqual(req.headers["x-csrf-token"], user.csrf_token)) throw new HttpError(403, "操作校验已失效，请刷新页面后重试");
  };
  const requireAdmin = (user) => { if (user.role !== "admin") throw new HttpError(403, "仅管理员可以执行此操作"); };
  const beginSession = (req, res, user) => {
    const value = token();
    const csrfToken = token();
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
    db.prepare("INSERT INTO sessions (token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)").run(digest(value), user.id, csrfToken, Date.now() + SESSION_MS);
    res.setHeader("Set-Cookie", [cookie(req, "dt_session", value, SESSION_MS / 1000), cookie(req, "dt_login", "", 0)]);
    return csrfToken;
  };
  const renderLogin = (req, res, { error = "", status = 200 } = {}) => {
    for (const [key, value] of challenges) if (value.expiresAt < Date.now()) challenges.delete(key);
    if (challenges.size >= 2048) challenges.delete(challenges.keys().next().value);
    const challengeId = token();
    const csrf = token();
    challenges.set(challengeId, { csrf, expiresAt: Date.now() + FORM_MS });
    res.setHeader("Set-Cookie", cookie(req, "dt_login", challengeId, FORM_MS / 1000));
    const setup = !hasAdmin();
    const title = setup ? "设置管理员" : "登录电拓智训";
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · 电拓智训</title><style>body{margin:0;background:#eef3f6;color:#1f3445;font:16px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}main{width:min(380px,calc(100% - 64px));background:white;padding:32px;border-radius:16px;box-shadow:0 12px 50px #16344815}h1{font-size:24px}p{line-height:1.6;color:#627381}label{display:grid;gap:8px;margin:20px 0}input,button{font:inherit;padding:12px;border:1px solid #b9c7d0;border-radius:7px;box-sizing:border-box;width:100%}button{background:#176989;color:white;border:0;cursor:pointer}.error{color:#ad2f21}</style></head><body><main><h1>${title}</h1><p>${setup ? "首次使用请在服务器本机设置管理员。账号用于创建学员和上传图纸。" : "使用管理员或学员账号进入训练项目。"}</p>${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}<form method="post" action="/api/${setup ? "setup" : "login"}"><input type="hidden" name="_csrf" value="${csrf}"><label>账号<input name="username" autocomplete="username" required minlength="3" maxlength="32"></label><label>密码<input name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}" required minlength="10" maxlength="256"></label><button type="submit">${setup ? "创建管理员并进入" : "登录"}</button></form><p>账号区分权限；密码至少 10 个字符。</p></main></body></html>`);
  };

  const handle = async (req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    let requestUrl;
    try { requestUrl = new URL(req.url, `${secureRequest(req) ? "https" : "http"}://${req.headers.host}`); } catch { throw new HttpError(400, "请求地址无效"); }
    const route = requestUrl.pathname;
    const method = req.method;
    const user = authenticate(req);
    if (route === "/login" && method === "GET") { if (user) return redirect(res, "/"); return renderLogin(req, res); }

    if ((route === "/api/login" || route === "/api/setup") && method === "POST") {
      sameOrigin(req);
      const body = await readFields(req);
      const challengeId = cookies(req).dt_login;
      const challenge = challenges.get(challengeId);
      if (!challenge || challenge.expiresAt < Date.now() || !constantEqual(body._csrf || req.headers["x-csrf-token"], challenge.csrf)) throw new HttpError(403, "登录页面校验已失效，请重新打开 /login");
      challenges.delete(challengeId);
      const isForm = (req.headers["content-type"] || "").startsWith("application/x-www-form-urlencoded");
      try {
        if (route === "/api/setup") {
          if (!loopbackAddress(req.socket.remoteAddress) || !loopbackHost(requestUrl.hostname)) throw new HttpError(403, "首次设置仅允许服务器本机 localhost 或 127.0.0.1 访问");
          if (hasAdmin()) throw new HttpError(409, "管理员已经设置，请登录");
          const account = accountFields(body);
          const salt = randomBytes(16).toString("hex");
          const hash = (await scrypt(account.password, salt, 64)).toString("hex");
          // No await between the second check and insert: concurrent bootstrap
          // requests cannot create a second administrator on this server.
          if (hasAdmin()) throw new HttpError(409, "管理员已经设置，请登录");
          const result = db.prepare("INSERT INTO users (username,password_salt,password_hash,role) VALUES (?,?,?,'admin')").run(account.username, salt, hash);
          const created = { id: Number(result.lastInsertRowid), username: account.username, role: "admin" };
          const csrfToken = beginSession(req, res, created);
          return isForm ? redirect(res, "/") : json(res, 201, { user: publicUser(created), csrfToken });
        }
        const username = typeof body.username === "string" ? body.username.normalize("NFKC").trim().toLowerCase() : "";
        const attemptKey = `${req.socket.remoteAddress}:${username}`;
        const previous = loginAttempts.get(attemptKey);
        const now = Date.now();
        const activeAttempts = previous && previous.until > now ? previous : { count: 0, until: now + 15 * 60 * 1000 };
        if (activeAttempts.count >= 10) throw new HttpError(429, "尝试次数过多，请 15 分钟后重试");
        // Reserve before hashing: parallel attempts must not all read and later
        // overwrite the same old failure count while awaiting scrypt.
        if (loginAttempts.size >= 5000 && !loginAttempts.has(attemptKey)) loginAttempts.delete(loginAttempts.keys().next().value);
        loginAttempts.set(attemptKey, { count: activeAttempts.count + 1, until: activeAttempts.until });
        const found = db.prepare("SELECT * FROM users WHERE username=?").get(username);
        const password = typeof body.password === "string" && body.password.length <= 256 ? body.password : "";
        const hash = (await scrypt(password, found?.password_salt || "unregistered-user-salt", 64)).toString("hex");
        if (!found || found.disabled || !constantEqual(hash, found.password_hash)) {
          throw new HttpError(401, "账号或密码不正确，或账号已停用");
        }
        // Account access may have been revoked while the password hash ran.
        const activeUser = db.prepare("SELECT id,username,role FROM users WHERE id=? AND disabled=0").get(found.id);
        if (!activeUser) throw new HttpError(401, "账号或密码不正确，或账号已停用");
        loginAttempts.delete(attemptKey);
        const csrfToken = beginSession(req, res, activeUser);
        return isForm ? redirect(res, "/") : json(res, 200, { user: publicUser(activeUser), csrfToken });
      } catch (error) {
        if (isForm && error instanceof HttpError) return renderLogin(req, res, { status: error.status, error: error.message });
        throw error;
      }
    }

    // Authentication precedes ALL application routes, static assets and drawing
    // bytes. A client-side role label is never treated as authorization.
    if (!user) { if (route.startsWith("/api/")) return json(res, 401, { error: "请先登录" }); return redirect(res, "/login"); }
    if (!["GET", "HEAD"].includes(method)) requireCsrf(req, user);
    if (route === "/api/session" && method === "GET") return json(res, 200, { user: publicUser(user), csrfToken: user.csrf_token });
    if (route === "/api/logout" && method === "POST") {
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(user.token_hash);
      res.setHeader("Set-Cookie", cookie(req, "dt_session", "", 0));
      return json(res, 200, { ok: true });
    }
    if (route === "/api/projects" && method === "GET") {
      const rows = db.prepare("SELECT project_id, name, mime, size, updated_at FROM drawings").all();
      return json(res, 200, { projects: projects.map((project) => {
        const drawing = rows.find((row) => row.project_id === project.id);
        return { ...project, drawing: drawing ? { name: drawing.name, mime: drawing.mime, size: drawing.size, updatedAt: drawing.updated_at } : null };
      }) });
    }
    const drawingMatch = route.match(/^\/api\/projects\/([^/]+)\/drawing$/);
    if (drawingMatch) {
      const id = drawingMatch[1];
      if (!projects.some((item) => item.id === id)) throw new HttpError(404, "训练项目不存在");
      if (method === "GET" || method === "HEAD") {
        const drawing = db.prepare("SELECT * FROM drawings WHERE project_id=?").get(id);
        if (!drawing) throw new HttpError(404, "尚未上传图纸");
        res.writeHead(200, { "Content-Type": drawing.mime, "Content-Length": drawing.size, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(drawing.name)}` });
        return res.end(method === "HEAD" ? undefined : Buffer.from(drawing.content));
      }
      if (method === "PUT") {
        requireAdmin(user);
        let name;
        try { name = decodeURIComponent(req.headers["x-file-name"] || ""); } catch { throw new HttpError(400, "文件名编码无效"); }
        if (!name || name.length > 180 || [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "/" || character === "\\")) throw new HttpError(400, "文件名无效");
        const bytes = await readBody(req, MAX_DRAWING);
        const mime = drawingType(bytes, req.headers["content-type"]);
        const updatedAt = new Date().toISOString();
        db.prepare("INSERT INTO drawings (project_id,name,mime,size,updated_at,content) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET name=excluded.name,mime=excluded.mime,size=excluded.size,updated_at=excluded.updated_at,content=excluded.content").run(id, name, mime, bytes.length, updatedAt, bytes);
        return json(res, 200, { drawing: { name, mime, size: bytes.length, updatedAt } });
      }
      throw new HttpError(405, "不支持此请求方式");
    }
    if (route === "/api/accounts") {
      requireAdmin(user);
      if (method === "GET") return json(res, 200, { accounts: db.prepare("SELECT id,username,role,disabled FROM users ORDER BY id").all().map((account) => ({ ...account, disabled: Boolean(account.disabled) })) });
      if (method === "POST") {
        const body = await readFields(req);
        if (body.role !== undefined) throw new HttpError(400, "此接口仅创建学员账号，不接受自定义角色");
        const account = accountFields(body);
        const salt = randomBytes(16).toString("hex");
        const hash = (await scrypt(account.password, salt, 64)).toString("hex");
        let result;
        try { result = db.prepare("INSERT INTO users (username,password_salt,password_hash,role) VALUES (?,?,?,'student')").run(account.username, salt, hash); }
        catch (error) { if (error.code === "ERR_SQLITE_ERROR" && error.message.includes("UNIQUE")) throw new HttpError(409, "账号已存在"); throw error; }
        return json(res, 201, { account: { id: Number(result.lastInsertRowid), username: account.username, role: "student", disabled: false } });
      }
      throw new HttpError(405, "不支持此请求方式");
    }
    const accountMatch = route.match(/^\/api\/accounts\/(\d+)$/);
    if (accountMatch && method === "PATCH") {
      requireAdmin(user);
      const body = await readFields(req);
      if (typeof body.disabled !== "boolean" || Object.keys(body).some((key) => key !== "disabled")) throw new HttpError(400, "只能修改学员的停用状态");
      const target = db.prepare("SELECT id,username,role FROM users WHERE id=?").get(Number(accountMatch[1]));
      if (!target) throw new HttpError(404, "账号不存在");
      if (target.role !== "student") throw new HttpError(403, "不能通过学员管理停用管理员");
      db.prepare("UPDATE users SET disabled=? WHERE id=?").run(Number(body.disabled), target.id);
      if (body.disabled) db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
      return json(res, 200, { account: { ...target, disabled: body.disabled } });
    }
    if (route.startsWith("/api/")) throw new HttpError(404, "接口不存在");
    if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "不支持此请求方式");
    let decoded;
    try { decoded = decodeURIComponent(route); } catch { throw new HttpError(400, "请求路径无效"); }
    if (decoded.includes("\\") || decoded.includes("\0") || decoded.split("/").some((part) => part.startsWith("."))) throw new HttpError(404, "文件不存在");
    const filePath = path.resolve(staticRoot, `.${decoded === "/" ? "/index.html" : decoded}`);
    if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${path.sep}`)) throw new HttpError(404, "文件不存在");
    try {
      const resolvedRoot = await realpath(staticRoot);
      const resolvedFile = await realpath(filePath);
      if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`) || !(await stat(resolvedFile)).isFile()) throw new HttpError(404, "文件不存在");
      const bytes = await readFile(resolvedFile);
      res.writeHead(200, { "Content-Type": mimeTypes[path.extname(resolvedFile).toLowerCase()] || "application/octet-stream", "Content-Length": bytes.length });
      return res.end(method === "HEAD" ? undefined : bytes);
    } catch (error) { if (["ENOENT", "ENOTDIR"].includes(error.code)) throw new HttpError(404, "文件不存在"); throw error; }
  };

  const server = http.createServer((req, res) => { handle(req, res).catch((error) => {
    if (res.headersSent) return res.destroy();
    if (!(error instanceof HttpError)) console.error("本地训练服务器请求失败：", error.message);
    json(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : "服务器暂时无法完成请求" });
  }); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.on("close", () => db.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3000);
  try {
    const server = createLocalServer({ host, dataDir: process.env.DATA_DIR || path.join(ROOT, ".local-training"), staticDir: process.env.STATIC_DIR || path.join(ROOT, "pages-dist") });
    server.on("error", (error) => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
    server.listen(port, host, () => console.log(`电拓智训服务已启动：http://${host}:${port}/login`));
  } catch (error) { console.error(`启动失败：${error.message}`); process.exitCode = 1; }
}
