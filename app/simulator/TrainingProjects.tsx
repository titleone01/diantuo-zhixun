import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FileUp, ExternalLink, Maximize2, RefreshCw, X } from 'lucide-react';
import projectNames from '../../shared/training-projects.json';
import { api, ApiError, jsonBody, STATIC_DEMO, type Member } from './api';
import PdfDrawing from './PdfDrawing';
import DrawingViewer from './DrawingViewer';
import './training-projects.css';

export type DrawingKind = 'schematic' | 'layout';
export type DrawingMedia = { id: string; url: string; type: string; name?: string; size?: number };
export type Project = { id: string; name: string; title: string; lessonId: string | null; drawingStatus: 'pending' | 'uploaded'; updatedAt: number | null; media: DrawingMedia | null; drawings?: { schematic: DrawingMedia | null; layout: DrawingMedia | null } };
type Props = { documentKey?: string; readOnly?: boolean; user: Member; fallback?: ReactNode; onUseDrawing?: (mediaId: string, project: Project, kind?: DrawingKind) => void; selectedProjectId?: string; currentDrawings?: Partial<Record<DrawingKind, DrawingMedia>>; currentKind?: DrawingKind; onSelectCurrentDrawing?: (kind: DrawingKind) => void; onPreviewContextChange?: (referenceVideoAllowed: boolean) => void };
const LABELS: Record<DrawingKind, string> = { schematic: '原理图', layout: '元件布置图' };
const projectMedia = (project: Project, kind: DrawingKind) => project.drawings ? project.drawings[kind] : kind === 'schematic' ? project.media : null;
function Drawing({ media, title }: { media: DrawingMedia; title: string }) { return media.type === 'application/pdf' ? <PdfDrawing src={media.url} title={title}/> : <img src={media.url} alt={title}/>; }

export default function TrainingProjects({ user, fallback, onUseDrawing, selectedProjectId, documentKey, readOnly = false, currentDrawings, currentKind = 'schematic', onSelectCurrentDrawing, onPreviewContextChange }: Props) {
  const [projects, setProjects] = useState<Project[]>(projectNames.map(p => ({ id: p.id, name: p.name, title: p.name, lessonId: null, drawingStatus: 'pending', updatedAt: null, media: null })));
  const [selected, setSelected] = useState('');
  const [kind, setKind] = useState<DrawingKind>('schematic');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const projectRequest = useRef(0);
  useEffect(() => { setSelected(''); setKind('schematic'); setEnlarged(false); setToolsOpen(false); }, [selectedProjectId, documentKey]);
  useEffect(() => { let active = true; const request = ++projectRequest.current; if (!STATIC_DEMO) api<{items: Project[]}>('/training-projects').then(r => { if (active && request === projectRequest.current) setProjects(r.items); }).catch(e => { if (active && request === projectRequest.current) setError(e.message); }); return () => { active = false; }; }, []);
  const project = projects.find(p => p.id === selected);
  const shownKind = project ? kind : currentKind;
  const media = project ? projectMedia(project, kind) : currentDrawings?.[currentKind];
  const title = `${project?.title || '当前练习'} · ${LABELS[shownKind]}`;
  const hasSlots = !!project || !!currentDrawings;
  useEffect(() => { onPreviewContextChange?.(!hasSlots); }, [hasSlots, documentKey, onPreviewContextChange]);
  async function upload(file?: File) {
    if (readOnly || refreshing || busy || !file || !project) return;
    const projectId = project.id; const uploadKind = kind;
    const expectedMediaId = projectMedia(project, uploadKind)?.id ?? null;
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const result = await api<{media: {id: string}}>('/media', {method: 'POST', body: form});
      const response = await api<{project: Project}>(`/training-projects/${projectId}`, jsonBody({mediaId: result.media.id, kind: uploadKind, expectedMediaId}, 'PUT'));
      projectRequest.current++;
      setProjects(items => items.map(p => p.id === projectId ? response.project : p));
    } catch (reason) { setError(reason instanceof ApiError && reason.status === 409 ? '这张项目图纸已被其他管理员修改。请刷新项目图纸后重试。' : (reason as Error).message); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function refreshProjects() {
    if (STATIC_DEMO || busy || refreshing) return;
    const request = ++projectRequest.current;
    setRefreshing(true); setError('');
    try { const response = await api<{items: Project[]}>('/training-projects'); if (request === projectRequest.current) setProjects(response.items); }
    catch (reason) { setError((reason as Error).message); }
    finally { setRefreshing(false); }
  }
  const pending = <div className="dt-project-pending"><FileUp size={30}/><strong>{project?.name || '当前练习'}</strong><p>{LABELS[shownKind]}尚未上传</p><small>{project && user.role === 'admin' ? `请选择${LABELS[shownKind]}文件上传。` : `此位置没有${LABELS[shownKind]}，不会使用其他图纸代替。`}</small></div>;
  return <section className="dt-training-projects">
    <button type="button" className="dt-project-options-toggle" aria-expanded={toolsOpen} aria-controls={toolsId} onClick={() => setToolsOpen(open => !open)}>{toolsOpen ? '收起项目选项' : '选择项目图纸'}<span aria-hidden="true">{toolsOpen ? '▴' : '▾'}</span></button>
    {hasSlots && <div className="dt-project-drawing-tabs" role="tablist" aria-label="项目图纸类型">{(['schematic', 'layout'] as const).map(item => <button key={item} type="button" role="tab" aria-selected={shownKind === item} className={shownKind === item ? 'active' : ''} disabled={busy || (!project && (readOnly || !onSelectCurrentDrawing))} onClick={() => { setEnlarged(false); if (project) setKind(item); else if (!readOnly) onSelectCurrentDrawing?.(item); }}>{LABELS[item]}{project && !projectMedia(project, item) || !project && !currentDrawings?.[item] ? <small>待上传</small> : null}</button>)}</div>}
    <div id={toolsId} className="dt-project-options" hidden={!toolsOpen}>
      <label>项目图纸<select aria-label="选择训练项目图纸" disabled={busy || refreshing} value={selected} onChange={e => { setSelected(e.target.value); setKind('schematic'); setEnlarged(false); setError(''); }}><option value="">当前练习图纸</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.drawingStatus === 'pending' ? ' · 待上传' : ''}</option>)}</select></label>
      {!STATIC_DEMO && <div className="dt-project-tools"><button type="button" disabled={busy || refreshing} onClick={() => void refreshProjects()}><RefreshCw size={13}/>{refreshing ? '正在刷新…' : '刷新项目图纸'}</button></div>}
      {project && user.role === 'admin' && !STATIC_DEMO && <div className="dt-project-tools"><input ref={fileInput} type="file" disabled={readOnly || busy || refreshing} aria-label={`上传项目${LABELS[kind]}文件`} accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e => void upload(e.target.files?.[0])}/><button disabled={readOnly || busy || refreshing} onClick={() => fileInput.current?.click()}><FileUp size={15}/>{busy ? `正在上传${LABELS[kind]}…` : `${media ? '替换' : '上传'}${LABELS[kind]}`}</button></div>}
      {project && !project.lessonId && <p className="dt-hint">本项目可查看图纸，对应动作仿真待扩展。</p>}
    </div>
    {error && <p role="alert" className="dt-error">{error}</p>}
    <div className={`dt-project-preview${media?.type === 'application/pdf' ? ' is-pdf' : ''}`}>{project ? media ? <Drawing media={media} title={title}/> : pending : currentDrawings && !media ? pending : fallback}</div>
    {media && <div className="dt-project-tools dt-project-view-actions"><button type="button" onClick={() => setEnlarged(true)}><Maximize2 size={14}/>放大查看</button><a href={media.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>查看原图</a>{project && onUseDrawing && <button disabled={readOnly || busy || refreshing} onClick={() => { if (!readOnly) { onUseDrawing(media.id, {...project, media}, kind); setSelected(''); } }}>用于当前练习</button>}</div>}
    {enlarged && media && createPortal(<div className="dt-training-projects dt-project-modal-root"><div className="dt-project-zoom-backdrop" onClick={() => setEnlarged(false)}><section className="dt-project-zoom-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setEnlarged(false); }}><header><strong>{title}</strong><button aria-label="关闭放大图纸" onClick={() => setEnlarged(false)}><X size={20}/></button></header><div className="dt-project-zoom-content"><DrawingViewer key={`${media.id}-${shownKind}`} src={media.url} type={media.type} title={title}/></div></section></div></div>, document.body)}
  </section>;
}
