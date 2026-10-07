import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(import.meta.dirname, '..');
export const DRAWING_DIRECTORY = path.join(ROOT, '.local/terminal-wiring-20261007/drawings');
const ORIGINAL_DIRECTORY = 'C:/Users/admin/Desktop/电气控制技术课程图纸10/电气控制技术课程图纸10';
const STEMS = ['电动机点动控制电路','电动机连续运行控制电路','点动与连续运行电路','接触器互锁正反转电路','双重联锁正反转控制电路','自动往返控制电路','顺序控制电路','延时起动控制电路','Y-△降压起动控制电路','双速电机运行控制电路'];
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const key = (id, terminal) => `${id}::${terminal}`;
const line = (x1,y1,x2,y2,extra='') => `<path d="M${x1},${y1}L${x2},${y2}" ${extra}/>`;
const text = (x,y,value,size=15,extra='') => `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${esc(value)}</text>`;
const painted = extra => extra.replace(/fill="([^"]+)"/g,'style="fill:$1"');
const circle = (x,y,r=3,extra='') => `<circle cx="${x}" cy="${y}" r="${r}" ${painted(extra)}/>`;
const rect = (x,y,w,h,extra='') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${painted(extra)}/>`;
const hash = value => createHash('sha256').update(value).digest('hex');

export async function loadDrawingCore() {
  const result = await build({stdin:{contents:'export * from "./app/simulator/core/lessons";export * from "./app/simulator/core/catalog";export * from "./app/simulator/core/terminal-wiring";export * from "./app/simulator/core/validation";',resolveDir:ROOT},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

/** Only physical wires form a named node here. Contacts and motor windings never merge nodes. */
export function wireNodes(document) {
  const parent = new Map();
  const find = value => { if(!parent.has(value))parent.set(value,value);if(parent.get(value)!==value)parent.set(value,find(parent.get(value)));return parent.get(value); };
  for(const wire of document.wires){const a=find(key(wire.from.componentId,wire.from.terminalId)),b=find(key(wire.to.componentId,wire.to.terminalId));parent.set(b,a);}
  const groups = new Map();
  for(const terminal of parent.keys()){const root=find(terminal);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(terminal);}
  const ordered=[...groups.values()].map(group=>group.sort()).sort((a,b)=>a[0].localeCompare(b[0]));
  return new Map(ordered.flatMap((group,i)=>group.map(terminal=>[terminal,`N${String(i+1).padStart(2,'0')}`])));
}

function sheet(title,subtitle,width,height,body,metadata) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><metadata>${esc(JSON.stringify(metadata))}</metadata><style>text{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;fill:#172638}path,line,circle,rect{stroke:#263646;stroke-width:1.7;fill:none}text.label{paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round}.wire{stroke-linecap:round;stroke-linejoin:round}.paper{fill:#fff;stroke:none}.section{fill:#eaf0f7;stroke:none}.small{fill:#586575}</style>${rect(0,0,width,height,'class="paper"')}${rect(20,20,width-40,height-40,'rx="3"')}${text(50,65,title,28,'font-weight="700"')}${text(50,96,subtitle,15,'class="small"')}${line(40,116,width-40,116)}${body}${text(50,height-35,'电拓智训 · 2026-10-07 修订 · 二维教学接线示意 · 原始课程 PNG 保留 · 本图由当前课程与端子契约生成',13,'class="small"')}</svg>`;
}

function assignmentsFor(core,document) {
  const assignments=core.getCourseTerminalAssignments(document.lessonId);
  return document.components.filter(c=>c.type==='terminal-strip16').map(strip=>({strip,rows:Array.from({length:16},(_,i)=>{
    const position=i+1,assignment=assignments.find(a=>document.roles?.[a.stripRole]===strip.id&&a.position===position);
    const internal=document.wires.flatMap(w=>[w.from,w.to].filter(ref=>ref.componentId===strip.id&&ref.terminalId===`T${position}`).map(()=>w.from.componentId===strip.id&&w.from.terminalId===`T${position}`?w.to:w.from));
    const external=document.wires.flatMap(w=>[w.from,w.to].filter(ref=>ref.componentId===strip.id&&ref.terminalId===`B${position}`).map(()=>w.from.componentId===strip.id&&w.from.terminalId===`B${position}`?w.to:w.from));
    const label=ref=>`${document.components.find(c=>c.id===ref.componentId)?.label??ref.componentId}:${ref.terminalId}`;
    return {position,assignment,internal:internal.map(label),external:external.map(label)};
  })}));
}

function terminalTables(core,document,x,y,width) {
  const strips=assignmentsFor(core,document),parts=[];
  const tableWidth=(width-24*(strips.length-1))/strips.length;
  for(const [i,{strip,rows}] of strips.entries()){
    const sx=x+i*(tableWidth+24),rowHeight=35;
    parts.push(rect(sx,y,tableWidth,46,'class="section"'),text(sx+12,y+29,`${strip.label} · 16 位分配 / 同号 T-B 永久导通`,19,'font-weight="700"'));
    parts.push(text(sx+8,y+68,'位',13),text(sx+48,y+68,'柜外 B（电源 / 电机 / SQ）',13),text(sx+tableWidth*.32,y+68,'同位内部桥',12),text(sx+tableWidth*.46,y+68,'柜内 T（实际接点）',13));
    for(const row of rows){const ry=y+82+(row.position-1)*rowHeight,bridgeX=sx+tableWidth*.32;parts.push(line(sx,ry, sx+tableWidth,ry,'stroke="#ccd5df"'),text(sx+9,ry+23,row.position,14),text(sx+48,ry+23,row.external.join(' / ')||'备用 · 未接',13),text(sx+tableWidth*.46,ry+23,row.internal.join(' / ')||'备用 · 未接',12),`<g data-fixed-component="${esc(strip.id)}" data-fixed-a="T${row.position}" data-fixed-b="B${row.position}">${line(bridgeX,ry+21,bridgeX+76,ry+21)}${circle(bridgeX,ry+21,3,'fill="#fff"')}${circle(bridgeX+76,ry+21,3,'fill="#fff"')}${text(bridgeX,ry+13,`B${row.position}`,9)}${text(bridgeX+54,ry+13,`T${row.position}`,9)}</g>`);}
  }
  return {svg:parts.join(''),height:82+16*35+12};
}

function permanentConnections(core,document,x,y,width) {
  const items=document.components.flatMap(c=>c.type==='terminal-strip16'?[]:(core.getDefinition(c.type).fixedConnections??[]).map(([a,b])=>({componentId:c.id,label:c.label.replace(/（.*?）/g,''),a,b}))),columns=4,cellWidth=width/columns,parts=[rect(x,y,width,44,'class="section"'),text(x+12,y+28,'其余永久内部连接 · 与上方器件为同一对象，用于核对，不是新增导线',17,'font-weight="700"')];
  for(const [i,pair] of items.entries()){const xx=x+(i%columns)*cellWidth+15,yy=y+75+Math.floor(i/columns)*45;parts.push(`<g data-fixed-component="${esc(pair.componentId)}" data-fixed-a="${esc(pair.a)}" data-fixed-b="${esc(pair.b)}">${text(xx,yy-10,`${pair.label}:${pair.a}`,12)}${text(xx+cellWidth*.58,yy-10,`${pair.label}:${pair.b}`,12)}${line(xx,yy,xx+cellWidth*.78,yy)}${circle(xx,yy,3,'fill="#fff"')}${circle(xx+cellWidth*.78,yy,3,'fill="#fff"')}</g>`);}
  return {svg:parts.join(''),height:75+Math.ceil(items.length/columns)*45};
}

// Contact/coil placement preserves each course's logical reading direction. Connectivity always comes from the document.
function controlPositions(n) {
  const p={};const set=(name,x,y)=>{p[name]=[x,y];};const coil=(id,x,y=8)=>set(`${id}:coil`,x,y);
  set('fu2:fixed-0',0,0);set('fu2:fixed-1',6,0);
  if(n===1){set('sb:no',2,3);coil('km',2,7);return p;}
  set(n===7?'fr1:nc':'fr:nc',2,1);set(n===7?'fr2:nc':n===8||n===9?'sb2:nc':n>=4&&n<=6?'sb3:nc':'sb1:nc',2,2);
  if(n===2){set('sb2:no',1,4);set('km:aux-no',3,4);coil('km',2);}
  if(n===3){set('sb2:no',0,4);set('sb3:no',2,4);set('sb3:nc',4,4);set('km:aux-no',4,6);coil('km',2);}
  if(n>=4&&n<=6){set('sb1:no',0,4);set('km1:aux-no',1,4);set('sb2:no',4,4);set('km2:aux-no',5,4);set('km2:aux-nc',1,7);set('km1:aux-nc',5,7);coil('km1',1,9);coil('km2',5,9);
    if(n===5){set('sb2:nc',1,6);set('sb1:nc',5,6);}
    if(n===6){set('sq2:no',2,4);set('sq1:no',6,4);set('sq1:nc',1,5);set('sq2:nc',5,5);set('sq3:nc',1,6);set('sq4:nc',5,6);}
  }
  if(n===7){set('sb1:nc',0,3);set('km2_aux:aux-no',2,3);set('sb2:nc',5,3);set('sb3:no',0,5);set('km1:aux-no',2,5);set('sb4:no',4,5);set('km2:aux-no',6,5);set('km1_aux:aux-no',5,7);coil('km1',1,9);coil('km2',5,9);}
  if(n===8){set('sb1:no',0,4);set('ka:no',2,4);set('kt:delay-no',4,4);set('km:aux-no',6,4);set('km:aux-nc',1,6);coil('ka',0,9);coil('kt',2,9);coil('km',5,9);}
  if(n===9){set('sb1:no',1,3);set('km:aux-no',3,3);set('kmd:aux-nc',3,5);set('kmy:aux-nc',5,5);set('kt:delay-nc',3,7);set('kt:delay-no',5,7);set('kmd:aux-no',6,7);coil('km',0,10);coil('kt',2,10);coil('kmy',3,10);coil('kmd',5,10);}
  if(n===10){set('sb2:no',0,4);set('km1:aux-no',1,4);set('sb3:no',4,4);set('km2:aux-no',5,4);set('sb3:nc',1,6);set('sb2:nc',5,6);set('km2:aux-nc',1,7);set('km1:aux-nc',5,7);coil('km1',1,9);coil('km2',4,9);coil('km3',6,9);}
  return p;
}

export function createSchematicModel(core,document) {
  const components=new Map(document.components.map(c=>[c.id,c])),anchors=new Map(),blocks=[],symbols=[],represented=new Set(),nodes=wireNodes(document);
  const n=Number(document.lessonId.slice(-2));
  const get=id=>components.get(document.roles?.[id]??id);
  const shortLabel=c=>c.type==='terminal-strip16'?(c.id===document.roles.xt2?'XT2':'XT1'):c.type==='auxiliary-no'?`${components.get(c.linkedTo)?.label??c.label}辅`:c.label.replace(/（.*?）/g,'');
  const pin=(c,t,x,y,direction)=>{anchors.set(key(c.id,t),{x,y,direction});return circle(x,y,3,'fill="#fff"')+text(x+8,y-6,`${shortLabel(c)}:${t}`,12,'class="label"');};
  const block=(x,y,w,h,title)=>{blocks.push({x,y,w,h});return rect(x,y,w,h,'rx="5" fill="#fff"')+text(x+9,y+24,title.split(' · ')[0].replace(/（.*?）/g,''),17,'font-weight="700"');};
  function triple(role,x,y,kind='contact'){
    const c=get(role);if(!c)return;let svg=block(x,y,280,132,`${c.label} · ${kind==='fuse'?'熔断器':kind==='thermal'?'主回路检测通道':'三极联动触点'}`);
    for(let i=0;i<3;i++){const xx=x+42+i*94,a=String(1+i*2),b=String(2+i*2);svg+=pin(c,a,xx,y,'up')+pin(c,b,xx,y+132,'down')+line(xx,y,xx,y+48)+line(xx,y+84,xx,y+132);svg+=kind==='contact'?line(xx,y+84,xx+16,y+51)+circle(xx,y+48):rect(xx-7,y+48,14,36)+(kind==='thermal'?text(xx+12,y+71,'θ',14):line(xx,y+48,xx,y+84));represented.add(key(c.id,a));represented.add(key(c.id,b));}
    symbols.push(svg);
  }
  const source=get('source');let src=block(130,185,700,94,'三相五线电源 · 380 / 220 V（本课程控制回路用 L1 / L2）');
  for(const [i,t] of ['L1','L2','L3','N','PE'].entries())src+=pin(source,t,190+i*135,279,'down');symbols.push(src);
  const strip=get('xt16');
  function xtGroup(positions,x,y,title){const incoming=positions[0]===1;let svg=block(x,y,Math.max(280,positions.length*92+12),98,'XT1');for(const [i,pos] of positions.entries()){const xx=x+42+i*92;svg+=pin(strip,`${incoming?'B':'T'}${pos}`,xx,y,'up')+pin(strip,`${incoming?'T':'B'}${pos}`,xx,y+98,'down')+line(xx,y,xx,y+98)+rect(xx-8,y+42,16,16,'fill="#edf4ff"')+text(xx+12,y+59,pos,14);represented.add(key(strip.id,`B${pos}`));represented.add(key(strip.id,`T${pos}`));}svg+=text(x+10,y+80,title,12,'class="label"');symbols.push(svg);}
  xtGroup([1,2,3],210,350,'电源进线 1–3');triple('qf',210,525);triple('fu1',210,750,'fuse');
  if(n<=3||n===8||n===9){triple('km',120,975);if(n!==1)triple('fr',120,1195,'thermal');if(n===9){triple('kmd',455,975);triple('kmy',455,1195);}}
  else if(n===10){triple('fr',210,975,'thermal');triple('km1',25,1195);triple('km2',360,1195);triple('km3',690,1195);}
  else{triple('km1',25,975);triple('km2',500,975);triple(n===7?'fr1':'fr',25,1195,'thermal');if(n===7)triple('fr2',500,1195,'thermal');}
  const assignments=assignmentsFor(core,document).find(a=>a.strip.id===strip.id).rows.filter(row=>row.position>3&&row.assignment?.used);
  xtGroup(assignments.map(row=>row.position),90,1460,'电机出线');
  for(const [index,motor] of document.components.filter(c=>core.getDefinition(c.type).load?.kind==='motor').entries()){
    const six=motor.type!=='motor',x=index?505:85,y=1700,w=six?620:330;let svg=block(x,y,w,250,`${motor.label} · ${six?motor.type==='motor-star-delta'?'三组独立绕组 Y / Δ':'六端 Δ / YY 教学模式':'三相电机 3~'}`);
    const ports=six?['U1','V1','W1','U2','V2','W2']:['U','V','W'];
    for(const [i,t] of ports.entries()){const xx=x+35+i*(w-70)/(ports.length-1);svg+=pin(motor,t,xx,y,'up')+line(xx,y,xx,y+50);}
    if(motor.type==='motor-star-delta')for(let i=0;i<3;i++){const xa=x+35+i*110,xb=x+365+i*110,yy=y+82+i*45;svg+=line(xa,y+50,xa,yy)+line(xa,yy,x+260,yy)+rect(x+260,yy-9,60,18)+line(x+320,yy,xb,yy)+line(xb,yy,xb,y+50)+text(x+265,yy-14,['U1–U2','V1–V2','W1–W2'][i],12);}
    else {svg+=circle(x+w/2,y+120,45)+text(x+w/2,y+126,motor.type==='motor-dahlander'?'Δ / YY':'M 3~',22,'text-anchor="middle"')+text(x+w/2,y+185,motor.type==='motor-dahlander'?'仅定义外接模式；不推定厂家内部绕组':'内部绕组结法依实际电机，本图仅表示三端负载',12,'text-anchor="middle"');
      if(!six)svg+=line(x+35,y+50,x+35,y+120)+line(x+35,y+120,x+w/2-45,y+120)+line(x+w/2,y+50,x+w/2,y+75)+line(x+w-35,y+50,x+w-35,y+120)+line(x+w-35,y+120,x+w/2+45,y+120);
      else for(let i=0;i<6;i++){const xx=x+35+i*(w-70)/5,endpoint=x+w/2+(i-2.5)*14;svg+=line(xx,y+50,xx,y+58+i*3)+line(xx,y+58+i*3,endpoint,y+58+i*3)+line(endpoint,y+58+i*3,endpoint,y+120-Math.sqrt(45**2-(endpoint-x-w/2)**2));}
    }
    svg+=pin(motor,'PE',x+w,y+215,'right')+line(x+w,y+215,x+w-28,y+215)+line(x+w-28,y+201,x+w-28,y+229);symbols.push(svg);
  }
  const pe=get('pe');let peSvg=block(935,1690,135,120,'独立 PE');peSvg+=pin(pe,'A',970,1690,'up')+pin(pe,'B',970,1810,'down')+line(970,1690,970,1810);symbols.push(peSvg);
  const cp=controlPositions(n),controlX=1170,controlY=180,dx=140,dy=n===6?190:148;
  const used=new Set(document.wires.flatMap(w=>[key(w.from.componentId,w.from.terminalId),key(w.to.componentId,w.to.terminalId)]));
  for(const c of document.components){const def=core.getDefinition(c.type);if(core.isLayoutObject(c.type)||c.type==='supply'||c.type==='terminal-strip16'||c.type==='pe-terminal'||def.load?.kind==='motor')continue;
    const atoms=[...(def.contacts??[]).filter(a=>!a.id.startsWith('pole')).map(a=>({...a,kind:a.normallyClosed?'nc':'no'})),...(c.id===get('fu2')?.id?(def.fixedConnections??[]).map((terminals,i)=>({id:`fixed-${i}`,terminals,kind:'fuse'})):[]),...(def.load?.kind==='coil'?[{id:'coil',terminals:def.load.terminals,kind:'coil'}]:[])];
    for(const atom of atoms){if(!atom.terminals.every(t=>used.has(key(c.id,t))))continue;const role=Object.entries(document.roles??{}).find(([,id])=>id===c.id)?.[0]??c.id;const position=cp[`${role}:${atom.id}`];assert.ok(position,`缺少控制符号位置 ${role}:${atom.id}`);const [col,row]=position,x=controlX+col*dx,y=controlY+row*dy,w=94,h=c.type==='limit-switch'?120:96;
      let svg=block(x,y,w,h,shortLabel(c));const xx=x+w/2,a=atom.terminals[0],b=atom.terminals[1];svg+=pin(c,a,xx,y,'up')+pin(c,b,xx,y+h,'down')+line(xx,y,xx,y+36)+line(xx,y+h-24,xx,y+h);
      if(atom.kind==='coil')svg+=rect(xx-20,y+36,40,h-60)+text(xx,y+57,c.type.startsWith('timer')?'KT':'~',14,'text-anchor="middle"');
      else if(atom.kind==='fuse')svg+=rect(xx-8,y+36,16,h-60)+line(xx,y+36,xx,y+h-24);
      else{svg+=circle(xx,y+h-24);if(atom.kind==='nc')svg+=line(xx,y+36,xx+16,y+36)+circle(xx+16,y+36)+line(xx,y+h-24,xx+16,y+36);else svg+=circle(xx,y+36)+line(xx,y+h-24,xx+16,y+39);svg+=text(x+7,y+h-8,atom.kind==='nc'?'NC 常闭':'NO 常开',11);}
      if(c.type.startsWith('timer'))svg+=text(x+w/2,y+h+18,`延时 ${(c.settings?.delayMs??3000)/1000}s`,11,'text-anchor="middle"');symbols.push(svg);
      for(const t of atom.terminals)represented.add(key(c.id,t));
    }
  }
  // SQ terminal transitions are drawn as physical bridges next to the SQ contact.
  const xt2=get('xt2');if(xt2){for(const assignment of core.getCourseTerminalAssignments(document.lessonId).filter(a=>a.stripRole==='xt2'&&a.used)){
    const c=get(assignment.componentRole),anchor=anchors.get(key(c.id,assignment.terminalId));assert.ok(anchor);const up=anchor.direction==='up',y=anchor.y+(up?-33:33),x=anchor.x+(up?-39:39);
    anchors.set(key(xt2.id,`B${assignment.position}`),{x,y,direction:up?'down':'up'});anchors.set(key(xt2.id,`T${assignment.position}`),{x:x+(up?-26:26),y,direction:up?'up':'down'});
    symbols.push(line(x,y,x+(up?-26:26),y)+rect(x+(up?-20:6),y-5,14,10,'fill="#edf4ff"')+text(x+(up?-26:0),y-9,`XT2:${assignment.position}`,11,'class="label"'));
  }}
  for(const wire of document.wires)for(const ref of [wire.from,wire.to])assert.ok(anchors.has(key(ref.componentId,ref.terminalId)),`图纸未表现端子 ${key(ref.componentId,ref.terminalId)}`);
  return {width:2260,bodyHeight:2020,anchors,blocks,symbols,nodes,represented};
}

function routeBetween(a,b,blocks,lanes,occupied,node) {
  const vector={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]},lead=(p)=>({x:p.x+vector[p.direction][0]*18,y:p.y+vector[p.direction][1]*18});
  const start=lead(a),end=lead(b);
  const clear=(p,q)=>!blocks.some(r=>p.x===q.x?p.x>r.x+1&&p.x<r.x+r.w-1&&Math.max(p.y,q.y)>r.y+1&&Math.min(p.y,q.y)<r.y+r.h-1:p.y>r.y+1&&p.y<r.y+r.h-1&&Math.max(p.x,q.x)>r.x+1&&Math.min(p.x,q.x)<r.x+r.w-1);
  const overlapCost=(a,b)=>occupied.reduce((cost,edge)=>{if(edge.node===node)return cost;const c=edge.a,d=edge.b;if(a.x===b.x&&c.x===d.x&&a.x===c.x)return cost+Math.max(0,Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)))*80;if(a.y===b.y&&c.y===d.y&&a.y===c.y)return cost+Math.max(0,Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)))*80;return cost;},0);
  const choices=[[start,{x:start.x,y:end.y},end],[start,{x:end.x,y:start.y},end]];
  for(const x of lanes.x)choices.push([start,{x,y:start.y},{x,y:end.y},end]);
  for(const y of lanes.y)choices.push([start,{x:start.x,y},{x:end.x,y},end]);
  const valid=choices.filter(ps=>ps.slice(1).every((p,i)=>clear(ps[i],p)));
  const length=ps=>ps.slice(1).reduce((s,p,i)=>s+Math.abs(p.x-ps[i].x)+Math.abs(p.y-ps[i].y)+overlapCost(ps[i],p),0);
  if(valid.length)return [a,...valid.sort((p,q)=>length(p)-length(q))[0],b];
  // Visibility graph fallback for paths requiring more than two bends.
  const xs=[...new Set([start.x,end.x,...lanes.x])].sort((p,q)=>p-q),ys=[...new Set([start.y,end.y,...lanes.y])].sort((p,q)=>p-q),id=(x,y)=>`${x},${y}`;
  const points=new Map(),dist=new Map([[id(start.x,start.y),0]]),parent=new Map(),pending=new Set([id(start.x,start.y)]);
  for(const x of xs)for(const y of ys)if(!blocks.some(r=>x>r.x+1&&x<r.x+r.w-1&&y>r.y+1&&y<r.y+r.h-1))points.set(id(x,y),{x,y});
  const target=id(end.x,end.y);while(pending.size){let current;for(const name of pending)if(current===undefined||dist.get(name)<dist.get(current))current=name;pending.delete(current);if(current===target)break;const p=points.get(current);if(!p)continue;const xi=xs.indexOf(p.x),yi=ys.indexOf(p.y);for(const q of [{x:xs[xi-1],y:p.y},{x:xs[xi+1],y:p.y},{x:p.x,y:ys[yi-1]},{x:p.x,y:ys[yi+1]}]){const next=id(q.x,q.y);if(!points.has(next)||!clear(p,q))continue;const cost=dist.get(current)+Math.abs(p.x-q.x)+Math.abs(p.y-q.y)+overlapCost(p,q);if(cost<(dist.get(next)??Infinity)){dist.set(next,cost);parent.set(next,current);pending.add(next);}}}
  assert.ok(dist.has(target),`原理图无法路由 ${JSON.stringify({a,b})}`);const result=[];let at=target;while(at){result.push(points.get(at));at=parent.get(at);}return [a,...result.reverse(),b];
}

/** Add junction dots only where three rays of the same physical wire-node meet. */
export function wireJunctions(connections) {
  const segments=connections.flatMap(w=>w.points.slice(1).map((b,i)=>({a:w.points[i],b,node:w.node})).filter(s=>s.a.x!==s.b.x||s.a.y!==s.b.y)),candidates=new Map();
  const contains=(s,p)=>s.a.x===s.b.x?p.x===s.a.x&&p.y>=Math.min(s.a.y,s.b.y)&&p.y<=Math.max(s.a.y,s.b.y):p.y===s.a.y&&p.x>=Math.min(s.a.x,s.b.x)&&p.x<=Math.max(s.a.x,s.b.x);
  for(const [i,a] of segments.entries())for(const b of segments.slice(i+1)){if(a.node!==b.node)continue;const points=[a.a,a.b,b.a,b.b];if((a.a.x===a.b.x)!==(b.a.x===b.b.x))points.push(a.a.x===a.b.x?{x:a.a.x,y:b.a.y}:{x:b.a.x,y:a.a.y});for(const p of points)if(contains(a,p)&&contains(b,p))candidates.set(`${a.node}:${p.x},${p.y}`,{...p,node:a.node});}
  return [...candidates.values()].filter(p=>{const rays=new Set();for(const s of segments)if(s.node===p.node&&contains(s,p)){for(const q of [s.a,s.b]){if(q.x<p.x)rays.add('left');if(q.x>p.x)rays.add('right');if(q.y<p.y)rays.add('up');if(q.y>p.y)rays.add('down');}}return rays.size>=3;});
}

export function renderSchematic(core,document) {
  const m=createSchematicModel(core,document),occupied=[];
  const connections=document.wires.map((wire,index)=>{const a=m.anchors.get(key(wire.from.componentId,wire.from.terminalId)),b=m.anchors.get(key(wire.to.componentId,wire.to.terminalId)),node=m.nodes.get(key(wire.from.componentId,wire.from.terminalId));const shift=6+(index%5)*4,lanes={x:[45+shift,1000+shift,1080+shift,2210,...m.blocks.flatMap(r=>[r.x-23-shift,r.x+r.w+23+shift])],y:[155+shift,1990+shift,...m.blocks.flatMap(r=>[r.y-23-shift,r.y+r.h+23+shift])]};const points=routeBetween(a,b,m.blocks,lanes,occupied,node);points.slice(1).forEach((p,i)=>occupied.push({a:points[i],b:p,node}));return {id:wire.id,from:wire.from,to:wire.to,points,color:wire.color,node};});
  const routes=connections.map(w=>{const d=w.points.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ');return `<g data-wire-id="${esc(w.id)}" data-from="${esc(key(w.from.componentId,w.from.terminalId))}" data-to="${esc(key(w.to.componentId,w.to.terminalId))}"><path d="${d}" style="stroke:#fff;stroke-width:6" class="wire"/><path d="${d}" style="stroke:${esc(w.color)};stroke-width:2.5" class="wire"/></g>`;}).join('');
  const dots=[...connections.flatMap(w=>[w.points[0],w.points.at(-1)]),...wireJunctions(connections)].map(p=>circle(p.x,p.y,3,'fill="#263646"')).join('');
  const tables=terminalTables(core,document,55,2090,m.width-110),permanent=permanentConnections(core,document,55,2110+tables.height,m.width-110),height=2110+tables.height+permanent.height+90;
  const body=text(50,145,'主回路 · 源 → XT1 → QF / FU / KM / FR → XT1 → 电机',17,'font-weight="700"')+text(1150,145,'控制回路 · 触点均按未动作状态绘制',17,'font-weight="700"')+routes+m.symbols.join('')+dots+text(55,2030,'实线为实际导线；触点 / 线圈 / 绕组不视作导线短接；线路交叉无连接点则不导通。',15)+text(55,2057,'XT1 上下为柜内 T / 柜外 B；XT2 旋转后柜内在左、柜外在右。N 不参与 380V 控制，PE 独立。',15)+tables.svg+permanent.svg;
  return {svg:sheet(`${document.title} · 修订原理图`,'实体导线、开关触点、线圈和电机端子均来自同一份示范电路；表内编号与图内接点相同。',m.width,height,body,{lessonId:document.lessonId,kind:'schematic',documentSha256:hash(JSON.stringify(document)),wireCount:document.wires.length}),width:m.width,height,connections};
}

/** Compare independently extracted SVG connection markers against the full authoritative document/catalog. */
export function validateDrawingTopology(core,document,drawing) {
  const actual=[...drawing.svg.matchAll(/data-wire-id="([^"]+)" data-from="([^"]+)" data-to="([^"]+)"/g)].map(m=>({id:m[1],from:m[2],to:m[3]})).sort((a,b)=>a.id.localeCompare(b.id));
  const expected=document.wires.map(w=>({id:esc(w.id),from:esc(key(w.from.componentId,w.from.terminalId)),to:esc(key(w.to.componentId,w.to.terminalId))})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(actual,expected,'原理图实体导线清单不等于示范文档');
  const fixedActual=[...drawing.svg.matchAll(/data-fixed-component="([^"]+)" data-fixed-a="([^"]+)" data-fixed-b="([^"]+)"/g)].map(m=>`${m[1]}:${m[2]}:${m[3]}`).sort();
  const fixedExpected=document.components.flatMap(c=>(core.getDefinition(c.type).fixedConnections??[]).map(([a,b])=>`${esc(c.id)}:${esc(a)}:${esc(b)}`)).sort();assert.deepEqual(fixedActual,fixedExpected,'图中永久内部桥接不等于器件契约');
  assert.equal(drawing.connections.length,document.wires.length);for(const connection of drawing.connections){assert.ok(connection.points.length>=2);for(const p of connection.points)assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));for(let i=1;i<connection.points.length;i++)assert.ok(connection.points[i].x===connection.points[i-1].x||connection.points[i].y===connection.points[i-1].y,'线路必须为正交实体线');}
  return {status:'passed',wireCount:actual.length,fixedConnectionCount:fixedActual.length,wires:actual,fixedConnections:fixedActual};
}

export function renderLayout(core,document) {
  const all=document.components,boxes=all.map(c=>({...c,...core.componentSize(c)})),minX=Math.min(...boxes.map(c=>c.position.x))-55,minY=Math.min(...boxes.map(c=>c.position.y))-45,maxX=Math.max(...boxes.map(c=>c.position.x+c.width))+80,maxY=Math.max(...boxes.map(c=>c.position.y+c.height))+80;
  const scale=Math.min(1.15,1600/(maxX-minX)),offsetX=60-minX*scale,offsetY=175-minY*scale;
  const boardHeight=(maxY-minY)*scale,board=[];
  for(const c of [...boxes].sort((a,b)=>Number(core.isLayoutObject(b.type))-Number(core.isLayoutObject(a.type)))){const x=c.position.x,y=c.position.y,def=core.getDefinition(c.type);if(core.isLayoutObject(c.type)){board.push(rect(x,y,c.width,c.height,`fill="${core.isWireDuct(c.type)?'#e2e7ed':'#f2f4f7'}" stroke-dasharray="${core.isWireDuct(c.type)?'7 4':'0'}"`));continue;}
    let svg=rect(x,y,c.width,c.height,'rx="3" fill="#fff"')+text(x+c.width/2,y+Math.min(c.height/2,36),c.label,20,'text-anchor="middle" font-weight="700"');
    if(c.type==='terminal-strip16'){
      svg='';for(let i=1;i<=16;i++){const top=core.transformedTerminal(c,def.terminals.find(t=>t.id===`T${i}`)),bottom=core.transformedTerminal(c,def.terminals.find(t=>t.id===`B${i}`));svg+=line(x+top.x,y+top.y,x+bottom.x,y+bottom.y)+circle(x+top.x,y+top.y,6)+circle(x+bottom.x,y+bottom.y,6)+text(c.rotation===90||c.rotation===270?x+c.width+17:x+(top.x+bottom.x)/2,y+(top.y+bottom.y)/2+5,i,14,'text-anchor="middle" class="label"');}svg+=rect(x,y,c.width,c.height)+text(x+c.width/2,y-13,c.label,19,'text-anchor="middle" font-weight="700"');
    }else if(c.type==='supply'){svg+=text(x+c.width/2,y+c.height-15,'L1   L2   L3   N   PE',13,'text-anchor="middle"');}
    else if(c.type.startsWith('motor'))svg+=circle(x+c.width/2,y+c.height/2,34)+text(x+c.width/2,y+c.height/2+7,'M',24,'text-anchor="middle"');
    board.push(`<g data-component-id="${esc(c.id)}" data-component-type="${c.type}">${svg}</g>`);
  }
  const tablesY=Math.ceil(offsetY+maxY*scale+40),width=1720,tables=terminalTables(core,document,55,tablesY,width-110),height=tablesY+tables.height+90;
  const body=text(55,145,'柜内主器件依三层布置；柜外电源 / 电机经 XT1；06 的四个限位开关经 XT2。',16)+`<g transform="translate(${offsetX},${offsetY}) scale(${scale})">${board.join('')}</g>`+tables.svg;
  return {svg:sheet(`${document.title} · 修订元件布置图`,'从当前课程的二维世界位置与端子契约生成；16 位逐位编号，非厂家尺寸安装图。',width,height,body,{lessonId:document.lessonId,kind:'layout',documentSha256:hash(JSON.stringify(document)),boardHeight}),width,height};
}

export async function prepareTerminalDrawings({directory=DRAWING_DIRECTORY,courses=[1,2,3,4,5,6,7,8,9,10],png=true}={}) {
  const target=path.resolve(directory);assert.ok(target===DRAWING_DIRECTORY||target.startsWith(`${DRAWING_DIRECTORY}${path.sep}`),'成品只允许写入本次私有 drawings 目录');
  await mkdir(target,{recursive:true});const core=await loadDrawingCore(),manifest={createdAt:new Date().toISOString(),source:'current lesson factory + terminal-wiring contract',entries:[]};
  const browser=png?await (await import('@playwright/test')).chromium.launch({headless:true}):null;
  try{for(const n of courses){assert.ok(Number.isInteger(n)&&n>=1&&n<=10);const lessonId=`motor-course-${String(n).padStart(2,'0')}`,document=core.createLessonDocument(lessonId,{wired:true});assert.equal(core.validateDocument(document).valid,true);const docFile=`project-${String(n).padStart(2,'0')}-source.json`;await writeFile(path.join(target,docFile),`${JSON.stringify(document,null,2)}\n`);
    let topology;for(const kind of ['schematic','layout']){const result=kind==='schematic'?renderSchematic(core,document):renderLayout(core,document),stem=`${STEMS[n-1]}${kind==='schematic'?'原理图':'布局图'}`,svgFile=`${stem}.svg`,pngFile=`${stem}.png`;if(kind==='schematic')topology=validateDrawingTopology(core,document,result);await writeFile(path.join(target,svgFile),result.svg);
      if(browser){const page=await browser.newPage({viewport:{width:result.width,height:Math.min(result.height,2000)},deviceScaleFactor:1});await page.setContent(`<html><head><meta charset="utf-8"/><style>html,body{margin:0;padding:0}svg{display:block}</style></head><body>${result.svg}</body></html>`);await page.screenshot({path:path.join(target,pngFile),fullPage:true,timeout:60000});await page.close();}
      const original=path.join(ORIGINAL_DIRECTORY,pngFile);manifest.entries.push({projectId:`project-${String(n).padStart(2,'0')}`,lessonId,kind,source:svgFile,file:png?pngFile:null,width:result.width,height:result.height,svgSha256:hash(result.svg),original:{path:original,sha256:hash(await readFile(original))},sourceDocument:{file:docFile,sha256:hash(await readFile(path.join(target,docFile))),canonicalSha256:hash(JSON.stringify(document))},...(png?{sha256:hash(await readFile(path.join(target,pngFile)))}:{}),topology:kind==='schematic'?topology:{status:'passed',componentCount:document.components.length,terminalPositions:assignmentsFor(core,document).map(({strip,rows})=>({componentId:strip.id,positions:rows.map(r=>r.position)}))}});
    }
    console.log(`${lessonId}: 已生成可编辑 SVG${png?' 与 PNG':''}，原课程文件未修改`);
  }}finally{await browser?.close();}
  await writeFile(path.join(target,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);return manifest;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  throw new Error('课程正式图纸必须使用用户提供的20张原始PNG。请使用 prepare-source-drawings.mjs；此模块仅保留历史拓扑诊断函数。');
}
