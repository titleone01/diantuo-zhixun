'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Bolt, BookOpen, Boxes, CircuitBoard, Copy, FilePlus2, FolderOpen, Globe, Heart, Home, LogOut, Search, ShieldCheck, Star, UserRound, X } from 'lucide-react';
import SimulatorEditor from './editor/SimulatorEditor';
import DocumentPreview from './editor/DocumentPreview';
import DeviceArtwork from './editor/DeviceArtwork';
import TrainingProjects, { type Project } from './TrainingProjects';
import ReferenceDrawings from './ReferenceDrawings';
import ChangePassword from './profile/ChangePassword';
import ProfileLibrary from './profile/ProfileLibrary';
import Gallery from './gallery/Gallery';
import { APP_LOCATION_CHANGED, emptyGalleryRoute, galleryHref, navigateAppLocation } from './gallery/route';
import LessonSchematic from './LessonSchematic';
import { CATALOG } from './core/catalog';
import { LESSONS, createLessonDocument, getLesson } from './core/lessons';
import { assessLesson } from './core/engine';
import { validateDocument } from './core/validation';
import { createReferenceDocument } from './core/reference-workspace';
import { parseReferenceEntry, resolveReferenceEntry } from './core/reference-entry';
import { WorkspaceBoundary, readRecovery, recoveryAfterSave, type RecoveryState } from './workspace-session';
import { documentMediaIds, type CircuitDocument, type ComponentDefinition, type DrawingKind, type DrawingMediaType } from './core/types';
import { api, jsonBody, ApiError, STATIC_DEMO, assessOnServer, type Member, type Publication, type SavedCircuit } from './api';
import './site.css';

type Section = 'simulator' | 'drawings' | 'gallery' | 'components' | 'profile';
const NAV: { id: Section; label: string; icon: typeof Home }[] = [{ id: 'simulator', label: '模拟电路', icon: Home }, { id: 'drawings', label: '图纸集', icon: BookOpen }, { id: 'gallery', label: '仿真广场', icon: Globe }, { id: 'components', label: '元器件百科', icon: Boxes }, { id: 'profile', label: '个人中心', icon: UserRound }];
const date = (value: string | number) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const LOCAL_KEY = 'diantuo:simulator:demo:v1';
const draftKey = (id: string) => `diantuo:simulator:recovery:v1:${id}`;
function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  return <div className="dt-modal-backdrop" onClick={close}><section role="dialog" aria-modal="true" aria-label={title} className="dt-modal" onClick={e => e.stopPropagation()}><header><h2>{title}</h2><button aria-label="关闭" onClick={close}><X size={20}/></button></header>{children}</section></div>;
}
function Brand() { return <div className="dt-brand"><Bolt size={30} strokeWidth={2.5}/><div><strong>电拓智训</strong><small>电气数字仿真实训系统</small></div></div>; }

function Login({ ready }: { ready: (user: Member) => void }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [token, setToken] = useState(''); const [inviteValid, setInviteValid] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { const value = new URLSearchParams(location.search).get('token'); if (value) { setToken(value); api(`/invites/preview?token=${encodeURIComponent(value)}`).then(() => setInviteValid(true)).catch(e => setError(e.message)); } }, []);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try {
    if (token) { if (!inviteValid) throw new Error('邀请无效，请联系管理员'); await api('/invites/accept', jsonBody({ token, username, password, name: name || username })); setToken(''); }
    await api('/auth/sign-in/username', jsonBody({ username, password })); const session = await api<{ user: Member }>('/session'); if (location.pathname !== '/gallery' && parseReferenceEntry(location.pathname, location.search).kind === 'none') history.replaceState({}, '', '/'); ready(session.user);
  } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <div className="dt-login"><header><Brand/><span>成员实训平台</span></header><div className="dt-login-body"><section className="dt-login-intro"><div className="dt-eyebrow">ELECTRICAL ENGINEERING SIMULATION</div><h1>把电路原理，<br/>接成看得见的运行。</h1><p>选择器件、完成接线、操作仿真。<br/>在每一次启动与停止中，理解电路的工作过程。</p><div className="dt-login-preview"><LessonSchematic lessonId="motor-self-hold"/></div><span>点动控制 · 自锁启停 · 单控照明 · 双控照明</span></section><form className="dt-login-card" onSubmit={submit}><h2>{token ? '接受邀请' : '欢迎登录'}</h2><p>{token ? '创建你的成员账号，开始实训。' : '使用管理员邀请的账号进入实训。'}</p>{token && <label>昵称<input autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} maxLength={40}/></label>}<label>账号<input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} placeholder="请输入账号"/></label><label>密码<input autoComplete={token ? 'new-password' : 'current-password'} required type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} placeholder="请输入密码"/></label>{error && <div role="alert" className="dt-error">{error}</div>}<button className="dt-primary" disabled={busy || (!!token && !inviteValid)}>{busy ? '正在处理…' : token ? '创建账号并登录' : '登录'}</button><small>邀请制开放 · 没有账号请联系管理员</small></form></div><footer>电拓智训 · 独立电气教学仿真平台</footer></div>;
}

export default function SimulatorApp({ initialSection = 'simulator' }: { initialSection?: Section }) {
  const [editorRunning, setEditorRunning] = useState(false);
  const [referencePreviewAllowed, setReferencePreviewAllowed] = useState(true);
  const [section, setSection] = useState<Section>(initialSection); const [user, setUser] = useState<Member | null>(null); const [loading, setLoading] = useState(true);
  const [document, setDocument] = useState<CircuitDocument>(() => createLessonDocument('motor-jog', { wired: true })); const [saved, setSaved] = useState<SavedCircuit | null>(null); const [documentKey, setDocumentKey] = useState('initial'); const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [query, setQuery] = useState(''); const [category, setCategory] = useState('all'); const [difficulty, setDifficulty] = useState('all');
  const [previewLesson, setPreviewLesson] = useState(''); const [componentDetail, setComponentDetail] = useState<ComponentDefinition | null>(null); const [publication, setPublication] = useState<Publication | null>(null);
  const [profileTab, setProfileTab] = useState('publications'); const [refresh, setRefresh] = useState(0); const [profileEdit, setProfileEdit] = useState(false); const [name, setName] = useState(''); const [bio, setBio] = useState('');
  const [invites, setInvites] = useState<{ id: string; expiresAt: number; consumedBy?: string }[]>([]); const [members, setMembers] = useState<(Member & { disabled?: boolean })[]>([]); const [inviteUrl, setInviteUrl] = useState('');
  const [conflict, setConflict] = useState(false); const [confirmAction, setConfirmAction] = useState<null | { title: string; message: string; run: () => void }>(null);
  const boundary = useRef(new WorkspaceBoundary());
  const recoveredWorkspace = useRef(false);
  const publicationRequest = useRef(0);
  const working = useRef<RecoveryState>({document,saved,dirty}); working.current = {document,saved,dirty};
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  function writeRecovery(ownerId: string, state: RecoveryState) { try { localStorage.setItem(draftKey(ownerId), JSON.stringify(state)); } catch { setError('浏览器恢复空间不足，请及时保存草稿或导出电路'); } }
  function switchAccount(next: Member | null) {
    setEditorRunning(false);
    const previous = boundary.current.capture();
    if (previous.ownerId === (next?.id ?? null)) { setUser(next); return; }
    if (previous.ownerId && hydratedFor === previous.ownerId) writeRecovery(previous.ownerId, working.current);
    boundary.current.enter(next?.id ?? null); recoveredWorkspace.current = false;
    const fresh = {document:createLessonDocument('motor-jog',{wired:true}),saved:null,dirty:false};
    working.current=fresh;setDocument(fresh.document);setSaved(null);setDirty(false);setDocumentKey(crypto.randomUUID());setHydratedFor(null);
    setInvites([]);setMembers([]);setInviteUrl('');setPublication(null);setPreviewLesson('');setComponentDetail(null);setProfileTab('publications');setProfileEdit(false);setName('');setBio('');setConflict(false);setConfirmAction(null);setNotice('');setError('');setBusy(false);
    setUser(next);
  }
  function editDocument(next: CircuitDocument) { if (editorRunning) return; working.current={...working.current,document:next,dirty:true};setDocument(next);setDirty(true); }
  function useProjectDrawing(mediaId: string, project: Project, kind: DrawingKind = 'schematic') {
    if (editorRunning) return;
    const slots = project.drawings ?? {schematic: project.media, layout: null};
    const attachments: CircuitDocument['projectDrawings'] = {};
    for (const slot of ['schematic', 'layout'] as const) {
      const media = slots[slot];
      if (media) attachments[slot] = {mediaId: media.id, type: media.type as DrawingMediaType};
    }
    const selected = slots[kind];
    if (!selected || selected.id !== mediaId) { setError('所选图纸已变化，请重新选择'); return; }
    boundary.current.replace();
    editDocument({...working.current.document, title:project.title,
      lessonId:project.lessonId && getLesson(project.lessonId) ? project.lessonId : undefined,
      referenceDiagramId:undefined, drawingMediaId:mediaId, drawingMediaType:selected.type as DrawingMediaType,
      projectDrawings:attachments, drawingKind:kind, trainingProjectId:project.id});
    setDocumentKey(crypto.randomUUID());
  }
  function practiceLesson(id: string, wired = false) {
    const current = working.current.document;
    if (current.lessonId === id && current.projectDrawings) {
      adopt({...createLessonDocument(id,{wired}),projectDrawings:current.projectDrawings,drawingKind:current.drawingKind,drawingMediaId:current.drawingMediaId,drawingMediaType:current.drawingMediaType});
    } else if (id.startsWith('motor-course-') && !STATIC_DEMO) {
      const token=boundary.current.capture(),snapshot=JSON.stringify(current);
      void run(async()=>{
        const result=await accountApi<{items:Project[]}>('/training-projects');
        if(!boundary.current.acceptsWorkspace(token)||JSON.stringify(working.current.document)!==snapshot)return;
        const project=result.items.find(item=>item.lessonId===id);
        if(project)openProjectCourse(project,wired);else adopt(createLessonDocument(id,{wired}));
      });
    } else adopt(createLessonDocument(id,{wired}));
  }
  function openProjectCourse(project: Project, wired: boolean) {
    if (!project.lessonId || !getLesson(project.lessonId)) {setError('此项目的仿真尚未开放');return;}
    const next = createLessonDocument(project.lessonId,{wired});
    const slots = project.drawings ?? {schematic:project.media,layout:null};
    const attachments: CircuitDocument['projectDrawings'] = {};
    for (const kind of ['schematic','layout'] as const) if(slots[kind]) attachments[kind]={mediaId:slots[kind].id,type:slots[kind].type as DrawingMediaType};
    adopt({...next,trainingProjectId:project.id,projectDrawings:attachments,drawingKind:'schematic',drawingMediaId:attachments.schematic?.mediaId,drawingMediaType:attachments.schematic?.type});
  }
  function selectCurrentDrawing(kind: DrawingKind) {
    if (editorRunning) return;
    const current = working.current.document, attachment = current.projectDrawings?.[kind];
    editDocument({...current, drawingKind:kind, drawingMediaId:attachment?.mediaId, drawingMediaType:attachment?.type});
  }
  async function accountApi<T>(path:string,init?:RequestInit):Promise<T> {
    const token=boundary.current.capture();
    if(token.ownerId!==(user?.id??null))throw new Error('账号已切换，请重新操作');
    const result=await api<T>(path,init);
    if(!boundary.current.acceptsSession(token))throw new Error('账号已切换，已忽略旧请求结果');
    return result;
  }
  useEffect(() => {
    let active=true;
    const readLocation = () => { const path = STATIC_DEMO ? location.hash.slice(1) : location.pathname.slice(1); const next = !path || path === 'circuit' || path === 'circuit/' ? 'simulator' : path; if (NAV.some(n => n.id === next)) setSection(next as Section); };
    readLocation(); addEventListener('popstate', readLocation); addEventListener('hashchange', readLocation); addEventListener(APP_LOCATION_CHANGED, readLocation);
    if (STATIC_DEMO) { switchAccount({ id: 'demo', name: '静态演示', username: 'demo', role: 'demo' }); setLoading(false); }
    else api<{user: Member | null}>('/session').then(r => {if(active)switchAccount(r.user);}).catch(e => {if(active)setError(e.message);}).finally(() => {if(active)setLoading(false);});
    return () => { active=false;removeEventListener('popstate', readLocation); removeEventListener('hashchange', readLocation); removeEventListener(APP_LOCATION_CHANGED, readLocation); };
  }, []);
  useEffect(() => {
    if (!user) return;
    const token=boundary.current.capture();if(token.ownerId!==user.id)return;
    try { const recovery=readRecovery(localStorage.getItem(draftKey(user.id)));if(recovery){recoveredWorkspace.current=true;boundary.current.replace();working.current=recovery;setDocument(recovery.document);setSaved(recovery.saved);setDirty(recovery.dirty);setDocumentKey(crypto.randomUUID());} }
    catch(e) { setError((e as Error).message); }
    setHydratedFor(user.id);
  }, [user?.id]);
  useEffect(() => {
    if (!user || hydratedFor !== user.id || STATIC_DEMO) return;
    const intent = parseReferenceEntry(location.pathname, location.search);
    if (intent.kind === 'none') return;
    // Consume the URL once. From here, the account's persisted document is authoritative.
    navigateAppLocation('/', { replace: true }); setSection('simulator');
    if (intent.kind === 'invalid') { setError('参考图纸链接无效，已保留当前接线'); return; }
    const current = working.current;
    const decision = resolveReferenceEntry({ requestedId: intent.id, currentDocument: current.document, hasRecovery: recoveredWorkspace.current, dirty: current.dirty, saved: current.saved });
    if (decision === 'preserve') return;
    const token = boundary.current.capture();
    const apply = () => { if (boundary.current.acceptsWorkspace(token)) adopt(createReferenceDocument(intent.id)); };
    if (decision === 'confirm') setConfirmAction({ title: '打开参考图纸', message: '此链接将新建七个未接线器件。当前接线尚未保存，请先保存需要保留的内容。', run: apply });
    else apply();
  }, [hydratedFor, user?.id]);
  useEffect(() => { if (!user || hydratedFor!==user.id || !dirty) return;const token=boundary.current.capture();const timer=setTimeout(()=>{if(boundary.current.acceptsWorkspace(token))writeRecovery(user.id,working.current);},350);return()=>clearTimeout(timer); }, [document,user?.id,hydratedFor,dirty,saved]);
  useEffect(() => { const before=(event:BeforeUnloadEvent)=>{const token=boundary.current.capture();if(working.current.dirty){if(token.ownerId&&hydratedFor===token.ownerId)writeRecovery(token.ownerId,working.current);event.preventDefault();}};addEventListener('beforeunload',before);return()=>removeEventListener('beforeunload',before); }, [hydratedFor]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(t); }, [notice]);
  useEffect(() => {
    setQuery(''); setCategory('all');
    if (!user || STATIC_DEMO || section !== 'profile' || profileTab !== 'admin' || user.role !== 'admin') return;
    const token = boundary.current.capture(); let active = true;
    const current = () => active && boundary.current.acceptsSession(token);
    const report = (reason: Error) => { if (current()) setError(reason.message); };
    api<{items: typeof invites}>('/invites').then(result => { if (current()) setInvites(result.items); }).catch(report);
    api<{items: typeof members}>('/members').then(result => { if (current()) setMembers(result.items); }).catch(report);
    return () => { active = false; };
  }, [section, user?.id, profileTab, refresh]);
  const navigate = (next: Section) => { publicationRequest.current++; if (next !== 'simulator') setEditorRunning(false); setSection(next); setPublication(null); if (STATIC_DEMO) location.hash = next; else navigateAppLocation(next === 'simulator' ? '/' : `/${next}`); };
  const run = async (task: () => Promise<void>) => { const token=boundary.current.capture();setBusy(true);setError('');try{await task();}catch(e){if(boundary.current.acceptsSession(token))setError((e as Error).message);}finally{if(boundary.current.acceptsSession(token))setBusy(false);} };
  function adopt(doc: CircuitDocument, record: SavedCircuit | null = null) {
    const checked=validateDocument(doc);if(!checked.valid){setError(checked.errors.join('；'));return;}
    if(boundary.current.capture().ownerId!==user?.id)return;
    boundary.current.replace();const next={document:doc,saved:record,dirty:false};working.current=next;setDocument(doc);setSaved(record);setDirty(false);setDocumentKey(crypto.randomUUID());setPublication(null);if(user)writeRecovery(user.id,next);navigate('simulator');
  }
  function replace(action: () => void) { if (working.current.dirty) setConfirmAction({ title: '保留当前接线', message: '当前电路尚未保存。继续将替换工作区内容，请先保存需要保留的接线。', run: action }); else action(); }
  async function save(asNew = false): Promise<SavedCircuit> {
    if(!user||hydratedFor!==user.id)throw new Error('工作区正在恢复，请稍后保存');
    const token=boundary.current.capture(),submitted=structuredClone(working.current.document),record=working.current.saved;
    const accept=(item:SavedCircuit)=>{
      if(!boundary.current.acceptsWorkspace(token))return;
      const next=recoveryAfterSave(working.current.document,submitted,item);working.current=next;setSaved(item);setDirty(next.dirty);writeRecovery(user.id,next);setNotice(next.dirty?'已保存提交时的版本，后续修改仍待保存':STATIC_DEMO?'已保存在此浏览器':'已保存到草稿箱');
    };
    if(STATIC_DEMO){const item={id:!asNew&&record?record.id:crypto.randomUUID(),title:submitted.title,document:submitted,revision:!asNew&&record?record.revision+1:1,createdAt:!asNew&&record?record.createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};const items:SavedCircuit[]=JSON.parse(localStorage.getItem(LOCAL_KEY)||'[]');localStorage.setItem(LOCAL_KEY,JSON.stringify([item,...items.filter(x=>x.id!==item.id)]));accept(item);return item;}
    try{const result=await accountApi<{circuit:SavedCircuit}>(!asNew&&record?`/circuits/${record.id}`:'/circuits',jsonBody({title:submitted.title,document:submitted,revision:!asNew?record?.revision:undefined,mediaIds:documentMediaIds(submitted)},!asNew&&record?'PUT':'POST'));accept(result.circuit);return result.circuit;}catch(e){if(boundary.current.acceptsWorkspace(token)&&e instanceof ApiError&&e.status===409)setConflict(true);throw e;}
  }
  async function publish() { if(STATIC_DEMO){setNotice('静态演示不提供成员发布，请使用本地完整版');return;}const token=boundary.current.capture(),item=await save();if(!boundary.current.acceptsWorkspace(token))return;const result=await accountApi<{publication:Publication}>(`/circuits/${item.id}/publish`,jsonBody({revision:item.revision,mediaIds:documentMediaIds(item.document)}));if(!boundary.current.acceptsWorkspace(token))return;setNotice(working.current.dirty?'已发布提交时的快照，当前后续修改仍待保存':'已发布独立快照，后续草稿修改不会改变作品');setRefresh(x=>x+1);navigate('gallery');navigateAppLocation(galleryHref({...emptyGalleryRoute(),publicationId:result.publication.id}),{replace:true}); }
  async function openDraft(item: SavedCircuit) { const token=boundary.current.capture(),snapshot=JSON.stringify(working.current.document);const result=STATIC_DEMO?item:(await accountApi<{circuit:SavedCircuit}>(`/circuits/${item.id}`)).circuit;if(!boundary.current.acceptsWorkspace(token))return;if(snapshot!==JSON.stringify(working.current.document)){setError('加载期间电路已发生修改，请重新打开草稿');return;}adopt(result.document,result); }
  async function forkPublication(id:string){const token=boundary.current.capture(),snapshot=JSON.stringify(working.current.document);const result=await accountApi<{circuit:SavedCircuit}>(`/publications/${id}/fork`,jsonBody({}));if(!boundary.current.acceptsWorkspace(token))return;if(snapshot!==JSON.stringify(working.current.document)){setNotice('副本已保存到草稿箱；当前画布有新修改，未替换');return;}adopt(result.circuit.document,result.circuit);setNotice('已复制为你的私有草稿');}
  async function viewPublication(id: string) { const request=++publicationRequest.current; const result=await accountApi<{publication:Publication}>(`/publications/${id}`);if(request===publicationRequest.current)setPublication(result.publication); }
  async function reactTo(item: Publication, kind: 'like'|'favorite') { const result=await accountApi<{publication:Publication}>(`/publications/${item.id}/${kind}`,jsonBody({active:!(kind==='like'?item.liked:item.favorited)}));setRefresh(value=>value+1);setPublication(current=>current?.id===item.id?result.publication:current); }
  const filteredLessons = LESSONS.filter(l => (category === 'all' || l.category===category) && (difficulty==='all' || (difficulty==='basic' ? l.id !== 'motor-self-hold' : l.id==='motor-self-hold')) && (l.title+l.description).includes(query));
  const filteredComponents = CATALOG.filter(c => (category==='all'||c.category===category) && (c.name+c.description).includes(query));
  if (loading) return <div className="dt-loading"><Brand/><p>正在连接实训工作台…</p></div>;
  if (!user) return <><Login ready={member=>{switchAccount(member);setSection(location.pathname==='/gallery'?'gallery':'simulator');}}/>{error && <div className="dt-global-error" role="alert">{error}</div>}</>;
  if(hydratedFor!==user.id)return <div className="dt-loading"><Brand/><p>正在恢复当前账号的工作区…</p></div>;
  return <div className="dt-site"><header className="dt-header"><button className="dt-brand-button" onClick={()=>navigate('simulator')}><Brand/></button><nav aria-label="主导航">{NAV.map(({id,label,icon:Icon})=><a key={id} href={STATIC_DEMO?`#${id}`:id==='simulator'?'/':`/${id}`} aria-current={section===id?'page':undefined} onClick={e=>{e.preventDefault();navigate(id);}}><Icon size={18}/>{label}</a>)}</nav><button className="dt-account" onClick={()=>navigate('profile')}><span className="dt-avatar">{user.name.slice(0,1)}</span><span>{user.name}</span></button></header>
    {STATIC_DEMO && <div className="dt-demo-notice">静态演示 · 电路保存在此浏览器，成员账号与广场请使用本地完整版</div>}
    {error && <div className="dt-banner" role="alert">{error}<button onClick={()=>setError('')} aria-label="关闭错误"><X size={16}/></button></div>}
    {section==='simulator' && <><details className="dt-document-bar dt-document-disclosure"><summary><FilePlus2 size={16}/><strong>{document.title}</strong><span>课程与草稿</span></summary><fieldset className="dt-document-controls" disabled={editorRunning}><input aria-label="电路标题" value={document.title} maxLength={100} onChange={e=>editDocument({...document,title:e.target.value})}/><span className="dt-save-state">{dirty?'有未保存修改':saved?`已保存 · 修订 ${saved.revision}`:'教学示例'}</span><select aria-label="选择训练课程" value={document.lessonId||''} onChange={e=>{const value=e.target.value;replace(()=>value?practiceLesson(value):adopt({schemaVersion:1,title:'未命名电路',components:[],wires:[]}));}}><option value="">自由接线</option>{LESSONS.map(l=><option value={l.id} key={l.id}>{l.title}</option>)}</select><button onClick={()=>replace(()=>document.referenceDiagramId && !document.lessonId ? adopt(createReferenceDocument(document.referenceDiagramId)) : practiceLesson(document.lessonId||'motor-jog'))}>清空接线练习</button><button disabled={!document.lessonId} onClick={()=>replace(()=>practiceLesson(document.lessonId!,true))}>载入示范接线</button><button onClick={()=>replace(()=>adopt({schemaVersion:1,title:'未命名电路',components:[],wires:[]}))}>新建电路</button></fieldset></details><SimulatorEditor referenceVideoAllowed={referencePreviewAllowed} onRunningChange={setEditorRunning} document={document} documentKey={documentKey} onDocumentChange={editDocument} onSave={()=>save().then(()=>{})} onPublish={publish} onAssess={STATIC_DEMO?async doc=>assessLesson(doc,doc.lessonId):assessOnServer} onImportDrawing={async file=>{ if(STATIC_DEMO) throw new Error('静态演示请使用电路 JSON 导入；附件上传需要本地完整版'); const token=boundary.current.capture();const form=new FormData();form.append('file',file);const r=await accountApi<{media:{id:string;url:string}}>('/media',{method:'POST',body:form});if(!boundary.current.acceptsWorkspace(token))throw new Error('工作区已切换，图纸未应用到当前电路');return r.media; }} drawingType={document.drawingMediaType} drawingUrl={document.drawingMediaId?`/api/media/${document.drawingMediaId}`:undefined} renderSchematic={(preview,selectionRevision)=><TrainingProjects onPreviewContextChange={setReferencePreviewAllowed} documentKey={`${documentKey}:${document.referenceDiagramId??''}:${selectionRevision}`} user={user} readOnly={editorRunning} selectedProjectId={document.trainingProjectId} currentDrawings={document.projectDrawings ? Object.fromEntries(Object.entries(document.projectDrawings).map(([kind, attachment]) => [kind, {id:attachment.mediaId,type:attachment.type,url:`/api/media/${attachment.mediaId}`}])) : undefined} currentKind={document.drawingKind} onSelectCurrentDrawing={selectCurrentDrawing} onUseDrawing={useProjectDrawing} fallback={preview??(document.lessonId?<LessonSchematic lessonId={document.lessonId}/>:<p className="dt-hint">自由接线没有指定课程，可上传图纸作为参考。</p>)}/> }/></>}
    {section==='drawings' && <ReferenceDrawings onReferencePractice={id=>replace(()=>adopt(createReferenceDocument(id)))} onPractice={(id,wired)=>replace(()=>adopt(createLessonDocument(id,{wired})))} onProjectPractice={(project,wired)=>replace(()=>openProjectCourse(project,wired))}/>}
    {section==='gallery' && <Gallery key={user.id} request={accountApi} busy={busy} onPractice={()=>navigate('simulator')} onFork={id=>replace(()=>{void run(()=>forkPublication(id));})}/>}
    {section==='components' && <main className="dt-page"><div className="dt-page-heading"><div><h1>元器件百科</h1><p>认识器件，理解每一个端子的作用</p></div><label className="dt-search"><Search size={18}/><input placeholder="搜索元器件" value={query} onChange={e=>setQuery(e.target.value)}/></label></div><div className="dt-encyclopedia"><aside>{[['all','全部'],['power','电源保护'],['industrial','工业控制'],['lighting','照明器件'],['terminals','接线端子']].map(([id,label])=><button className={category===id?'active':''} key={id} onClick={()=>setCategory(id)}>{label}</button>)}</aside><div className="dt-device-grid">{filteredComponents.map(c=><button key={c.type} className="dt-device-card" onClick={()=>setComponentDetail(c)}><DeviceArtwork type={c.type}/><div><h3>{c.name}</h3><p>{c.description}</p><small>{c.terminals.length} 个可接线端子　查看详情 →</small></div></button>)}</div></div></main>}
    {section==='profile' && <main className="dt-profile"><aside className="dt-profile-card"><div className="dt-profile-avatar"><UserRound size={58}/></div><h2>{user.name}</h2><p>@{user.username}</p><dl><dt>账号角色</dt><dd>{user.role==='admin'?'管理员':user.role==='demo'?'演示访客':'实训成员'}</dd><dt>个人签名</dt><dd>{user.bio||'还没有填写签名'}</dd></dl><button onClick={()=>{setName(user.name);setBio(user.bio||'');setProfileEdit(true);}}>编辑资料</button>{!STATIC_DEMO && <ChangePassword key={user.id} request={accountApi} onChanged={()=>setNotice('密码已修改')}/>}{!STATIC_DEMO && <button onClick={()=>run(async()=>{await accountApi('/auth/sign-out',jsonBody({}));switchAccount(null);})}><LogOut size={16}/>退出登录</button>}</aside><section className="dt-profile-content"><div className="dt-tabs">{[['publications','我的电路'],['drafts','草稿箱'],['favorites','收藏图纸'],...(user.role==='admin'?[['admin','邀请与成员']]:[])].map(([id,label])=><button className={profileTab===id?'active':''} onClick={()=>setProfileTab(id)} key={id}>{label}</button>)}</div>{profileTab==='admin'?<div className="dt-admin"><h2>邀请成员</h2><p>邀请一次有效，默认 7 天后过期。</p><button className="dt-primary" disabled={busy} onClick={()=>run(async()=>{const r=await accountApi<{invite:{url:string}}>('/invites',jsonBody({expiresInHours:168}));setInviteUrl(r.invite.url);setRefresh(x=>x+1);})}>创建邀请</button>{inviteUrl&&<label className="dt-invite-link">复制邀请链接<input readOnly value={inviteUrl} onFocus={e=>e.target.select()}/><button onClick={()=>run(async()=>{await navigator.clipboard.writeText(inviteUrl);setNotice('邀请链接已复制');})}><Copy size={16}/>复制</button></label>}<table><thead><tr><th>邀请</th><th>有效期</th><th>状态</th></tr></thead><tbody>{invites.map(i=><tr key={i.id}><td>{i.id.slice(0,8)}</td><td>{date(i.expiresAt)}</td><td>{i.consumedBy?`已被 ${i.consumedBy} 使用`:i.expiresAt<Date.now()?'已过期':'待使用'}</td></tr>)}</tbody></table><h2>成员管理</h2><table><thead><tr><th>成员</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>{members.map(m=><tr key={m.id}><td>{m.name}（{m.username}）</td><td>{m.role==='admin'?'管理员':'成员'}</td><td>{m.disabled?'已停用':'正常'}</td><td>{m.id!==user.id&&<button onClick={()=>run(async()=>{await accountApi(`/members/${m.id}`,jsonBody({disabled:!m.disabled},'PATCH'));setRefresh(x=>x+1);})}>{m.disabled?'恢复':'停用'}</button>}</td></tr>)}</tbody></table></div> :<ProfileLibrary key={`${user.id}:${profileTab}`} ownerId={user.id} tab={profileTab as 'drafts'|'publications'|'favorites'} refresh={refresh} busy={busy} request={accountApi} onNew={()=>replace(()=>adopt({schemaVersion:1,title:'未命名电路',components:[],wires:[]}))} onOpenDraft={item=>replace(()=>{void run(()=>openDraft(item));})} onOpenPublication={id=>{void run(()=>viewPublication(id));}} onDeleteDraft={item=>setConfirmAction({title:'删除草稿',message:`删除“${item.title}”？已经发布的作品快照会保留。`,run:()=>{void run(async()=>{
      if(STATIC_DEMO){const items:SavedCircuit[]=JSON.parse(localStorage.getItem(LOCAL_KEY)||'[]');localStorage.setItem(LOCAL_KEY,JSON.stringify(items.filter(value=>value.id!==item.id)));}
      else await accountApi(`/circuits/${item.id}`,jsonBody({revision:item.revision},'DELETE'));
      if(working.current.saved?.id===item.id){boundary.current.replace();const next={...working.current,saved:null,dirty:true};working.current=next;setSaved(null);setDirty(true);writeRecovery(user.id,next);}
      setRefresh(value=>value+1);
    });}})}/>}</section></main>}
    {previewLesson && <Modal title={getLesson(previewLesson)?.title||'图纸预览'} close={()=>setPreviewLesson('')}><div className="dt-large-schematic"><LessonSchematic lessonId={previewLesson}/></div><p>{getLesson(previewLesson)?.objective}</p><div className="dt-modal-actions"><button onClick={()=>{const id=previewLesson;setPreviewLesson('');replace(()=>adopt(createLessonDocument(id,{wired:true})));}}>查看示范接线</button><button className="dt-primary" onClick={()=>{const id=previewLesson;setPreviewLesson('');replace(()=>adopt(createLessonDocument(id)));}}>进入电路配置</button></div></Modal>}
    {componentDetail && <Modal title={componentDetail.name} close={()=>setComponentDetail(null)}><div className="dt-component-detail"><DeviceArtwork type={componentDetail.type}/><p>{componentDetail.description}</p></div><table><thead><tr><th>端子 ID</th><th>标识</th><th>用途</th></tr></thead><tbody>{componentDetail.terminals.map(t=><tr key={t.id}><td>{t.id}</td><td>{t.label}</td><td>{{phase:'相线',neutral:'中性线',earth:'保护接地',contact:'触点',coil:'线圈',load:'负载'}[t.electrical||'contact']}</td></tr>)}</tbody></table><p className="dt-hint">仿真按端子属性与连接关系计算；改变导线颜色不会改变相位。</p></Modal>}
    {publication && <Modal title={publication.title} close={()=>{publicationRequest.current++;setPublication(null);}}><p>作者：{publication.author.name} · {date(publication.createdAt)}</p><div className="dt-publication-preview"><DocumentPreview document={publication.document}/></div><div className="dt-modal-actions"><button disabled={busy} onClick={()=>run(()=>reactTo(publication,'like'))}><Heart size={16}/>{publication.liked?'已点赞':'点赞'} {publication.likes}</button><button disabled={busy} onClick={()=>run(()=>reactTo(publication,'favorite'))}><Star size={16}/>{publication.favorited?'已收藏':'收藏'} {publication.favorites}</button><button className="dt-primary" onClick={()=>replace(()=>{void run(()=>forkPublication(publication.id));})}>复制到我的草稿并打开</button></div><p className="dt-hint">此作品保存的是发布时的独立接线快照。</p></Modal>}
    {profileEdit && <Modal title="编辑个人资料" close={()=>setProfileEdit(false)}><form onSubmit={e=>{e.preventDefault();void run(async()=>{if(STATIC_DEMO) setUser({...user,name,bio});else {const r=await accountApi<{user:Member}>('/me',jsonBody({name,bio},'PATCH'));setUser(r.user);}setProfileEdit(false);setNotice('资料已更新');});}}><label>昵称<input required value={name} maxLength={40} onChange={e=>setName(e.target.value)}/></label><label>个人签名<textarea value={bio} maxLength={500} onChange={e=>setBio(e.target.value)}/></label><button className="dt-primary" disabled={busy}>保存资料</button></form></Modal>}
    {conflict && <Modal title="草稿存在更新" close={()=>setConflict(false)}><p>此草稿已在其他窗口修改。当前内容不会覆盖新的修订。</p><div className="dt-modal-actions"><button onClick={()=>run(async()=>{await save(true);setConflict(false);})}>将当前内容另存为副本</button><button className="dt-primary" onClick={()=>run(async()=>{if(saved)await openDraft(saved);setConflict(false);})}>加载服务器最新版本</button></div></Modal>}
    {confirmAction && <Modal title={confirmAction.title} close={()=>setConfirmAction(null)}><p>{confirmAction.message}</p><div className="dt-modal-actions"><button onClick={()=>setConfirmAction(null)}>取消</button><button className="dt-primary" onClick={()=>{const action=confirmAction;setConfirmAction(null);action.run();}}>继续</button></div></Modal>}
    {notice && <div className="dt-toast" role="status">{notice}</div>}
  </div>;
}
