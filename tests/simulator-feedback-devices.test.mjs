import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const bundled=await build({stdin:{contents:'export * from "./catalog";export * from "./engine";export * from "./validation";export * from "./motor-courses";export * from "./motor-course-assessment";',resolveDir:fileURLToPath(new URL("../app/simulator/core/",import.meta.url))},bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent"});
const {getDefinition,buildCircuitNetwork,initialRuntime,validateDocument,createMotorCourseDocument,assessMotorCourse}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const small=type=>({schemaVersion:1,title:"新器件隔离测试",components:[{id:"device",type,label:"测试",position:{x:0,y:0}}],wires:[]});
for(const type of ["fuse2","terminal-strip16"])test(`${type}: each channel conducts and every other channel is insulated`,()=>{
  const doc=small(type),definition=getDefinition(type),network=buildCircuitNetwork(doc,initialRuntime(doc));
  assert.equal(validateDocument(doc).valid,true);assert.equal(definition.terminals.length,type==="fuse2"?4:32);
  for(const [i,pair] of definition.fixedConnections.entries()){
    assert.equal(network.connected(`device::${pair[0]}`,`device::${pair[1]}`),true);
    for(const [j,other] of definition.fixedConnections.entries())if(i!==j)assert.equal(network.connected(`device::${pair[0]}`,`device::${other[0]}`),false);
    const cut=buildCircuitNetwork(doc,initialRuntime(doc),{excludeFixedConnection:{componentId:"device",terminals:pair}});
    assert.equal(cut.connected(`device::${pair[0]}`,`device::${pair[1]}`),false);
  }
});
for(let n=1;n<=10;n++)test(`course ${n}: combined FU2 and legacy separate fuses pass; a one-pole bypass fails`,()=>{
  const id=`motor-course-${String(n).padStart(2,"0")}`,old=createMotorCourseDocument(id,{wired:true});
  assert.equal(assessMotorCourse(old,id).status,"passed");
  const doc=structuredClone(old);doc.components=doc.components.filter(c=>!["fu2a","fu2b"].includes(c.id));
  doc.components.push({id:"fu2",type:"fuse2",label:"FU2",position:{x:0,y:0}});
  delete doc.roles.fu2a;delete doc.roles.fu2b;doc.roles.fu2="fu2";
  for(const wire of doc.wires)for(const ref of[wire.from,wire.to]){
    if(ref.componentId==="fu2a")ref.componentId="fu2";
    else if(ref.componentId==="fu2b"){ref.componentId="fu2";ref.terminalId=ref.terminalId==="1"?"3":"4";}
  }
  assert.equal(assessMotorCourse(doc,id).status,"passed");
  doc.wires.push({id:"bypass",from:{componentId:"fu2",terminalId:"1"},to:{componentId:"fu2",terminalId:"2"},color:"#666"});
  assert.notEqual(assessMotorCourse(doc,id).status,"passed");
});
