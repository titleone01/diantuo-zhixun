export type Session = {
  user: { id: string; username: string; role: "admin" | "student" };
  csrfToken: string;
};
export type Drawing = { name: string; mime: string; size: number; updatedAt: string };
export type TrainingProject = { id: string; name: string; simulation: string; drawing: Drawing | null };
export type Account = { id: string; username: string; role: string; disabled: boolean };

export async function workspaceRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("登录已过期，请重新登录");
  }
  const isJson = response.headers.get("content-type")?.includes("application/json");
  if (!isJson) throw new Error("账号与图纸服务未启用，请使用局域网服务入口");
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "操作失败，请重试");
  return body as T;
}
