import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const bundled=await build({stdin:{contents:'export * from "./editor/duct-routing";export * from "./editor/geometry";export * from "./core/catalog";export * from "./core/validation";export * from "./core/motor-practice-layout";export * from "./core/lessons";export {routeWireInDucts,segmentInsideDucts} from "./core/duct-routing";',resolveDir:fileURLToPath(new URL("../app/simulator/",import.meta.url))},bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent"});
const {ductWireRoute,routeWireInDucts,segmentInsideDucts,wireRoute,wirePath,wireEndpoints,validateDocument,createMotorPracticeDocument,getDefinition,createLessonDocument,LESSONS}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const component=(id,type,x,y,size)=>({id,type,label:id,position:{x,y},...(size?{size}:{})});
const doc=()=>({schemaVersion:1,title:"线槽",components:[component("a","terminal",100,10),component("b","terminal",700,400),component("top","wire-duct",0,130,{width:850,height:40}),component("bottom","wire-duct",0,310,{width:850,height:40}),component("bridge","wire-duct-vertical",0,130,{width:40,height:220})],wires:[]});
const wire={id:"w",from:{componentId:"a",terminalId:"B"},to:{componentId:"b",terminalId:"A"},style:"straight",routing:"duct",color:"#123"};
test("connected network follows deterministic shortest duct path; endpoints survive move/resize/reload",()=>{
  const document=doc(),first=ductWireRoute(document,wire);assert.ok(first.points);const ends=wireEndpoints(document,wire);
  assert.deepEqual(first.points[0],ends.from);assert.deepEqual(first.points.at(-1),ends.to);assert.ok(first.trunk.some(p=>p.x>=0&&p.x<=40));assertTrunkCovered(document,first);
  assert.deepEqual(wireRoute(document,wire),first.points);assert.equal(validateDocument({...document,wires:[wire]}).valid,true);
  assert.deepEqual(ductWireRoute(structuredClone(document),wire),first);
  document.components[0].position.x+=70;document.components[2].size.width+=20;
  const moved=ductWireRoute(document,wire);assert.notDeepEqual(moved.points,first.points);assert.deepEqual(moved.points[0],wireEndpoints(document,wire).from);
  assert.equal(wirePath(JSON.parse(JSON.stringify(document)),wire),wirePath(document,wire));
  const reordered={...document,components:[...document.components].reverse()};assert.deepEqual(ductWireRoute(reordered,wire),moved);
});
test("disconnected ducts retain electrical endpoints with separate visible leads; old manual wires never opt in",()=>{
  const document=doc();document.components=document.components.filter(c=>c.id!=="bridge");
  const route=ductWireRoute(document,wire);assert.equal(route.reason,"disconnected");assert.equal(route.status,"disconnected");assert.equal(route.sections.length,2);
  assert.equal((wirePath(document,wire).match(/M /g)||[]).length,2);assert.deepEqual(route.sections[0][0],wireEndpoints(document,wire).from);assert.deepEqual(route.sections[1].at(-1),wireEndpoints(document,wire).to);
  const legacy={...wire,routing:undefined};assert.deepEqual(wireRoute(doc(),legacy),Object.values(wireEndpoints(doc(),legacy)));
  document.components=document.components.filter(c=>!c.type.startsWith("wire-duct"));assert.equal(ductWireRoute(document,wire).reason,"no-ducts");
  assert.equal(validateDocument({...document,wires:[{...wire,routing:"invented"}]}).valid,false);
});
test("touching duct rectangles connect even when their center lines do not intersect",()=>{
  const document=doc();document.components=document.components.filter(c=>c.id!=="bridge");
  document.components.push(component("bridge","wire-duct-vertical",835,170,{width:40,height:140}));
  assert.ok(ductWireRoute(document,wire).points);
});

function assertNoBodyReentry(document,ref,points){
  const body=document.components.find(c=>c.id===ref.componentId),definition=getDefinition(body.type);
  const left=body.position.x,right=left+definition.width,top=body.position.y,bottom=top+definition.height;
  const terminal=definition.terminals.find(t=>t.id===ref.terminalId);
  const [start,first]=points;
  if(terminal.side==="bottom"){assert.equal(first.x,start.x);assert.ok(first.y>=bottom+12);}
  if(terminal.side==="top"){assert.equal(first.x,start.x);assert.ok(first.y<=top-12);}
  if(terminal.side==="left"){assert.equal(first.y,start.y);assert.ok(first.x<=left-12);}
  if(terminal.side==="right"){assert.equal(first.y,start.y);assert.ok(first.x>=right+12);}
  const ducts=document.components.filter(c=>c.type.startsWith("wire-duct"));
  const entryIndex=points.findIndex((point,i)=>i>0&&ducts.some(duct=>{
    const size=duct.size??getDefinition(duct.type);
    return point.x>=duct.position.x&&point.x<=duct.position.x+size.width&&point.y>=duct.position.y&&point.y<=duct.position.y+size.height;
  }));
  assert.ok(entryIndex>0,"entrance reaches a duct");
  for(let i=1;i<entryIndex;i++){
    const a=points[i],b=points[i+1];assert.ok(a.x===b.x||a.y===b.y,"entrance remains orthogonal");
    const crosses=a.x===b.x?a.x>left&&a.x<right&&Math.max(a.y,b.y)>top&&Math.min(a.y,b.y)<bottom:a.y>top&&a.y<bottom&&Math.max(a.x,b.x)>left&&Math.min(a.x,b.x)<right;
    assert.equal(crosses,false,`${ref.componentId}.${ref.terminalId} re-enters its own body at segment ${i}`);
  }
}

for(const course of ["motor-course-01","motor-course-09","motor-course-10"])test(`${course}: lower XT and motor terminals leave outward without returning through their bodies`,()=>{
  const document=createMotorPracticeDocument(course),motor=document.components.find(c=>c.type.startsWith("motor"));
  const from={componentId:"xt16",terminalId:"B1"},to={componentId:motor.id,terminalId:course==="motor-course-01"?"U":"U2"};
  const routed={...wire,from,to},route=ductWireRoute(document,routed);
  assert.ok(route.points);assertNoBodyReentry(document,from,route.points);assertNoBodyReentry(document,to,[...route.points].reverse());
  assert.deepEqual(route.points[0],wireEndpoints(document,routed).from);assert.deepEqual(route.points.at(-1),wireEndpoints(document,routed).to);
  assert.deepEqual(ductWireRoute(JSON.parse(JSON.stringify(document)),routed),route);
});

for(const [side,type,terminalId,duct] of [
  ["top","terminal","A",component("lane","wire-duct",0,300,{width:800,height:40})],
  ["bottom","terminal","B",component("lane","wire-duct",0,0,{width:800,height:40})],
  ["left","push-no","11",component("lane","wire-duct-vertical",400,0,{width:40,height:800})],
  ["right","push-no","12",component("lane","wire-duct-vertical",0,0,{width:40,height:800})],
])test(`${side} terminal retains its exit direction when the duct is on the opposite side`,()=>{
  const document={schemaVersion:1,title:"反向入槽",components:[component("source",type,100,100),component("target","terminal",600,600),duct],wires:[]};
  const from={componentId:"source",terminalId},to={componentId:"target",terminalId:"A"},routed={...wire,from,to};
  const route=ductWireRoute(document,routed);assert.ok(route.points);assertNoBodyReentry(document,from,route.points);
  assert.deepEqual(route.points[0],wireEndpoints(document,routed).from);assert.deepEqual(route.points.at(-1),wireEndpoints(document,routed).to);
});

test("a duct entrance inside the source body falls back without losing the electrical connection",()=>{
  const document=doc();document.components=document.components.filter(c=>!c.type.startsWith("wire-duct"));
  document.components.push(component("inside","wire-duct",110,40,{width:60,height:24}));
  assert.equal(ductWireRoute(document,wire).reason,"disconnected");
  const route=ductWireRoute(document,wire);assert.ok(route.sections.every(section=>section.length>=2));assert.equal((wirePath(document,wire).match(/M /g)||[]).length,2);
  assert.deepEqual(route.sections[0][0],wireEndpoints(document,wire).from);assert.deepEqual(route.sections[1].at(-1),wireEndpoints(document,wire).to);
  assert.deepEqual(wire.from,{componentId:"a",terminalId:"B"});assert.deepEqual(wire.to,{componentId:"b",terminalId:"A"});
});

const symmetric=()=>({schemaVersion:1,title:"FU2 and XT16 deterministic lanes",components:[
  component("fu2","fuse2",524.501,80),component("xt16","terminal-strip16",297.81475,620),
  component("top","wire-duct",0,0,{width:1100,height:40}),component("bottom","wire-duct",0,540,{width:1100,height:40}),
  component("left","wire-duct-vertical",0,0,{width:40,height:580}),component("right","wire-duct-vertical",1060,0,{width:40,height:580}),
],wires:[]});
const symmetricWire={id:"parallel-1",from:{componentId:"fu2",terminalId:"1"},to:{componentId:"xt16",terminalId:"T6"},color:"#000",style:"orthogonal",routing:"duct"};
function assertTrunkCovered(document,route){
  for(let index=1;index<route.trunk.length;index++)assert.ok(segmentInsideDucts(document,route.trunk[index-1],route.trunk[index]),`segment ${index} leaves actual duct rectangles`);
}

test("equal-length FU2/XT16 paths and finite parallel offsets stay stable after component reorder and JSON reload",()=>{
  const document=symmetric(),before=JSON.stringify(document),first=routeWireInDucts(document,symmetricWire);
  assert.equal(first.status,"routed");assertTrunkCovered(document,first);
  for(const components of [[...document.components].reverse(),[...document.components.slice(2),...document.components.slice(0,2)]]){
    assert.deepEqual(routeWireInDucts({...document,components},symmetricWire),first);
  }
  assert.deepEqual(routeWireInDucts(JSON.parse(before),symmetricWire),first);
  const parallel=routeWireInDucts(document,{...symmetricWire,id:"parallel-2"});assert.equal(parallel.status,"routed");assert.notDeepEqual(parallel.trunk,first.trunk);assertTrunkCovered(document,parallel);
  assert.equal(JSON.stringify(document),before,"lane computation cannot modify the electrical graph");
});

test("same wire ID changing FU2/XT16 terminals and mutable geometry cannot reuse stale cached endpoints",()=>{
  const document=symmetric(),first=routeWireInDucts(document,symmetricWire);
  const changed={...symmetricWire,from:{componentId:"fu2",terminalId:"3"},to:{componentId:"xt16",terminalId:"T16"}};
  const second=routeWireInDucts(document,changed);assert.equal(second.status,"routed");assert.notDeepEqual(second.sections[0][0],first.sections[0][0]);
  assert.deepEqual(second.sections[0][0],wireEndpoints(document,changed).from);assert.deepEqual(second.sections[0].at(-1),wireEndpoints(document,changed).to);
  document.components[0].position.x+=16;document.components.find(c=>c.id==="top").size.height+=8;
  const moved=routeWireInDucts(document,changed);assert.equal(moved.status,"routed");assert.notDeepEqual(moved.sections[0][0],second.sections[0][0]);
  assert.deepEqual(moved,routeWireInDucts(JSON.parse(JSON.stringify(document)),changed));assertTrunkCovered(document,moved);
});

test("renaming duct IDs invalidates cached tie-breaking just like JSON reload",()=>{
  const document=symmetric();routeWireInDucts(document,symmetricWire);
  const left=document.components.find(c=>c.id==="left"),right=document.components.find(c=>c.id==="right");left.id="right";right.id="left";
  assert.deepEqual(routeWireInDucts(document,symmetricWire),routeWireInDucts(JSON.parse(JSON.stringify(document)),symmetricWire));
});

test("touching duct end caps route; a real sub-unit gap gives separated fallback; missing ducts show directed leads",()=>{
  const document=symmetric();document.components=document.components.filter(c=>c.id!=="right");
  document.components.find(c=>c.id==="left").size.height=540;
  assert.equal(routeWireInDucts(document,symmetricWire).status,"routed");
  document.components.find(c=>c.id==="left").size.height=539.75;
  const disconnected=routeWireInDucts(document,symmetricWire);assert.equal(disconnected.status,"disconnected");assert.equal(disconnected.sections.length,2);
  assert.equal((wirePath(document,symmetricWire).match(/M /g)||[]).length,2);
  document.components=document.components.filter(c=>!c.type.startsWith("wire-duct"));
  const missing=routeWireInDucts(document,symmetricWire);assert.equal(missing.status,"missing");assert.ok(missing.sections.every(section=>section.length>=2));
  assert.equal((wirePath(document,symmetricWire).match(/M /g)||[]).length,2);assert.deepEqual(missing.sections[0][0],wireEndpoints(document,symmetricWire).from);
  assert.ok(missing.sections[0][1].y<=document.components[0].position.y-12);
});

test("other component bodies block entrances while fallback remains visible and does not alter references",()=>{
  const document={schemaVersion:1,title:"Blocked directed entrance",components:[component("fu2","fuse2",100,80),component("target","terminal",900,80),component("top","wire-duct",0,0,{width:1100,height:40}),component("block","terminal-strip16",-50,-20)],wires:[]};
  const routed={...symmetricWire,from:{componentId:"fu2",terminalId:"1"},to:{componentId:"target",terminalId:"A"}},before=JSON.stringify(document),route=routeWireInDucts(document,routed);
  assert.equal(route.status,"blocked");assert.ok(route.message);assert.ok(route.sections.every(section=>section.length>=2));assert.equal((wirePath(document,routed).match(/M /g)||[]).length,2);
  assert.deepEqual(route.sections[0][0],wireEndpoints(document,routed).from);assert.deepEqual(route.sections[1].at(-1),wireEndpoints(document,routed).to);assert.equal(JSON.stringify(document),before);
});

test("internal body obstruction selects the remaining branch; obstructing both branches leaves separated leads",()=>{
  const document=symmetric();document.components.push(component("left-body","terminal-strip16",-50,250));
  const route=routeWireInDucts(document,symmetricWire);assert.equal(route.status,"routed");assert.ok(route.trunk.some(point=>point.x>=1060));assertTrunkCovered(document,route);
  document.components.push(component("right-body","terminal-strip16",1050,250));
  const blocked=routeWireInDucts(document,symmetricWire);assert.equal(blocked.status,"disconnected");assert.equal(blocked.sections.length,2);assert.equal((wirePath(document,symmetricWire).match(/M /g)||[]).length,2);
  assert.deepEqual(blocked.sections[0][0],wireEndpoints(document,symmetricWire).from);assert.deepEqual(blocked.sections[1].at(-1),wireEndpoints(document,symmetricWire).to);
});

test("legacy style duct and canonical routing share geometry while stored manual waypoints survive mode changes",()=>{
  const document=symmetric(),manual={...symmetricWire,routing:undefined,waypoints:[{x:1234,y:789}]},legacy={...manual,style:"duct"},canonical={...manual,routing:"duct"};
  const before=JSON.stringify([document,manual,legacy,canonical]);
  assert.equal(wirePath(document,legacy),wirePath(document,canonical));assert.deepEqual(wireRoute(document,legacy),wireRoute(document,canonical));
  assert.ok(wirePath(document,manual).includes("1234"));assert.ok(!wirePath(document,canonical).includes("1234"));
  assert.equal(JSON.stringify([document,manual,legacy,canonical]),before);
});

for(const lesson of LESSONS)test(`${lesson.id}: every wired demonstration routes in six real ducts without changing topology`,()=>{
  const document=createLessonDocument(lesson.id,{wired:true}),before=JSON.stringify(document);
  assert.equal(document.components.filter(c=>c.type.startsWith("wire-duct")).length,6);assert.ok(document.wires.length>0);
  for(const routed of document.wires){
    const route=routeWireInDucts(document,routed),label=`${routed.id}: ${routed.from.componentId}.${routed.from.terminalId} -> ${routed.to.componentId}.${routed.to.terminalId}`;
    assert.equal(route.status,"routed",`${label}: ${route.message}`);assertTrunkCovered(document,route);
    assert.deepEqual(route.sections[0][0],wireEndpoints(document,routed).from,label);assert.deepEqual(route.sections[0].at(-1),wireEndpoints(document,routed).to,label);
    assertNoBodyReentry(document,routed.from,route.sections[0]);assertNoBodyReentry(document,routed.to,[...route.sections[0]].reverse());
  }
  assert.equal(JSON.stringify(document),before,"routing must not rewrite wire references or geometry");
});
