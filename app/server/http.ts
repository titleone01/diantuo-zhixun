export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export function textField(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new ApiError(400, "INVALID_INPUT", `${name}长度需为 ${min}–${max} 个字符`);
  }
  return value.trim();
}
export async function readBody(request: Request, maximum = 1024 * 1024): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length")) > maximum) throw new ApiError(413, "TOO_LARGE", "请求内容过大");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new ApiError(413, "TOO_LARGE", "请求内容过大"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "JSON_REQUIRED", "请使用 JSON 提交");
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(await readBody(request)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "JSON 格式无效");
  }
}
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
}
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}
export function assertOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new ApiError(403, "ORIGIN_REQUIRED", "请求来源校验失败，请刷新页面后重试");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "CROSS_SITE", "不接受跨站请求");
}
