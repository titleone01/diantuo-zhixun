import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const bundled=await build({stdin:{contents:'export * from "./lessons";export * from "./engine";export * from "./validation";',resolveDir:fileURLToPath(new URL("../app/simulator/core/",import.meta.url))},bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent"});
const {createLessonDocument,assessLesson,validateDocument}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
for(let n=1;n<=10;n++)test(`course ${n}: editable blank placement includes FU2, XT16 and connected ducts; its wired equivalent passes`,()=>{
  const id=`motor-course-${String(n).padStart(2,"0")}`,blank=createLessonDocument(id),wired=createLessonDocument(id,{wired:true});
  assert.equal(validateDocument(blank).valid,true);assert.equal(blank.wires.length,0);assert.equal(blank.components.filter(c=>c.type==="fuse2").length,1);assert.equal(blank.components.filter(c=>c.type==="terminal-strip16").length,n===6?2:1);assert.equal(blank.components.filter(c=>c.type.startsWith("wire-duct")).length,6);
  assert.equal(blank.roles.fu2,"fu2");assert.equal(blank.roles.xt16,"xt16");assert.equal(blank.roles["duct-left"],undefined);
  assert.notEqual(assessLesson(blank).status,"passed");assert.equal(assessLesson(wired).status,"passed");
  assert.ok(wired.components.find(c=>c.type.startsWith("motor")).position.y>blank.components.find(c=>c.id==="xt16").position.y);
  if(n===1)assert.equal(blank.components.some(c=>c.type==="overload"),false);
  if(n===6)assert.equal(blank.components.filter(c=>c.type==="limit-switch").length,4);
  if(n===9){
    assert.equal(blank.components.filter(c=>c.type.startsWith("push-")).length,3);
    const spare=blank.components.find(c=>c.id===blank.roles.sb3);
    assert.match(spare.label,/预留不接线/);
    assert.ok(wired.wires.every(w=>w.from.componentId!==spare.id && w.to.componentId!==spare.id));
  }
});
