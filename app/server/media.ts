import type { AppEnv, Member } from "./auth";
import { ApiError, json, readBody } from "./http";

const MAX_UPLOAD = 20 * 1024 * 1024;
function validSignature(bytes: Uint8Array, type: string): boolean {
  const ascii = (start: number, count: number) => String.fromCharCode(...bytes.slice(start, start + count));
  if (type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/gif") return ["GIF87a", "GIF89a"].includes(ascii(0, 6));
  if (type === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
  if (type === "application/pdf") return ascii(0, 5) === "%PDF-";
  if (type === "video/mp4") return ascii(4, 4) === "ftyp";
  if (type === "video/webm") return bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163;
  return false;
}
export async function uploadMedia(env: AppEnv, member: Member, request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new ApiError(415, "MULTIPART_REQUIRED", "请通过文件上传提交附件");
  const bytes = await readBody(request, MAX_UPLOAD + 65536);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type")! } }).formData();
  } catch {
    throw new ApiError(400, "INVALID_MULTIPART", "文件上传格式无效，请重新选择文件后提交");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_UPLOAD) throw new ApiError(400, "INVALID_FILE", "请选择不超过 20 MiB 的文件");
  const payload = new Uint8Array(await file.arrayBuffer());
  if (!validSignature(payload, file.type)) throw new ApiError(415, "UNSUPPORTED_FILE", "仅支持 PNG、JPEG、GIF、WebP、PDF、MP4、WebM 文件");
  const id = crypto.randomUUID();
  const objectKey = `${member.id}/${id}`;
  const name = file.name.replace(/[\r\n/\\]/g, "_").slice(0, 150) || "附件";
  await env.MEDIA.put(objectKey, payload, { httpMetadata: { contentType: file.type } });
  try {
    await env.DB.prepare("INSERT INTO media(id,ownerId,objectKey,name,type,size,createdAt) VALUES(?,?,?,?,?,?,?)").bind(id, member.id, objectKey, name, file.type, file.size, Date.now()).run();
  } catch (error) { await env.MEDIA.delete(objectKey); throw error; }
  return json({ media: { id, url: `/api/media/${id}`, name, type: file.type, size: file.size } }, 201);
}
export async function downloadMedia(env: AppEnv, member: Member, id: string, request: Request): Promise<Response> {
  const row = await env.DB.prepare("SELECT m.* FROM media m WHERE m.id=? AND (m.ownerId=? OR EXISTS(SELECT 1 FROM publication_media p WHERE p.mediaId=m.id) OR EXISTS(SELECT 1 FROM training_drawings t WHERE t.mediaId=m.id) OR EXISTS(SELECT 1 FROM circuit_media cm JOIN circuits c ON cm.circuitId=c.id WHERE cm.mediaId=m.id AND c.ownerId=?))")
    .bind(id, member.id, member.id).first<{ objectKey: string; type: string; name: string; size: number }>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "附件不存在或无权访问");
  const requestedRange = request.headers.get("Range");
  let range: { offset: number; length: number } | undefined;
  if (requestedRange) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(requestedRange);
    if (match && (match[1] || match[2])) {
      const offset = match[1] ? Number(match[1]) : Math.max(0, row.size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(row.size - 1, Number(match[2])) : row.size - 1;
      if (Number.isSafeInteger(offset) && Number.isSafeInteger(end) && offset >= 0 && end >= offset && offset < row.size && (match[1] || Number(match[2]) > 0)) range = { offset, length: end - offset + 1 };
    }
    if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${row.size}`, "Cache-Control": "private, no-store" } });
  }
  const object = await env.MEDIA.get(row.objectKey, range ? { range } : undefined);
  if (!object) throw new ApiError(404, "NOT_FOUND", "附件文件不存在");
  const headers = new Headers({ "Content-Type": row.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'; sandbox", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name)}` });
  let status = 200;
  if (range) {
    const { offset, length } = range;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    status = 206;
  } else headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers, status });
}
