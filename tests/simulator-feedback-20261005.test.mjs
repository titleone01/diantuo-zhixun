import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundle=await build({stdin:{contents:'export * from "./app/simulator/core/reference-workspace";export * from "./app/simulator/core/catalog";export * from "./app/simulator/core/engine";export * from "./app/simulator/core/lessons";export * from "./app/simulator/core/validation";export * from "./app/simulator/core/relay-upgrade";export * from "./app/simulator/core/course-roles";export * from "./app/simulator/core/duct-routing";export * from "./app/simulator/core/motor-courses";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const {createReferencePractice,rotateComponent,componentSize,resolveTerminal,validateDocument,createLessonDocument,LESSONS,isLayoutObject,assessLesson,simulate,initialRuntime,buildCircuitNetwork,upgradeRelays,createMotorCourseDocument,bindCourseRole,courseRequirements,routeWireInDucts}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const component=(id,type,x=0,y=0)=>({id,type,label:id,position:{x,y}});
const doc=(...components)=>({schemaVersion:1,title:'反馈契约',components,wires:[]});
const wire=(a,at,b,bt,id='test')=>({id,from:{componentId:a,terminalId:at},to:{componentId:b,terminalId:bt},color:'#123456',routing:'duct',style:'orthogonal'});
for(const type of ['supply','terminal-strip16'])test(`${type}: quarter turns preserve center, stable IDs, outward direction and reload`,()=>{
 const original=component('a',type,40,50);let c=original;
 const center={x:40+componentSize(c).width/2,y:50+componentSize(c).height/2};
 for(let i=0;i<4;i++){const before=resolveTerminal(doc(c),{componentId:'a',terminalId:type==='supply'?'L1':'T1'});c=rotateComponent(c);const size=componentSize(c),after=resolveTerminal(doc(c),{componentId:'a',terminalId:before.terminal.id});assert.equal(c.position.x+size.width/2,center.x);assert.equal(c.position.y+size.height/2,center.y);assert.ok(Math.abs(after.world.x-(center.x-(before.world.y-center.y)))<1e-9);assert.ok(Math.abs(after.world.y-(center.y+(before.world.x-center.x)))<1e-9);assert.equal(validateDocument(doc(c)).valid,true);assert.deepEqual(resolveTerminal(JSON.parse(JSON.stringify(doc(c))),{componentId:'a',terminalId:before.terminal.id}),after);}
 assert.deepEqual(c.position,original.position);assert.equal(c.rotation,0);
 assert.equal(validateDocument(doc({...c,rotation:45})).valid,false);
});
test('rotations are forbidden on other electrical components; rails have fixed thickness',()=>{
 assert.throws(()=>rotateComponent(component('a','contactor380')));
 assert.equal(validateDocument(doc({...component('rail','din-rail'),size:{width:4000,height:24}})).valid,true);
 assert.equal(validateDocument(doc({...component('rail','din-rail'),size:{width:4000,height:25}})).valid,false);
});
for(const lesson of LESSONS.filter(l=>l.id.startsWith('motor-course-')))test(`${lesson.id}: new automatic and manual contracts plus positive/negative assessment`,()=>{
 const automatic=createLessonDocument(lesson.id),manual=createLessonDocument(lesson.id,{placement:'manual'}),example=createLessonDocument(lesson.id,{wired:true});
 assert.equal(automatic.wires.length,0);assert.ok(automatic.components.some(c=>c.type==='din-rail'));assert.deepEqual(manual.components,automatic.components.filter(c=>isLayoutObject(c.type)));assert.deepEqual(manual.roles,{});assert.equal(manual.wires.length,0);assert.equal(assessLesson(manual).status,'incomplete');assert.equal(assessLesson(example).status,'passed');
 const negative={...example,wires:example.wires.filter(w=>w.from.terminalId!=='PE'&&w.to.terminalId!=='PE')};assert.notEqual(assessLesson(negative).status,'passed');
});
test('manual student IDs bind explicitly, reject duplicates and types, and pass the formal course',()=>{
 const expected=createLessonDocument('motor-course-01',{wired:true});let manual=createLessonDocument('motor-course-01',{placement:'manual'});
 const ids=new Map();for(const [role,id] of Object.entries(expected.roles)){const c=expected.components.find(c=>c.id===id);ids.set(id,`student-${role}`);manual={...manual,components:[...manual.components,{...c,id:ids.get(id)}]};manual=bindCourseRole(manual,ids.get(id),role);}
 manual.wires=expected.wires.map(w=>({...w,from:{...w.from,componentId:ids.get(w.from.componentId)},to:{...w.to,componentId:ids.get(w.to.componentId)}}));assert.equal(assessLesson(manual).status,'passed');
 assert.throws(()=>bindCourseRole(manual,ids.get('qf'),'m'));assert.throws(()=>bindCourseRole({...manual,components:[...manual.components,component('other','breaker3')]},'other','qf'));
 assert.notEqual(assessLesson(bindCourseRole(manual,manual.roles.qf,'')).status,'passed');assert.ok(courseRequirements('motor-course-01').length>0);
});
function coilDocument(type,delayMs=3000){const d=doc(component('s','supply'),{...component('c',type),settings:type.startsWith('timer')?{delayMs}:undefined});const ports=type==='timer380-8pin'?['2','7']:['A1','A2'];d.wires=[wire('s','L1','c',ports[0],'one'),wire('s','L2','c',ports[1],'two')];return d;}
const connected=(d,r,a,b)=>buildCircuitNetwork(d,r).connected(`c::${a}`,`c::${b}`);
test('KA four isolated contacts follow actual 380V coil and reset after power loss',()=>{
 const d=coilDocument('relay380-jzc1-22');let r=simulate(d,initialRuntime(d,false));
 for(const [a,b,nc] of [['13','14',false],['43','44',false],['21','22',true],['31','32',true]])assert.equal(connected(d,r.runtime,a,b),nc);
 r=simulate(d,r.runtime,{type:'power',enabled:true});assert.equal(r.components.c.active,true);
 for(const [a,b,nc] of [['13','14',false],['43','44',false],['21','22',true],['31','32',true]])assert.equal(connected(d,r.runtime,a,b),!nc);
 assert.equal(connected(d,r.runtime,'13','43'),false);r=simulate(d,r.runtime,{type:'power',enabled:false});assert.equal(r.components.c.active,false);
 d.wires[1].from.terminalId='N';assert.equal(simulate(d,initialRuntime(d)).components.c.active,false);
});
for(const delayMs of [1,3000,300000])test(`KT ${delayMs}ms: numeric coil, both delayed groups, exact boundary and restart`,()=>{
 const d=coilDocument('timer380-8pin',delayMs);assert.equal(validateDocument(d).valid,true);let r=simulate(d,initialRuntime(d));assert.equal(r.components.c.active,true);assert.equal(r.components.c.state,'timing');
 r=simulate(d,r.runtime,{type:'advance-time',ms:delayMs-1});assert.equal(r.components.c.remainingMs,1);
 assert.equal(connected(d,r.runtime,'1','4'),true);assert.equal(connected(d,r.runtime,'8','5'),true);assert.equal(connected(d,r.runtime,'1','3'),false);assert.equal(connected(d,r.runtime,'8','6'),false);
 r=simulate(d,r.runtime,{type:'advance-time',ms:1});assert.equal(r.components.c.state,'done');assert.equal(r.components.c.remainingMs,0);assert.equal(connected(d,r.runtime,'1','4'),false);assert.equal(connected(d,r.runtime,'8','5'),false);assert.equal(connected(d,r.runtime,'1','3'),true);assert.equal(connected(d,r.runtime,'8','6'),true);assert.equal(connected(d,r.runtime,'1','8'),false);
 r=simulate(d,r.runtime,{type:'power',enabled:false});assert.equal(r.components.c.state,'released');assert.equal(connected(d,r.runtime,'1','4'),true);assert.equal(connected(d,r.runtime,'8','5'),true);r=simulate(d,r.runtime,{type:'power',enabled:true});assert.equal(r.components.c.remainingMs,delayMs);
});
test('new timer rejects over-limit settings; legacy value stays unchanged and upgrade never mutates input',()=>{
 assert.equal(validateDocument(coilDocument('timer380-8pin',300001)).valid,false);assert.equal(validateDocument(coilDocument('timer380-8pin',0)).valid,false);
 const old=coilDocument('timer380',301000),before=JSON.stringify(old);assert.equal(validateDocument(old).valid,true);assert.throws(()=>upgradeRelays(old),/五分钟|5分钟/);assert.equal(JSON.stringify(old),before);
 for(const id of ['motor-course-08','motor-course-09']){const d=createMotorCourseDocument(id,{wired:true}),before=JSON.stringify(d),next=upgradeRelays(d);assert.equal(JSON.stringify(d),before);assert.deepEqual(next.wires.map(w=>w.id),d.wires.map(w=>w.id));assert.equal(assessLesson(next).status,'passed');assert.equal(assessLesson(d).status,'passed');}
});
test('strip external routing bypasses ducts, internal routes enter; rotation invalidates cache',()=>{
 let d=createLessonDocument('motor-course-01');const w=wire('xt16','B1','m','U');const r=routeWireInDucts(d,w);assert.equal(r.status,'routed');assert.equal(r.trunk.length,0);
 const top=wire('fu2','2','xt16','T1');assert.equal(routeWireInDucts(d,top).status,'routed');assert.ok(routeWireInDucts(d,top).trunk.length>0);
 const mixed=wire('xt16','T1','xt16','B2');assert.equal(routeWireInDucts(d,mixed).status,'routed');
 const old=routeWireInDucts(d,w);const strip=d.components.find(c=>c.id==='xt16');Object.assign(strip,rotateComponent(strip));const after=routeWireInDucts(d,w);assert.notDeepEqual(after,old);assert.deepEqual(routeWireInDucts(JSON.parse(JSON.stringify(d)),w),after);
});

test('reference practice offers the same automatic/manual layout while keeping its unassessed reference identity',()=>{
 const a=createReferencePractice(32),m=createReferencePractice(32,'manual');
 assert.equal(a.referenceDiagramId,32);assert.equal(a.lessonId,undefined);assert.equal(a.wires.length,0);
 assert.ok(a.components.some(c=>c.type==='din-rail'));assert.deepEqual(m.components,a.components.filter(c=>isLayoutObject(c.type)));
 assert.equal(m.referenceDiagramId,32);assert.equal(m.lessonId,undefined);
});
test('manual auxiliary roles can be placed before their owner without guessing display labels',()=>{
 const a=createLessonDocument('motor-course-07',{wired:true});let m=createLessonDocument('motor-course-07',{placement:'manual'});
 const ids=Object.fromEntries(a.components.map(c=>[c.id,'student-'+c.id]));
 for(const [role,id] of Object.entries(a.roles).reverse()){
   const c=a.components.find(c=>c.id===id);m={...m,components:[...m.components,{...c,id:ids[id],label:'任意名称',linkedTo:undefined}]};
   m=bindCourseRole(m,ids[id],role);
 }
 m.wires=a.wires.map(w=>({...w,from:{...w.from,componentId:ids[w.from.componentId]},to:{...w.to,componentId:ids[w.to.componentId]}}));
 assert.equal(assessLesson(m).status,'passed');
 for(const c of m.components.filter(c=>c.type==='auxiliary-no'))assert.ok(c.linkedTo.startsWith('student-'));
});
