export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordFields = { currentPassword: string; newPassword: string; confirmation: string };
export const emptyPasswordFields = (): PasswordFields => ({ currentPassword: '', newPassword: '', confirmation: '' });

export function validatePasswordChange(fields: PasswordFields): string | null {
  if (!fields.currentPassword) return '请输入当前密码';
  if (fields.currentPassword.length > PASSWORD_MAX_LENGTH) return '当前密码不能超过 128 个字符';
  if (fields.newPassword.length < PASSWORD_MIN_LENGTH || fields.newPassword.length > PASSWORD_MAX_LENGTH) return '新密码须为 12–128 个字符';
  if (fields.newPassword === fields.currentPassword) return '新密码不能与当前密码相同';
  if (fields.confirmation !== fields.newPassword) return '两次输入的新密码不一致';
  return null;
}

export function passwordChangeError(error: unknown): string {
  const failure = error && typeof error === 'object' ? error as { code?: string; status?: number } : {};
  if (failure.code === 'INVALID_PASSWORD') return '当前密码不正确，请重新输入';
  if (failure.code === 'PASSWORD_TOO_SHORT' || failure.code === 'PASSWORD_TOO_LONG') return '新密码须为 12–128 个字符';
  if (failure.code === 'CREDENTIAL_ACCOUNT_NOT_FOUND') return '此账号没有可修改的密码，请联系管理员';
  if (failure.status === 401 || failure.code === 'SESSION_EXPIRED' || failure.code === 'UNAUTHORIZED') return '登录已过期，请重新登录后修改密码';
  if (failure.status === 429) return '操作过于频繁，请稍后再试';
  if (failure.status === 403) return '当前请求未获允许，请刷新页面后重试';
  if (failure.code === 'FAILED_TO_GET_SESSION' || failure.code === 'FAILED_TO_CREATE_SESSION') return '密码可能已更新，但登录状态未恢复。请使用新密码重新登录';
  if (error instanceof TypeError) return '网络连接失败，请检查连接后重试';
  // Never display arbitrary error payloads from an authentication request.
  return '修改密码失败，请稍后重试';
}
