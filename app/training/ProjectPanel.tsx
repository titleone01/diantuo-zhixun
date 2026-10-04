"use client";

import { useState } from "react";
import { workspaceRequest, type Account, type Session, type TrainingProject } from "./workspace-api";
import Modal from '../simulator/Modal';

export function ProjectPanel({ session, projects, selectedId, onSelect, onRefresh, onPreview }: {
  session: Session | null;
  projects: TrainingProject[];
  selectedId: string;
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
  onPreview: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const project = projects.find((item) => item.id === selectedId)!;
  const admin = session?.user.role === "admin";
  const csrf = { "X-CSRF-Token": session?.csrfToken ?? "" };

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await operation(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  };
  const refreshAccounts = async () => {
    const result = await workspaceRequest<{ accounts: Account[] }>("/api/accounts");
    setAccounts(result.accounts);
  };

  return <section className="project-panel" aria-label="项目图纸与账号">
    <header><b>项目图纸</b><span>{session ? `${session.user.username} · ${admin ? "管理员" : "学员"}` : "开发预览 · 账号保护未启用"}</span></header>
    <label className="project-selector">选择训练项目
      <select aria-label="选择训练项目" value={selectedId} disabled={busy} onChange={(event) => onSelect(event.target.value)}>
        {projects.map((item, index) => <option key={item.id} value={item.id}>{String(index + 1).padStart(2, "0")} {item.name}{item.drawing ? " · 已上传" : " · 待上传"}</option>)}
      </select>
    </label>
    <div className="project-drawing-info">
      <b>{project.name}</b>
      <span>{project.drawing ? `${project.drawing.name} · ${(project.drawing.size / 1024).toFixed(0)} KB` : "尚未上传图纸"}</span>
      <small>{project.simulation === "dol" ? "已接入三相直接启动仿真" : "图纸可查看；该项目仿真尚未开放"}</small>
      {project.drawing && <button type="button" onClick={onPreview}>查看图纸</button>}
    </div>
    {admin && <label className={`drawing-upload ${busy ? "is-busy" : ""}`}>{busy ? "正在保存…" : project.drawing ? "替换本项目图纸" : "上传本项目图纸"}
      <input type="file" aria-label="上传本项目图纸" accept="application/pdf,image/png,image/jpeg" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        if (file.size > 12 * 1024 * 1024) { setMessage("图纸最大支持 12 MB"); return; }
        if (project.drawing && !window.confirm(`将替换「${project.name}」的现有图纸，是否继续？`)) return;
        void perform(async () => {
          await workspaceRequest(`/api/projects/${selectedId}/drawing`, { method: "PUT", headers: { ...csrf, "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) }, body: file });
          await onRefresh(); setMessage("图纸已保存，学员重新选择该项目即可查看");
        });
      }} />
    </label>}
    <small>PDF / PNG / JPG · 每个项目 1 份 · 最大 12 MB</small>
    <div className="workspace-account-actions">
      {admin && <button type="button" disabled={busy} onClick={() => accounts ? setAccounts(null) : void perform(refreshAccounts)}>管理学员</button>}
      {session && <button type="button" disabled={busy} onClick={() => void perform(async () => {
        await workspaceRequest("/api/logout", { method: "POST", headers: csrf }); window.location.assign(new URL('/login', window.location.origin).href);
      })}>退出登录</button>}
    </div>
    {accounts && <div className="account-management">
      <form onSubmit={(event) => {
        event.preventDefault();
        void perform(async () => {
          await workspaceRequest("/api/accounts", { method: "POST", headers: { ...csrf, "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
          setUsername(""); setPassword(""); await refreshAccounts(); setMessage("学员账号已创建");
        });
      }}>
        <label>学员账号<input aria-label="新学员账号" autoComplete="off" required minLength={3} maxLength={40} value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>初始密码<input aria-label="新学员初始密码" type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button type="submit" disabled={busy}>创建学员</button>
      </form>
      {accounts.filter((item) => item.role === "student").map((item) => <div className="account-row" key={item.id}>
        <span>{item.username} · {item.disabled ? "已停用" : "可登录"}</span>
        <button type="button" disabled={busy} onClick={() => void perform(async () => {
          await workspaceRequest(`/api/accounts/${item.id}`, { method: "PATCH", headers: { ...csrf, "Content-Type": "application/json" }, body: JSON.stringify({ disabled: !item.disabled }) });
          await refreshAccounts();
        })}>{item.disabled ? "启用" : "停用"}</button>
      </div>)}
    </div>}
    {message && <p className="workspace-message" role="status">{message}</p>}
  </section>;
}

export function DrawingPreview({ project, onClose }: { project: TrainingProject; onClose: () => void }) {
  const source = `/api/projects/${project.id}/drawing?v=${encodeURIComponent(project.drawing?.updatedAt ?? "")}`;
  return <Modal title={`${project.name}图纸`} onClose={onClose} backdropClass="drawing-preview-layer" className="drawing-preview-modal">
    <section className="drawing-preview">
      <header><b>{project.name}</b><button type="button" onClick={onClose}>关闭图纸</button></header>
      {project.drawing?.mime === "application/pdf"
        ? <iframe title={`${project.name} PDF 图纸`} src={source} />
        : <img src={source} alt={`${project.name}图纸`} />}
      <a href={source} target="_blank" rel="noreferrer">在浏览器中打开原图纸</a>
    </section>
  </Modal>;
}
