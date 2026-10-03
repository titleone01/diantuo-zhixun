import type { AppEnv, Member } from "./auth";
import { ApiError, textField } from "./http";
import { validateDocument } from "../simulator/core/validation";
import { documentMediaIds, type CircuitDocument } from "../simulator/core/types";

export type CircuitRow = { id: string; ownerId: string; title: string; document: string; revision: number; createdAt: number; updatedAt: number; forkedFrom: string | null };
export type PublicationRow = { id: string; circuitId: string; ownerId: string; title: string; description: string; document?: string; sourceRevision: number; createdAt: number; name: string; username: string; likes: number; favorites: number; liked: number; favorited: number };
export function validatedDocument(value: unknown) {
  const checked = validateDocument(value);
  if (!checked.valid || !checked.document) throw new ApiError(400, "INVALID_DOCUMENT", checked.errors.slice(0, 3).join("；") || "电路文档无效");
  const serialized = JSON.stringify(checked.document);
  if (new TextEncoder().encode(serialized).byteLength > 750000) throw new ApiError(413, "DOCUMENT_TOO_LARGE", "电路文档过大");
  return { document: checked.document, serialized };
}
export function revisionOf(body: Record<string, unknown>): number {
  if (!Number.isInteger(body.revision) || Number(body.revision) < 1) throw new ApiError(400, "REVISION_REQUIRED", "保存、删除和发布时必须携带当前版本号");
  return Number(body.revision);
}
export async function getCircuit(env: AppEnv, member: Member, id: string) {
  // Read the draft and its attachments in one SQLite snapshot. Separate awaits
  // could otherwise pair an old revision/document with a concurrent save's media.
  const row = await env.DB.prepare("SELECT c.*,(SELECT json_group_array(cm.mediaId) FROM circuit_media cm WHERE cm.circuitId=c.id) mediaIds FROM circuits c WHERE c.id=? AND c.ownerId=?")
    .bind(id, member.id).first<CircuitRow & { mediaIds: string }>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "电路不存在或无权访问");
  return { id: row.id, title: row.title, document: JSON.parse(row.document) as unknown, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt, forkedFrom: row.forkedFrom, mediaIds: JSON.parse(row.mediaIds) as string[] };
}
export async function allowedMedia(env: AppEnv, member: Member, value: unknown): Promise<string[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some(x => typeof x !== "string" || x.length > 80)) throw new ApiError(400, "INVALID_MEDIA", "附件列表无效");
  const ids = [...new Set(value as string[])];
  for (const id of ids) {
    const row = await env.DB.prepare("SELECT m.id FROM media m WHERE m.id=? AND (m.ownerId=? OR EXISTS(SELECT 1 FROM publication_media p WHERE p.mediaId=m.id) OR EXISTS(SELECT 1 FROM training_drawings t WHERE t.mediaId=m.id) OR EXISTS(SELECT 1 FROM circuit_media cm JOIN circuits c ON cm.circuitId=c.id WHERE cm.mediaId=m.id AND c.ownerId=?))")
      .bind(id, member.id, member.id).first();
    if (!row) throw new ApiError(403, "MEDIA_FORBIDDEN", "附件不存在或无权使用");
  }
  return ids;
}
/** A public reference must not silently publish an earlier private drawing. */
export function assertReferenceMedia(document: CircuitDocument, mediaIds: unknown): void {
  if (document.referenceDiagramId !== undefined && Array.isArray(mediaIds) && mediaIds.length) throw new ApiError(400, "REFERENCE_MEDIA_CONFLICT", "参考图纸不能同时携带私有附件");
}
export async function saveCircuit(env: AppEnv, member: Member, body: Record<string, unknown>, id?: string) {
  const title = textField(body.title, "电路标题", 1, 100);
  const { document, serialized } = validatedDocument(body.document);
  const current = id ? await getCircuit(env, member, id) : null;
  const revision = id ? revisionOf(body) : 0;
  if (current && current.revision !== revision) throw new ApiError(409, "REVISION_CONFLICT", "此草稿已有更新，请重新载入后保存");
  const suppliedMedia = body.mediaIds === undefined && current && document.referenceDiagramId === undefined ? current.mediaIds : body.mediaIds;
  if (suppliedMedia !== undefined && !Array.isArray(suppliedMedia)) throw new ApiError(400, "INVALID_MEDIA", "附件列表无效");
  assertReferenceMedia(document, suppliedMedia);
  const mediaIds = await allowedMedia(env, member, [...new Set([...(Array.isArray(suppliedMedia) ? suppliedMedia : []), ...documentMediaIds(document)])]);
  const circuitId = id || crypto.randomUUID();
  const writeId = crypto.randomUUID();
  const now = Date.now();
  const write = id
    ? env.DB.prepare("UPDATE circuits SET title=?,document=?,revision=revision+1,writeId=?,updatedAt=? WHERE id=? AND ownerId=? AND revision=? RETURNING id").bind(title, serialized, writeId, now, id, member.id, revision)
    : env.DB.prepare("INSERT INTO circuits(id,ownerId,title,document,revision,writeId,createdAt,updatedAt) VALUES(?,?,?,?,1,?,?,?) RETURNING id").bind(circuitId, member.id, title, serialized, writeId, now, now);
  // The random receipt ties the attachment changes to this exact successful CAS.
  // A failed optimistic update must never rewrite the winning save's attachments.
  const condition = "EXISTS(SELECT 1 FROM circuits WHERE id=? AND ownerId=? AND writeId=?)";
  const statements = [write, env.DB.prepare(`DELETE FROM circuit_media WHERE circuitId=? AND ${condition}`).bind(circuitId, circuitId, member.id, writeId),
    ...mediaIds.map(mediaId => env.DB.prepare(`INSERT INTO circuit_media(circuitId,mediaId) SELECT ?,? WHERE ${condition}`).bind(circuitId, mediaId, circuitId, member.id, writeId))];
  const results = await env.DB.batch(statements);
  if (!results[0].results?.length) throw new ApiError(409, "REVISION_CONFLICT", "此草稿已有更新，请重新载入后保存");
  return getCircuit(env, member, circuitId);
}
export const publicationColumns = `p.id,p.circuitId,p.ownerId,p.title,p.description,p.sourceRevision,p.createdAt,u.name,u.username,
  (SELECT count(*) FROM reactions r WHERE r.publicationId=p.id AND r.kind='like') likes,
  (SELECT count(*) FROM reactions r WHERE r.publicationId=p.id AND r.kind='favorite') favorites,
  EXISTS(SELECT 1 FROM reactions r WHERE r.publicationId=p.id AND r.kind='like' AND r.userId=?) liked,
  EXISTS(SELECT 1 FROM reactions r WHERE r.publicationId=p.id AND r.kind='favorite' AND r.userId=?) favorited`;
export function publicView(row: PublicationRow) {
  const { ownerId, name, username, document, liked, favorited, ...rest } = row;
  return { ...rest, author: { id: ownerId, name, username }, ...(document ? { document: JSON.parse(document) as unknown } : {}), liked: !!liked, favorited: !!favorited };
}
export async function getPublication(env: AppEnv, member: Member, id: string) {
  const row = await env.DB.prepare(`SELECT ${publicationColumns},p.document FROM publications p JOIN user u ON p.ownerId=u.id WHERE p.id=?`).bind(member.id, member.id, id).first<PublicationRow>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "分享不存在");
  const media = await env.DB.prepare("SELECT mediaId FROM publication_media WHERE publicationId=?").bind(id).all<{ mediaId: string }>();
  return { ...publicView(row), mediaIds: media.results.map(x => x.mediaId) };
}
