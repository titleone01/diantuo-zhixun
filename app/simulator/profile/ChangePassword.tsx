'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { KeyRound, X } from 'lucide-react';
import { jsonBody } from '../api';
import Modal from '../Modal';
import { emptyPasswordFields, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordChangeError, validatePasswordChange, type PasswordFields } from './change-password';
import './profile.css';

type Props = {
  request: (path: string, init: RequestInit) => Promise<unknown>;
  onChanged: () => void;
};

export default function ChangePassword({ request, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(emptyPasswordFields);
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const currentInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (open) currentInput.current?.focus(); }, [open]);

  function close() {
    if (pending.current) return;
    setOpen(false); setFields(emptyPasswordFields()); setError('');
    trigger.current?.focus();
  }
  function update(field: keyof PasswordFields, value: string) {
    setFields(previous => ({ ...previous, [field]: value })); setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const invalid = validatePasswordChange(fields);
    if (invalid) { setError(invalid); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      await request('/auth/change-password', jsonBody({ currentPassword: fields.currentPassword, newPassword: fields.newPassword, revokeOtherSessions }));
      if (!mounted.current) return;
      setFields(emptyPasswordFields()); setOpen(false); onChanged();
      trigger.current?.focus();
    } catch (failure) {
      if (mounted.current) {
        setError(passwordChangeError(failure));
        if (failure && typeof failure === 'object' && 'code' in failure && failure.code === 'INVALID_PASSWORD') {
          setFields(previous => ({ ...previous, currentPassword: '' }));
        }
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <>
    <button className="dt-password-entry" ref={trigger} onClick={() => { setFields(emptyPasswordFields()); setError(''); setRevokeOtherSessions(true); setOpen(true); }}><KeyRound size={16}/>修改密码</button>
    {open && <Modal role="dialog" title="修改密码" className="dt-modal dt-password-modal" onClose={close}>
        <header><h2 id={`${id}-title`}>修改密码</h2><button aria-label="关闭修改密码" disabled={busy} onClick={close}><X size={20}/></button></header>
        <p id={`${id}-hint`}>新密码须为 12–128 个字符。修改成功后，当前浏览器保持登录。</p>
        <form noValidate onSubmit={submit} aria-busy={busy}>
          <label htmlFor={`${id}-current`}>当前密码<input ref={currentInput} id={`${id}-current`} type="password" autoComplete="current-password" required maxLength={PASSWORD_MAX_LENGTH} disabled={busy} value={fields.currentPassword} onChange={event => update('currentPassword', event.target.value)}/></label>
          <label htmlFor={`${id}-new`}>新密码<input id={`${id}-new`} type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} disabled={busy} value={fields.newPassword} onChange={event => update('newPassword', event.target.value)}/></label>
          <label htmlFor={`${id}-confirmation`}>确认新密码<input id={`${id}-confirmation`} type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} disabled={busy} value={fields.confirmation} onChange={event => update('confirmation', event.target.value)}/></label>
          <label className="dt-password-revoke"><input type="checkbox" checked={revokeOtherSessions} disabled={busy} onChange={event => setRevokeOtherSessions(event.target.checked)}/>同时退出其他设备上的登录</label>
          {error && <div role="alert" className="dt-error">{error}</div>}
          <div className="dt-modal-actions"><button type="button" disabled={busy} onClick={close}>取消</button><button className="dt-primary" type="submit" disabled={busy}>{busy ? '正在修改…' : '确认修改'}</button></div>
        </form>
      </Modal>}
  </>;
}
