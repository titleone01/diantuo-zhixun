import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const bundled=await build({stdin:{contents:'export * from "./editor/duct-routing";export * from "./editor/geometry";export * from "./core/catalog";export * from "./core/validation";',resolveDir:fileURLToPath(new URL("../app/simulator/",import.meta.url))},bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent"});
const {ductWireRoute,wireRoute,wirePath,wireEndpoints,validateDocument}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
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
