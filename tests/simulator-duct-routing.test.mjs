import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const bundled=await build({stdin:{contents:'export * from "./editor/duct-routing";export * from "./editor/geometry";export * from "./core/catalog";export * from "./core/validation";export * from "./core/motor-practice-layout";',resolveDir:fileURLToPath(new URL("../app/simulator/",import.meta.url))},bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent"});
const {ductWireRoute,wireRoute,wirePath,wireEndpoints,validateDocument,createMotorPracticeDocument,getDefinition}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const component=(id,type,x,y,size)=>({id,type,label:id,position:{x,y},...(size?{size}:{})});
const doc=()=>({schemaVersion:1,title:"线槽",components:[component("a","terminal",100,10),component("b","terminal",700,400),component("top","wire-duct",0,130,{width:850,height:40}),component("bottom","wire-duct",0,310,{width:850,height:40}),component("bridge","wire-duct-vertical",0,130,{width:40,height:220})],wires:[]});
const wire={id:"w",from:{componentId:"a",terminalId:"B"},to:{componentId:"b",terminalId:"A"},style:"straight",routing:"duct",color:"#123"};
test("connected network follows deterministic shortest duct path; endpoints survive move/resize/reload",()=>{
  const document=doc(),first=ductWireRoute(document,wire);assert.ok(first.points);const ends=wireEndpoints(document,wire);
  assert.deepEqual(first.points[0],ends.from);assert.deepEqual(first.points.at(-1),ends.to);assert.ok(first.points.some(p=>p.x===20));
  assert.deepEqual(wireRoute(document,wire),first.points);assert.equal(validateDocument({...document,wires:[wire]}).valid,true);
  assert.deepEqual(ductWireRoute(structuredClone(document),wire),first);
  document.components[0].position.x+=70;document.components[2].size.width+=20;
  const moved=ductWireRoute(document,wire);assert.notDeepEqual(moved.points,first.points);assert.deepEqual(moved.points[0],wireEndpoints(document,wire).from);
  assert.equal(wirePath(JSON.parse(JSON.stringify(document)),wire),wirePath(document,wire));
  const reordered={...document,components:[...document.components].reverse()};assert.deepEqual(ductWireRoute(reordered,wire),moved);
});
test("disconnected nearest entrances keep electrical connection and manual geometry; legacy wires never opt in",()=>{
  const document=doc();document.components=document.components.filter(c=>c.id!=="bridge");
  assert.equal(ductWireRoute(document,wire).reason,"disconnected");assert.deepEqual(wireRoute(document,wire),Object.values(wireEndpoints(document,wire)));
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
  assert.deepEqual(wireRoute(document,wire),Object.values(wireEndpoints(document,wire)));
  assert.deepEqual(wire.from,{componentId:"a",terminalId:"B"});assert.deepEqual(wire.to,{componentId:"b",terminalId:"A"});
});
