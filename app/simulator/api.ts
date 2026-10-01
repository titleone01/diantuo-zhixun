import type { CircuitDocument, LessonAssessment } from './core/types';

declare const __STATIC_DEMO__: boolean;
export const STATIC_DEMO = typeof __STATIC_DEMO__ !== 'undefined' && __STATIC_DEMO__;
export type Member = { id: string; name: string; username: string; role: string; bio?: string };
export type SavedCircuit = { id: string; title: string; document: CircuitDocument; revision: number; createdAt: string; updatedAt: string; mediaIds?: string[] };
export type Publication = { id: string; title: string; document: CircuitDocument; author: Member; createdAt: string; likes: number; favorites: number; liked: boolean; favorited: boolean; circuitId?: string };
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init, headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init?.headers } });
  const body = await response.json().catch(() => ({ error: '服务暂时不可用，请稍后重试' })) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(String(body.error || body.message || '请求失败'), response.status, typeof body.code === 'string' ? body.code : undefined);
  return body as T;
}
export const jsonBody = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });
export const assessOnServer = (document: CircuitDocument): Promise<LessonAssessment> => api<{ assessment: LessonAssessment }>('/assess', jsonBody({ document, lessonId: document.lessonId })).then(result => result.assessment);
