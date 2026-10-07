import type { CircuitDocument, AssessmentReports } from './core/types';

declare const __STATIC_DEMO__: boolean;
export const STATIC_DEMO = typeof __STATIC_DEMO__ !== 'undefined' && __STATIC_DEMO__;
export type Member = { id: string; name: string; username: string; role: string; bio?: string };
export type SavedCircuit = { id: string; title: string; document: CircuitDocument; revision: number; createdAt: string; updatedAt: string; mediaIds?: string[] };
export type Publication = { id: string; title: string; document: CircuitDocument; author: Member; createdAt: string; likes: number; favorites: number; liked: boolean; favorited: boolean; circuitId?: string };
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
export const API_TIMEOUT_MS = 30_000;
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) cancel();
  else init?.signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, API_TIMEOUT_MS);
  try {
    const headers = new Headers(init?.headers);
    if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init, headers, signal: controller.signal });
    const body: unknown = await response.json().catch(() => null);
    // A proxy can return an HTML error page with HTTP 200. Never treat it as a successful save/session.
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError('服务响应格式异常，请稍后重试', response.ok ? 502 : response.status, 'INVALID_RESPONSE');
    }
    const result = body as Record<string, unknown>;
    if (!response.ok) throw new ApiError(String(result.error || result.message || '请求失败'), response.status, typeof result.code === 'string' ? result.code : undefined);
    return result as T;
  } catch (error) {
    // Do not retry mutations automatically: a timed-out save may already have reached the server.
    if (timedOut) throw new ApiError('请求超时；如正在保存，请先确认草稿结果再重试', 408, 'REQUEST_TIMEOUT');
    if (init?.signal?.aborted) throw init.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener('abort', cancel);
  }
}
export const jsonBody = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });
export const assessOnServer = (document: CircuitDocument): Promise<AssessmentReports> => api<AssessmentReports>('/assess', jsonBody({ document, lessonId: document.lessonId })).then(({assessment,workmanship}) => ({assessment,workmanship}));
