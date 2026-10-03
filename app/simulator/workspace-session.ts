import { validateDocument } from './core/validation';
import type { CircuitDocument } from './core/types';
import type { SavedCircuit } from './api';

export type RecoveryState = { document: CircuitDocument; saved: SavedCircuit | null; dirty: boolean };
export type WorkspaceToken = { ownerId: string | null; session: number; workspace: number };

/** A late result from A stays stale even after the browser logs into B and back into A. */
export class WorkspaceBoundary {
  private state: WorkspaceToken = { ownerId: null, session: 0, workspace: 0 };
  capture(): WorkspaceToken { return { ...this.state }; }
  enter(ownerId: string | null) { this.state = { ownerId, session: this.state.session + 1, workspace: this.state.workspace + 1 }; }
  replace() { this.state = { ...this.state, workspace: this.state.workspace + 1 }; }
  acceptsSession(token: WorkspaceToken) { return token.ownerId === this.state.ownerId && token.session === this.state.session; }
  acceptsWorkspace(token: WorkspaceToken) { return this.acceptsSession(token) && token.workspace === this.state.workspace; }
}

export function readRecovery(raw: string | null): RecoveryState | null {
  if (!raw) return null;
  if (raw.length > 5_000_000) throw new Error('本地恢复文件过大，已保留原文件但未载入');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本地恢复文件无效');
  const recovery = value as Record<string, unknown>, checked = validateDocument(recovery.document);
  if (!checked.valid || !checked.document) throw new Error('本地恢复电路格式已过期或损坏，未自动载入');
  if (typeof recovery.dirty !== 'boolean') throw new Error('本地恢复状态无效，未自动载入');
  const saved = recovery.saved as SavedCircuit | null | undefined;
  if (saved != null && (typeof saved !== 'object' || typeof saved.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(saved.id) || !Number.isInteger(saved.revision) || saved.revision < 1 || !validateDocument(saved.document).valid)) throw new Error('本地草稿修订信息无效，未自动载入');
  return { document: checked.document, saved: saved ?? null, dirty: recovery.dirty || !!saved && JSON.stringify(checked.document) !== JSON.stringify(saved.document) };
}

/** Never overwrite an unreadable recovery record until its exact bytes have a separate backup. */
export function persistRecovery(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, state: RecoveryState): void {
  const next = JSON.stringify(state);
  const previous = storage.getItem(key);
  if (previous) {
    try { readRecovery(previous); }
    catch { storage.setItem(`${key}:unreadable:${crypto.randomUUID()}`, previous); }
  }
  // If backing up fails (for example quota exceeded), this write is never reached.
  storage.setItem(key, next);
}

/** Server acknowledgement applies to its snapshot, never to edits made while it was in flight. */
export function recoveryAfterSave(current: CircuitDocument, submitted: CircuitDocument, saved: SavedCircuit): RecoveryState {
  return { document: current, saved, dirty: JSON.stringify(current) !== JSON.stringify(submitted) };
}

export type ParkedRecovery = { key: string; title: string; savedAt: number; state?: RecoveryState; error?: string };
export function parkRecovery(storage: Pick<Storage, 'getItem' | 'setItem'>, ownerKey: string, state: RecoveryState): string {
  const key = `${ownerKey}:parked:${Date.now()}:${crypto.randomUUID()}`;
  persistRecovery(storage,key,state);
  // Readback detects a storage implementation that silently dropped the write.
  if(storage.getItem(key)!==JSON.stringify(state))throw new Error('本机暂存写入未确认，请保存或导出当前接线');
  return key;
}
export function listParkedRecovery(storage: Pick<Storage,'key' | 'length' | 'getItem'>, ownerKey: string): ParkedRecovery[] {
  const prefix=`${ownerKey}:parked:`, result: ParkedRecovery[]=[];
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i);if(!key?.startsWith(prefix)||key.includes(':unreadable:'))continue;
    const savedAt=Number(key.slice(prefix.length).split(':')[0])||0;
    try{const state=readRecovery(storage.getItem(key));if(state)result.push({key,title:state.document.title,savedAt,state});}
    catch(error){result.push({key,title:'损坏的暂存（原始记录已保留）',savedAt,error:error instanceof Error?error.message:'暂存读取失败'});}
  }
  return result.sort((a,b)=>b.savedAt-a.savedAt);
}
