import { hashPassword, constantTimeEqual } from "better-auth/crypto";
import type { AppEnv } from "./auth";
import { ApiError, bodyJson, digest, json, textField } from "./http";

export async function throttle(env: AppEnv, request: Request, scope: string, limit = 30): Promise<void> {
  const now = Date.now();
  const key = `${scope}:${request.headers.get("cf-connecting-ip") || "local"}:${Math.floor(now / 60000)}`;
  const result = await env.DB.prepare("INSERT INTO rate_limits(key,count,expiresAt) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count")
    .bind(key, now + 120000).first<{ count: number }>();
  if ((result?.count || 0) > limit) throw new ApiError(429, "RATE_LIMITED", "操作过于频繁，请稍后再试");
  await env.DB.prepare("DELETE FROM rate_limits WHERE expiresAt<?").bind(now).run();
}

export async function register(env: AppEnv, request: Request, bootstrap: boolean): Promise<Response> {
  await throttle(env, request, bootstrap ? "bootstrap" : "invite-accept");
  const body = await bodyJson(request);
  const username = textField(body.username, "账号", 3, 30).toLowerCase();
  if (!/^[a-z0-9_.]+$/.test(username)) throw new ApiError(400, "INVALID_USERNAME", "账号只能包含英文字母、数字、下划线和点");
  const name = textField(body.name, "昵称", 1, 40);
  const password = body.password;
  if (typeof password !== "string" || password.length < 12 || password.length > 128) throw new ApiError(400, "INVALID_PASSWORD", "密码长度需为 12–128 个字符");
  const token = typeof body.token === "string" ? body.token : "";
  if (bootstrap) {
    const supplied = request.headers.get("x-bootstrap-secret") || "";
    if (!env.BOOTSTRAP_SECRET || !constantTimeEqual(await digest(supplied), await digest(env.BOOTSTRAP_SECRET))) throw new ApiError(403, "BOOTSTRAP_DENIED", "初始化凭据无效");
  } else if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(400, "INVALID_INVITE", "邀请无效或已使用");
  const tokenHash = await digest(token);
  const now = Date.now();
  if (!bootstrap) {
    const invite = await env.DB.prepare("SELECT id FROM invitations WHERE tokenHash=? AND consumedBy IS NULL AND expiresAt>?").bind(tokenHash, now).first();
    if (!invite) throw new ApiError(410, "INVALID_INVITE", "邀请已失效或已使用");
  }
  const id = crypto.randomUUID();
  const hashed = await hashPassword(password);
  const condition = bootstrap ? "NOT EXISTS(SELECT 1 FROM user)" : "EXISTS(SELECT 1 FROM invitations WHERE tokenHash=? AND consumedBy IS NULL AND expiresAt>?)";
  const values = [id, name, `${username}@members.diantuo.invalid`, now, now, username, username, bootstrap ? "admin" : "member"];
  const insert = env.DB.prepare(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username,displayUsername,role) SELECT ?,?,?,0,?,?,?,?,? WHERE ${condition}`)
    .bind(...values, ...(bootstrap ? [] : [tokenHash, now]));
  const statements = [insert, env.DB.prepare("INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) SELECT ?,?,'credential',?,?,?,? WHERE EXISTS(SELECT 1 FROM user WHERE id=?)")
    .bind(crypto.randomUUID(), id, id, hashed, now, now, id)];
  if (!bootstrap) statements.push(env.DB.prepare("UPDATE invitations SET consumedBy=?,consumedAt=? WHERE tokenHash=? AND consumedBy IS NULL AND expiresAt>? AND EXISTS(SELECT 1 FROM user WHERE id=?)").bind(id, now, tokenHash, now, id));
  try {
    const results = await env.DB.batch(statements);
    if (!results[0].meta.changes) throw new ApiError(409, bootstrap ? "ALREADY_INITIALIZED" : "INVITE_USED", bootstrap ? "管理员已初始化" : "邀请已被使用");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (String(error).includes("UNIQUE")) throw new ApiError(409, "USERNAME_TAKEN", "此账号已存在");
    throw error;
  }
  return json({ user: { id, name, username, role: bootstrap ? "admin" : "member" } }, 201);
}
