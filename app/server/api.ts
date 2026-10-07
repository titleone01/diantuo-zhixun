import { createAuth, readMember, type AppEnv, type Member } from "./auth";
import { listPublications } from "./publication-list";
import { listCircuits } from "./circuit-list";
import { ApiError, assertOrigin, bodyJson, digest, json, randomToken, readBody, textField } from "./http";
import { allowedMedia, assertReferenceMedia, getCircuit, getPublication, revisionOf, saveCircuit, validatedDocument } from "./content";
import { downloadMedia, uploadMedia } from "./media";
import { register, throttle } from "./registration";
import { assessLesson } from "../simulator/core/engine";
import { assessWiringWorkmanship } from "../simulator/core/wiring-workmanship";
import { documentMediaIds } from "../simulator/core/types";
import { listTrainingProjects, setTrainingDrawing } from "./training-projects";

function administrator(member: Member): void {
  if (member.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "此操作仅限管理员");
}

async function route(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method;
  assertOrigin(request);
  if (path === "/api/bootstrap" && method === "POST") return register(env, request, true);
  if (path === "/api/invites/accept" && method === "POST") return register(env, request, false);
  if (path === "/api/invites/preview" && method === "GET") {
    const token = url.searchParams.get("token") || "";
    if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError(410, "INVALID_INVITE", "邀请无效");
    const invite = await env.DB.prepare("SELECT id,expiresAt FROM invitations WHERE tokenHash=? AND consumedBy IS NULL AND expiresAt>?").bind(await digest(token), Date.now()).first();
    if (!invite) throw new ApiError(410, "INVALID_INVITE", "邀请已过期或已使用");
    return json({ invite });
  }
  if (path.startsWith("/api/auth/")) {
    const action = path.slice("/api/auth".length);
    if (action.startsWith("/sign-up")) throw new ApiError(403, "INVITE_REQUIRED", "注册需要管理员邀请");
    const allowed = method === "GET" ? ["/get-session"] : method === "POST" ? ["/sign-in/username", "/sign-in/email", "/sign-out", "/change-password"] : [];
    if (!allowed.includes(action)) throw new ApiError(404, "NOT_FOUND", "认证接口不存在");
    if (action === "/get-session" && !(await readMember(env, request))) return json(null);
    let forwarded = request;
    if (method === "POST") {
      await throttle(env, request, action.includes("sign-in") ? "login" : "auth", 60);
      const bytes = await readBody(request, 16384);
      if (action.includes("sign-in")) {
        let input: Record<string, unknown>;
        try {
          const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
          input = value as Record<string, unknown>;
        }
        catch { throw new ApiError(400, "INVALID_JSON", "JSON 格式无效"); }
        const identity = action.endsWith("username") ? input.username : input.email;
        if (typeof identity === "string") {
          const disabled = await env.DB.prepare(action.endsWith("username") ? "SELECT disabled FROM user WHERE username=?" : "SELECT disabled FROM user WHERE email=?").bind(identity.toLowerCase()).first<{ disabled: number }>();
          if (disabled?.disabled) throw new ApiError(401, "INVALID_CREDENTIALS", "账号或密码不正确");
        }
      }
      forwarded = new Request(request.url, { method, headers: request.headers, body: bytes });
    }
    const response = await createAuth(env, request).handler(forwarded);
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as Record<string, unknown>;
      const code = typeof failure.code === "string" ? failure.code : "AUTH_FAILED";
      return json({ error: action.includes("sign-in") ? "账号或密码不正确" : "认证操作失败，请重试", code }, response.status);
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const member = await readMember(env, request);
  if (path === "/api/session" && method === "GET") return json({ user: member });
  if (!member) throw new ApiError(401, "AUTH_REQUIRED", "请先登录");
  if (path === "/api/training-projects" && method === "GET") return listTrainingProjects(env);
  const trainingProjectId = path.match(/^\/api\/training-projects\/([^/]+)$/)?.[1];
  if (trainingProjectId && ["PUT", "DELETE"].includes(method)) return setTrainingDrawing(env, member, trainingProjectId, request);

  if (path === "/api/members" && method === "GET") {
    administrator(member);
    const rows = await env.DB.prepare("SELECT id,name,username,role,disabled,createdAt FROM user ORDER BY createdAt DESC LIMIT 200").all<{ id: string; name: string; username: string; role: string; disabled: number; createdAt: number }>();
    return json({ items: rows.results.map(row => ({ ...row, disabled: !!row.disabled })) });
  }
  const memberId = path.match(/^\/api\/members\/([^/]+)$/)?.[1];
  if (memberId && method === "PATCH") {
    administrator(member);
    const body = await bodyJson(request);
    if (typeof body.disabled !== "boolean") throw new ApiError(400, "INVALID_INPUT", "disabled 必须是布尔值");
    const target = await env.DB.prepare("SELECT id FROM user WHERE id=?").bind(memberId).first();
    if (!target) throw new ApiError(404, "NOT_FOUND", "成员不存在");
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE user SET disabled=?,updatedAt=? WHERE id=? AND (?=0 OR role<>'admin' OR EXISTS(SELECT 1 FROM user other WHERE other.id<>? AND other.role='admin' AND other.disabled=0))")
        .bind(body.disabled ? 1 : 0, Date.now(), memberId, body.disabled ? 1 : 0, memberId),
      env.DB.prepare("DELETE FROM session WHERE userId=? AND EXISTS(SELECT 1 FROM user WHERE id=? AND disabled=1)").bind(memberId, memberId),
    ]);
    if (!results[0].meta.changes) throw new ApiError(409, "LAST_ADMIN", "不能禁用最后一位管理员");
    return json({ ok: true });
  }

  if (path === "/api/invites") {
    administrator(member);
    if (method === "GET") {
      const rows = await env.DB.prepare("SELECT i.id,i.createdAt,i.expiresAt,i.consumedAt,u.username consumedBy FROM invitations i LEFT JOIN user u ON i.consumedBy=u.id ORDER BY i.createdAt DESC LIMIT 200").all();
      return json({ items: rows.results });
    }
    if (method === "POST") {
      const body = await bodyJson(request);
      const hours = body.expiresInHours === undefined ? 168 : Number(body.expiresInHours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 720) throw new ApiError(400, "INVALID_EXPIRY", "邀请有效期为 1–720 小时");
      const token = randomToken();
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const expiresAt = createdAt + hours * 3600000;
      await env.DB.prepare("INSERT INTO invitations(id,tokenHash,createdBy,createdAt,expiresAt) VALUES(?,?,?,?,?)").bind(id, await digest(token), member.id, createdAt, expiresAt).run();
      return json({ invite: { id, token, createdAt, expiresAt, url: `${url.origin}/invite?token=${token}` } }, 201);
    }
  }
  const inviteId = path.match(/^\/api\/invites\/([^/]+)$/)?.[1];
  if (inviteId && method === "DELETE") {
    administrator(member);
    await env.DB.prepare("UPDATE invitations SET expiresAt=? WHERE id=? AND consumedBy IS NULL").bind(Date.now(), inviteId).run();
    return json({ ok: true });
  }

  if (path === "/api/circuits") {
    if (method === "GET") return json(await listCircuits(env, member, url.searchParams));
    if (method === "POST") return json({ circuit: await saveCircuit(env, member, await bodyJson(request)) }, 201);
  }
  const circuitMatch = path.match(/^\/api\/circuits\/([^/]+)(\/publish)?$/);
  if (circuitMatch) {
    const id = circuitMatch[1];
    if (!circuitMatch[2]) {
      if (method === "GET") return json({ circuit: await getCircuit(env, member, id) });
      if (method === "PUT") return json({ circuit: await saveCircuit(env, member, await bodyJson(request), id) });
      if (method === "DELETE") {
        await getCircuit(env, member, id);
        const revision = revisionOf(await bodyJson(request));
        const result = await env.DB.prepare("DELETE FROM circuits WHERE id=? AND ownerId=? AND revision=?").bind(id, member.id, revision).run();
        if (!result.meta.changes) throw new ApiError(409, "REVISION_CONFLICT", "草稿已有更新，请刷新后重试");
        return json({ ok: true });
      }
    } else if (method === "POST") {
      const body = await bodyJson(request);
      const revision = revisionOf(body);
      const current = await getCircuit(env, member, id);
      if (revision !== current.revision) throw new ApiError(409, "REVISION_CONFLICT", "请先保存并载入最新版本再发布");
      const { document } = validatedDocument(current.document);
      assertReferenceMedia(document, current.mediaIds);
      const mediaIds = await allowedMedia(env, member, [...new Set([...current.mediaIds, ...documentMediaIds(document)])]);
      const description = body.description === undefined ? "" : textField(body.description, "说明", 0, 1000);
      const publicationId = crypto.randomUUID();
      const results = await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO publications(id,circuitId,ownerId,title,description,document,sourceRevision,createdAt) SELECT ?,id,ownerId,title,?,document,revision,? FROM circuits WHERE id=? AND ownerId=? AND revision=?")
          .bind(publicationId, description, Date.now(), id, member.id, revision),
        ...mediaIds.map(mediaId => env.DB.prepare("INSERT INTO publication_media(publicationId,mediaId) SELECT ?,? WHERE EXISTS(SELECT 1 FROM publications WHERE id=?)").bind(publicationId, mediaId, publicationId)),
      ]);
      if (!results[0].meta.changes) {
        const existing = await env.DB.prepare("SELECT id FROM publications WHERE circuitId=? AND sourceRevision=? AND ownerId=?").bind(id, revision, member.id).first<{ id: string }>();
        if (existing) return json({ publication: await getPublication(env, member, existing.id) });
        throw new ApiError(409, "REVISION_CONFLICT", "草稿已有更新，请刷新后重新发布");
      }
      return json({ publication: await getPublication(env, member, publicationId) }, 201);
    }
  }

  if (path === "/api/publications" && method === "GET") return json(await listPublications(env, member, url.searchParams));
  const publicationMatch = path.match(/^\/api\/publications\/([^/]+)(?:\/(fork|favorite|like))?$/);
  if (publicationMatch) {
    const id = publicationMatch[1];
    const action = publicationMatch[2];
    if (!action && method === "GET") return json({ publication: await getPublication(env, member, id) });
    if (action === "fork" && method === "POST") {
      const publication = await getPublication(env, member, id);
      const circuit = await saveCircuit(env, member, { title: `${publication.title.slice(0, 90)}（副本）`, document: publication.document, mediaIds: publication.mediaIds });
      await env.DB.prepare("UPDATE circuits SET forkedFrom=? WHERE id=? AND ownerId=?").bind(id, circuit.id, member.id).run();
      return json({ circuit: { ...circuit, forkedFrom: id } }, 201);
    }
    if (["favorite", "like"].includes(action) && ["POST", "DELETE"].includes(method)) {
      await getPublication(env, member, id);
      let active = method !== "DELETE";
      if (method === "POST") {
        const body = await bodyJson(request);
        if (body.active !== undefined && typeof body.active !== "boolean") throw new ApiError(400, "INVALID_INPUT", "active 必须是布尔值");
        active = body.active !== false;
      }
      if (active) await env.DB.prepare("INSERT OR IGNORE INTO reactions(userId,publicationId,kind,createdAt) VALUES(?,?,?,?)").bind(member.id, id, action, Date.now()).run();
      else await env.DB.prepare("DELETE FROM reactions WHERE userId=? AND publicationId=? AND kind=?").bind(member.id, id, action).run();
      return json({ publication: await getPublication(env, member, id) });
    }
  }

  if (path === "/api/me") {
    if (method === "PATCH") {
      const body = await bodyJson(request);
      const name = body.name === undefined ? member.name : textField(body.name, "昵称", 1, 40);
      const bio = body.bio === undefined ? member.bio : textField(body.bio, "简介", 0, 500);
      await env.DB.prepare("UPDATE user SET name=?,bio=?,updatedAt=? WHERE id=?").bind(name, bio, Date.now(), member.id).run();
      return json({ user: { ...member, name, bio } });
    }
    if (method === "GET") {
      const stats = await env.DB.prepare("SELECT (SELECT count(*) FROM circuits WHERE ownerId=?) circuits,(SELECT count(*) FROM publications WHERE ownerId=?) publications,(SELECT count(*) FROM reactions WHERE userId=? AND kind='like') likes,(SELECT count(*) FROM reactions WHERE userId=? AND kind='favorite') favorites")
        .bind(member.id, member.id, member.id, member.id).first();
      const rows = await env.DB.prepare("SELECT id,lessonId,documentHash,result,createdAt FROM assessments WHERE userId=? ORDER BY createdAt DESC LIMIT 30").bind(member.id).all<{ id: string; lessonId: string; documentHash: string; result: string; createdAt: number }>();
      return json({ user: member, stats, assessments: rows.results.map(row => ({ ...row, result: JSON.parse(row.result) as unknown })) });
    }
  }
  if (path === "/api/assess" && method === "POST") {
    await throttle(env, request, `assess:${member.id}`, 30);
    const body = await bodyJson(request);
    const { document, serialized } = validatedDocument(body.document);
    const lessonId = body.lessonId === undefined ? undefined : textField(body.lessonId, "训练类型", 1, 80);
    const assessment = assessLesson(document, lessonId);
    const workmanship = assessWiringWorkmanship(document, lessonId);
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const documentHash = await digest(serialized);
    await env.DB.prepare("INSERT INTO assessments(id,userId,lessonId,documentHash,result,createdAt) VALUES(?,?,?,?,?,?)").bind(id, member.id, lessonId || document.lessonId || "custom", documentHash, JSON.stringify(assessment), createdAt).run();
    return json({ assessment, workmanship, id, createdAt, documentHash });
  }
  if (path === "/api/media" && method === "POST") return uploadMedia(env, member, request);
  const mediaId = path.match(/^\/api\/media\/([^/]+)$/)?.[1];
  if (mediaId && method === "GET") return downloadMedia(env, member, mediaId, request);
  throw new ApiError(404, "NOT_FOUND", "接口不存在");
}

export async function handleApi(request: Request, env: AppEnv): Promise<Response> {
  try { return await route(request, env); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof Error && error.message === "AUTH_NOT_CONFIGURED") return json({ error: "本地账号服务尚未初始化，请运行管理员准备脚本", code: "AUTH_NOT_CONFIGURED" }, 503);
    if (String(error).includes("no such table")) return json({ error: "数据库尚未初始化，请应用本地迁移", code: "DATABASE_NOT_INITIALIZED" }, 503);
    // Do not log submitted documents, passwords, SQL parameters, or cookies.
    console.error(JSON.stringify({ event: "api_failure", path: new URL(request.url).pathname, errorType: error instanceof Error ? error.name : "unknown" }));
    return json({ error: "服务暂时不可用，请稍后重试", code: "INTERNAL_ERROR" }, 500);
  }
}
