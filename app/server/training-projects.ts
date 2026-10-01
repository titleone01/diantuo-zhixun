import projects from "../../shared/training-projects.json";
import type { AppEnv, Member } from "./auth";
import { ApiError, bodyJson, json, readBody, textField } from "./http";

type DrawingKind = "schematic" | "layout";
type Drawing = { projectId: string; kind: DrawingKind; title: string; mediaId: string; updatedAt: number; name: string; type: string; size: number };
function drawingKind(value: unknown): DrawingKind {
  if (value === undefined) return "schematic";
  if (value !== "schematic" && value !== "layout") throw new ApiError(400, "INVALID_DRAWING_KIND", "图纸类型必须是原理图或布局图");
  return value;
}
const selectDrawings = "SELECT d.*,m.name,m.type,m.size FROM training_drawings d JOIN media m ON d.mediaId=m.id";
function view(project: { id: string; name: string }, drawings: Drawing[]) {
  const schematic = drawings.find(drawing => drawing.kind === "schematic");
  const layout = drawings.find(drawing => drawing.kind === "layout");
  const media = (drawing?: Drawing) => drawing ? { id: drawing.mediaId, url: `/api/media/${drawing.mediaId}`, name: drawing.name, type: drawing.type, size: drawing.size } : null;
  return {
    id: project.id, name: project.name, title: schematic?.title || layout?.title || project.name,
    lessonId: `motor-course-${project.id.slice(-2)}`,
    drawingStatus: drawings.length ? "uploaded" : "pending", updatedAt: drawings.length ? Math.max(...drawings.map(drawing => drawing.updatedAt)) : null,
    media: media(schematic), drawings: { schematic: media(schematic), layout: media(layout) },
  };
}
export async function listTrainingProjects(env: AppEnv): Promise<Response> {
  const rows = await env.DB.prepare(selectDrawings).all<Drawing>();
  return json({ items: projects.map(project => view(project, rows.results.filter(row => row.projectId === project.id))) });
}
export async function setTrainingDrawing(env: AppEnv, member: Member, id: string, request: Request): Promise<Response> {
  if (member.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "只有管理员可以上传或替换项目图纸");
  const project = projects.find(item => item.id === id);
  if (!project) throw new ApiError(404, "NOT_FOUND", "训练项目不存在");
  let body: Record<string, unknown>;
  if (request.method === "DELETE" && !request.headers.has("content-type")) {
    if ((await readBody(request, 1024)).length) throw new ApiError(415, "JSON_REQUIRED", "请使用 JSON 提交");
    body = {};
  } else body = await bodyJson(request);
  const kind = drawingKind(body.kind);
  async function result() {
    const rows = await env.DB.prepare(`${selectDrawings} WHERE d.projectId=?`).bind(id).all<Drawing>();
    return json({ project: view(project!, rows.results) });
  }
  if (request.method === "DELETE") {
    if (body.expectedMediaId === null) {
      const current = await env.DB.prepare("SELECT mediaId FROM training_drawings WHERE projectId=? AND kind=?").bind(id, kind).first();
      if (current) throw new ApiError(409, "DRAWING_CONFLICT", "图纸已被更新，请重新读取后再操作");
    } else if (body.expectedMediaId !== undefined) {
      const expected = textField(body.expectedMediaId, "原图纸标识", 1, 80);
      const deleted = await env.DB.prepare("DELETE FROM training_drawings WHERE projectId=? AND kind=? AND mediaId=?").bind(id, kind, expected).run();
      if (!deleted.meta.changes) throw new ApiError(409, "DRAWING_CONFLICT", "图纸已被更新，请重新读取后再操作");
    } else await env.DB.prepare("DELETE FROM training_drawings WHERE projectId=? AND kind=?").bind(id, kind).run();
    return result();
  }
  const mediaId = textField(body.mediaId, "图纸文件", 1, 80);
  const file = await env.DB.prepare("SELECT id,name,type,size FROM media WHERE id=? AND ownerId=?").bind(mediaId, member.id).first<{ id: string; name: string; type: string; size: number }>();
  if (!file) throw new ApiError(403, "MEDIA_FORBIDDEN", "只能选择由当前管理员上传的图纸");
  if (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.type) || file.size > 12 * 1024 * 1024) throw new ApiError(400, "INVALID_DRAWING", "项目图纸支持 PDF、PNG、JPEG、WebP，最大 12 MiB");
  const previous = await env.DB.prepare("SELECT title FROM training_drawings WHERE projectId=? AND kind=?").bind(id, kind).first<{ title: string }>();
  const title = body.title === undefined ? previous?.title || project.name : textField(body.title, "图纸标题", 1, 100);
  const updatedAt = Date.now();
  let statement: D1PreparedStatement;
  if (body.expectedMediaId === null) {
    statement = env.DB.prepare("INSERT INTO training_drawings(projectId,kind,title,mediaId,updatedBy,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(projectId,kind) DO NOTHING")
      .bind(id, kind, title, mediaId, member.id, updatedAt);
  } else if (body.expectedMediaId !== undefined) {
    const expected = textField(body.expectedMediaId, "原图纸标识", 1, 80);
    statement = env.DB.prepare("UPDATE training_drawings SET title=?,mediaId=?,updatedBy=?,updatedAt=? WHERE projectId=? AND kind=? AND mediaId=?")
      .bind(title, mediaId, member.id, updatedAt, id, kind, expected);
  } else {
    statement = env.DB.prepare("INSERT INTO training_drawings(projectId,kind,title,mediaId,updatedBy,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(projectId,kind) DO UPDATE SET title=excluded.title,mediaId=excluded.mediaId,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt")
      .bind(id, kind, title, mediaId, member.id, updatedAt);
  }
  if (!(await statement.run()).meta.changes) throw new ApiError(409, "DRAWING_CONFLICT", "图纸已被更新，请重新读取后再操作");
  return result();
}
