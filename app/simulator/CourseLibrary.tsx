import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api, STATIC_DEMO } from './api';
import { COURSE_PROJECTS, selectableProjects } from './course-projects';
import { getLesson } from './core/lessons';
import type { Project, DrawingKind } from './TrainingProjects';
import DrawingViewer from './DrawingViewer';
import Modal from './Modal';

export default function CourseLibrary({onPractice}:{onPractice:(project:Project,wired:boolean)=>void}) {
  const [projects,setProjects]=useState<Project[]>(COURSE_PROJECTS),[error,setError]=useState(''),[loading,setLoading]=useState(!STATIC_DEMO);
  const [query,setQuery]=useState(''),[level,setLevel]=useState('all'),[preview,setPreview]=useState<Project|null>(null),[kind,setKind]=useState<DrawingKind>('schematic');
  useEffect(()=>{let active=true;if(!STATIC_DEMO)api<{items:Project[]}>('/training-projects').then(result=>{if(active)setProjects(selectableProjects(result.items));}).catch(reason=>{if(active)setError(reason.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  const difficulty=(id:string)=>Number(id.slice(-2))<=3?'basic':Number(id.slice(-2))<=7?'intermediate':'advanced';
  const found=projects.filter(project=>(level==='all'||difficulty(project.id)===level)&&project.name.includes(query));
  const media=preview?.drawings?.[kind] ?? (kind==='schematic'?preview?.media:null);
  const lesson=preview?.lessonId?getLesson(preview.lessonId):undefined;
  return <>
    <div className="dt-reference-filter"><div role="tablist" aria-label="课程难度">{[['all','全部图纸'],['basic','基础控制'],['intermediate','联锁控制'],['advanced','定时与变速']].map(([id,label])=><button key={id} role="tab" aria-selected={level===id} className={level===id?'active':''} onClick={()=>setLevel(id)}>{label}({projects.filter(project=>id==='all'||difficulty(project.id)===id).length})</button>)}</div><label className="dt-search"><Search size={16}/><input placeholder="搜索课程名称" value={query} onChange={event=>setQuery(event.target.value)}/></label></div>
    {STATIC_DEMO&&<p className="dt-hint">静态演示支持十课接线练习和示范。课程原图需登录成员站查看。</p>}
    {error&&<p className="dt-error" role="alert">{error}</p>}{loading&&<p className="dt-empty">正在读取课程图纸…</p>}
    <div className="dt-reference-grid">{found.map(project=><button className="dt-reference-card" key={project.id} onClick={()=>{setPreview(project);setKind('schematic');}}>{project.media?.type.startsWith('image/')?<img src={project.media.url} alt={project.name}/>:<div className="dt-empty">{project.media?'PDF 原理图':STATIC_DEMO?'成员站查看原图':'原理图待上传'}</div>}<span>{project.name}</span></button>)}</div>
    {!loading&&!found.length&&!error&&<p className="dt-empty">没有找到匹配课程</p>}
    {preview&&<Modal className="dt-modal dt-reference-modal" title={preview.name} onClose={()=>setPreview(null)}><header><h2>{preview.name}</h2><button aria-label="关闭课程图纸" onClick={()=>setPreview(null)}><X size={20}/></button></header><div className="dt-tabs" role="tablist" aria-label="课程图纸类型">{(['schematic','layout'] as const).map(value=><button key={value} role="tab" aria-selected={kind===value} className={kind===value?'active':''} onClick={()=>setKind(value)}>{value==='schematic'?'原理图':'元件布置图'}</button>)}</div>{media?<DrawingViewer key={`${preview.id}-${kind}-${media.id}`} src={media.url} type={media.type} title={`${preview.name} · ${kind==='schematic'?'原理图':'元件布置图'}`}/>:<p className="dt-empty">{STATIC_DEMO?'课程原图需登录成员站查看':'此类图纸尚未上传'}</p>}<p>{lesson?.objective}</p><div className="dt-modal-actions">{lesson?<><button onClick={()=>{onPractice(preview,true);setPreview(null);}}>查看示范接线</button><button className="dt-primary" onClick={()=>{onPractice(preview,false);setPreview(null);}}>进入电路配置</button></>:<p className="dt-hint">本项目的动作仿真正在扩展。</p>}</div></Modal>}
  </>;
}
