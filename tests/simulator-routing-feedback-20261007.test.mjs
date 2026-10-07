import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundled=await build({stdin:{contents:'export * from "./app/simulator/core/duct-routing";export * from "./app/simulator/core/catalog";export * from "./app/simulator/core/lessons";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {routeWireInDucts,segmentInsideDucts,resolveTerminal,createLessonDocument,transformedTerminal,getDefinition,componentSize,isLayoutObject}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const c=(id,type,x,y,size)=>({id,type,label:id,position:{x,y},...(size?{size}:{})});
const w=(id,a,at,b,bt)=>({id,from:{componentId:a,terminalId:at},to:{componentId:b,terminalId:bt},style:'orthogonal',routing:'duct',color:'#e7b000'});
function assertGeometry(document,wire,route){
 assert.equal(route.status,'routed');assert.deepEqual(route.sections[0][0],resolveTerminal(document,wire.from).world);assert.deepEqual(route.sections[0].at(-1),resolveTerminal(document,wire.to).world);
 for(let i=1;i<route.trunk.length;i++)assert.ok(segmentInsideDucts(document,route.trunk[i-1],route.trunk[i]));
}
function parallel(count=12,height=100){
 const components=[c('channel','wire-duct',0,150,{width:3200,height})],wires=[];
 for(let i=0;i<count;i++){components.push(c(`a${i}`,'terminal',i*120,0),c(`b${i}`,'terminal',1500+i*120,400));wires.push(w(`wire-${i}`,`a${i}`,'B',`b${i}`,'A'));}
 return {schemaVersion:1,title:'Shared cabinet lanes',components,wires};
}
const horizontalLane=route=>route.trunk.slice(1).flatMap((b,i)=>{const a=route.trunk[i];return a.y===b.y&&Math.abs(a.x-b.x)>100?[a.y]:[];})[0];
test('twelve simultaneous wires get distinct stable parallel lanes; order, direction and reload do not collide',()=>{
 const document=parallel(),before=JSON.stringify(document),routes=document.wires.map(wire=>routeWireInDucts(document,wire));
 routes.forEach((route,i)=>{assertGeometry(document,document.wires[i],route);assert.equal(route.capacityWarning,undefined);});
 assert.equal(new Set(routes.map(horizontalLane)).size,12);
 const reverse={...document,components:[...document.components].reverse(),wires:[...document.wires].reverse().map(wire=>({...wire,from:wire.to,to:wire.from}))};
 for(let i=0;i<document.wires.length;i++){
  assert.deepEqual(routeWireInDucts(JSON.parse(before),document.wires[i]),routes[i]);
  assert.equal(horizontalLane(routeWireInDucts(reverse,reverse.wires.find(w=>w.id===document.wires[i].id))),horizontalLane(routes[i]));
 }
 assert.equal(JSON.stringify(document),before);
});
test('wire membership, terminal edits and duct widening invalidate lane allocation; narrow ducts warn',()=>{
 const document=parallel(12,24),wire=document.wires[0],first=routeWireInDucts(document,wire);assert.equal(first.capacityWarning,true);assert.match(first.message,/间距|空间/);
 document.components[0].size.height=100;const widened=routeWireInDucts(document,wire);assert.equal(widened.capacityWarning,undefined);assert.notDeepEqual(first.trunk,widened.trunk);
 document.wires.splice(1);const single=routeWireInDucts(document,wire);assert.equal(horizontalLane(single),200);assert.notDeepEqual(single.trunk,widened.trunk);
 document.wires.push(w('new','a1','B','b1','A'));const added=routeWireInDucts(document,wire);assert.notDeepEqual(added.trunk,single.trunk);
 document.wires[1].to={componentId:'b2',terminalId:'A2'};assert.deepEqual(routeWireInDucts(document,document.wires[1]),routeWireInDucts(JSON.parse(JSON.stringify(document)),document.wires[1]));
});
test('FR control ports and KM auxiliary contacts exit vertically into horizontal ducts; a side-only duct is rejected',()=>{
 const document={schemaVersion:1,title:'Vertical cabinet entries',components:[c('fr','overload',200,100),c('km','contactor380',450,100),c('target','terminal',700,100),c('top','wire-duct',0,0,{width:1000,height:40}),c('bottom','wire-duct',0,400,{width:1000,height:40}),c('right','wire-duct-vertical',960,0,{width:40,height:440})],wires:[]};
 for(const [device,terminal,direction] of [['fr','95','top'],['fr','96','top'],['fr','97','bottom'],['fr','98','bottom'],['km','13','top'],['km','14','bottom']]){
  const wire=w(`${device}-${terminal}`,device,terminal,'target',direction==='top'?'A':'B'),route=routeWireInDucts(document,wire);assertGeometry(document,wire,route);
  const [start,next]=route.sections[0];assert.equal(start.x,next.x);assert.ok(direction==='top'?next.y<start.y:next.y>start.y);
  const first=route.trunk[0];assert.ok(first.y===20||first.y===420,'entry must be a horizontal channel');
 }
 const side={...document,components:document.components.filter(component=>component.type!=='wire-duct')};assert.equal(routeWireInDucts(side,w('blocked','fr','96','km','13')).status,'blocked');
 const original=getDefinition('overload').terminals.find(t=>t.id==='95');assert.equal(original.side,'right');assert.equal(original.routingSide,'top');
 assert.equal(transformedTerminal({...document.components[0],rotation:90},original).routingSide,'right');
});
test('external controls retain short side entries into the cabinet vertical duct',()=>{
 const document={schemaVersion:1,title:'External controls',components:[c('sb','push-no',1100,100),c('target','terminal',700,100),c('top','wire-duct',0,0,{width:1000,height:40}),c('bottom','wire-duct',0,400,{width:1000,height:40}),c('right','wire-duct-vertical',960,0,{width:40,height:440})],wires:[]};
 const wire=w('control','sb','11','target','A'),route=routeWireInDucts(document,wire);assertGeometry(document,wire,route);assert.equal(route.sections[0][0].y,route.sections[0][1].y);assert.equal(route.trunk[0].x,980);
});
for(const lesson of ['motor-course-01','motor-course-07','motor-course-09','motor-course-10'])test(`${lesson}: new power/motor boundary tails stay outside ducts and keep all endpoints`,()=>{
 const document=createLessonDocument(lesson,{wired:true});
 const external=document.wires.filter(wire=>[wire.from,wire.to].some(ref=>ref.componentId==='source')||[wire.from,wire.to].some(ref=>ref.componentId==='xt16'&&ref.terminalId.startsWith('B')));
 assert.ok(external.length>=7);
 for(const wire of external){const route=routeWireInDucts(document,wire);assertGeometry(document,wire,route);assert.equal(route.trunk.length,0,wire.id);assert.deepEqual(route,routeWireInDucts(JSON.parse(JSON.stringify(document)),wire));}
});
function collinearOverlap(a,b,c,d){
 if(a.x===b.x&&c.x===d.x&&a.x===c.x)return Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))>0.000001;
 if(a.y===b.y&&c.y===d.y&&a.y===c.y)return Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))>0.000001;
 return false;
}
for(const lesson of ['motor-course-01','motor-course-09','motor-course-10'])test(`${lesson}: external three-phase tails have no shared parallel lengths`,()=>{
 const document=createLessonDocument(lesson,{wired:true}),motor=document.components.find(c=>c.id==='m');
 const groups=motor.type==='motor'?[['U','V','W']]:[['U1','V1','W1'],['U2','V2','W2']];
 for(const terminals of groups){
  const wires=terminals.map(terminal=>document.wires.find(wire=>[wire.from,wire.to].some(ref=>ref.componentId==='m'&&ref.terminalId===terminal)));
  const routes=wires.map(wire=>routeWireInDucts(document,wire).sections[0]);
  for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++)for(let a=1;a<routes[i].length;a++)for(let b=1;b<routes[j].length;b++)assert.equal(collinearOverlap(routes[i][a-1],routes[i][a],routes[j][b-1],routes[j][b]),false,`${terminals[i]}/${terminals[j]}`);
 }
});
test('course 06 rotated XT2 preserves outward world direction and separates cabinet input from external SQ wiring',()=>{
 const document=createLessonDocument('motor-course-06',{wired:true}),strip=document.components.find(c=>c.id===document.roles.xt2);assert.equal(strip.rotation,270);
 for(const wire of document.wires.filter(wire=>wire.from.componentId===strip.id||wire.to.componentId===strip.id)){
  const ref=wire.from.componentId===strip.id?wire.from:wire.to,terminal=resolveTerminal(document,ref),route=routeWireInDucts(document,wire);assertGeometry(document,wire,route);
  const points=wire.from.componentId===strip.id?route.sections[0]:[...route.sections[0]].reverse();assert.equal(points[0].y,points[1].y);
  assert.ok(terminal.terminal.side==='left'?points[1].x<points[0].x:points[1].x>points[0].x);
  assert.equal(route.trunk.length===0,terminal.terminal.routingRole==='external');
 }
});
test('a cabinet lead may cross the horizontal duct edge before its 12-unit clearance anchor',()=>{
 const document={schemaVersion:1,title:'Close horizontal duct',components:[c('fr','overload',200,100),c('target','terminal',700,100),c('top','wire-duct',0,50,{width:1000,height:40}),c('bottom','wire-duct',0,400,{width:1000,height:40}),c('right','wire-duct-vertical',960,50,{width:40,height:390})],wires:[]};
 const wire=w('nearby','fr','95','target','A'),route=routeWireInDucts(document,wire);assertGeometry(document,wire,route);assert.equal(route.sections[0][0].x,route.sections[0][1].x);assert.equal(route.trunk[0].y,70);
});
function segmentTouches(a,b,c,d){
 return Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y));
}
function phaseIntersections(routes){
 const intersections=[];
 for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++)for(let a=1;a<routes[i].length;a++)for(let b=1;b<routes[j].length;b++){
  const first=[routes[i][a-1],routes[i][a]],second=[routes[j][b-1],routes[j][b]];
  if(segmentTouches(...first,...second))intersections.push({pair:[i,j],first,second});
 }
 return intersections;
}
function assertSimpleExteriorPath(document,wire,points){
 for(let i=1;i+1<points.length;i++){
  const [a,b,c]=points.slice(i-1,i+2);
  assert.ok(!(a.x===b.x&&b.x===c.x&&(b.y-a.y)*(c.y-b.y)<0),'vertical foldback');
  assert.ok(!(a.y===b.y&&b.y===c.y&&(b.x-a.x)*(c.x-b.x)<0),'horizontal foldback');
 }
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];assert.ok(a.x===b.x||a.y===b.y);
  for(let j=i+2;j<points.length;j++)assert.equal(segmentTouches(a,b,points[j-1],points[j]),false,'one wire crosses itself');
  for(const component of document.components.filter(c=>!isLayoutObject(c.type))){
   if(i===1&&component.id===wire.from.componentId||i===points.length-1&&component.id===wire.to.componentId)continue;
   const size=componentSize(component),left=component.position.x,top=component.position.y,right=left+size.width,bottom=top+size.height;
   const inside=a.x===b.x?a.x>left&&a.x<right&&Math.max(a.y,b.y)>top&&Math.min(a.y,b.y)<bottom:a.y>top&&a.y<bottom&&Math.max(a.x,b.x)>left&&Math.min(a.x,b.x)<right;
   assert.equal(inside,false,`${wire.id} crosses ${component.id}'s body`);
  }
 }
}
// The confirmed lower group remains XT 7/8/9 -> U2/V2/W2. Both rows exit
// downwards in the same order. Their routes around the solid motor can have
// perpendicular crossings; these are presentation intersections, not junctions.
// Upper facing terminals have no such constraint and must remain uncrossed.
for(const lesson of ['motor-course-09','motor-course-10'])test(`${lesson}: confirmed lower slot order permits only bounded perpendicular crossings while upper phases remain separate`,()=>{
 for(const [dx,dy] of [[0,0],[20,15],[80,60],[120,90]]){
  const document=createLessonDocument(lesson,{wired:true}),motor=document.components.find(c=>c.id==='m');motor.position.x+=dx;motor.position.y+=dy;
  for(const [group,terminals] of [[0,['U1','V1','W1']],[1,['U2','V2','W2']]]){
   const wires=terminals.map(terminal=>document.wires.find(wire=>wire.to.componentId==='m'&&wire.to.terminalId===terminal));
   if(group===1)assert.deepEqual(wires.map(wire=>wire.from),[7,8,9].map(slot=>({componentId:'xt16',terminalId:`B${slot}`})));
   const routes=wires.map(wire=>{const route=routeWireInDucts(document,wire);assertGeometry(document,wire,route);assert.equal(route.trunk.length,0);assertSimpleExteriorPath(document,wire,route.sections[0]);assert.deepEqual(route,routeWireInDucts(JSON.parse(JSON.stringify(document)),wire));return route.sections[0];});
   const crossings=phaseIntersections(routes);
   if(group===0)assert.equal(crossings.length,0,'facing upper phases must not cross');
   else{
    assert.ok(crossings.length<=3,'lower motor fan exceeded its three-crossing regression bound');
    if(dx===0&&dy===0)assert.equal(crossings.length,3,'record the confirmed default-layout crossing geometry');
    for(const {first:[a,b],second:[c,d]} of crossings){assert.notEqual(a.x===b.x,c.x===d.x,'only perpendicular crossings are allowed');assert.equal(collinearOverlap(a,b,c,d),false,'parallel lines cannot overlap');}
   }
  }
 }
});
