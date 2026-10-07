import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { adoptUserNodes, getEdgePosition, ConnectionMode } from '@xyflow/system';
const bundle=await build({stdin:{contents:'export * from "./app/simulator/editor/node-geometry"; export * from "./app/simulator/core/lessons"; export * from "./app/simulator/core/catalog";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {deviceNodeGeometry,createLessonDocument,resolveTerminal,rotateComponent}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
for(let n=1;n<=10;n++)test(`course ${n}: repeated runtime renders preserve initialized edges without DOM remeasurement`,()=>{
  const document=createLessonDocument(`motor-course-${String(n).padStart(2,'0')}`,{wired:true});
  const nodes=new Map(),parents=new Map();
  for(let tick=0;tick<15;tick++){
    adoptUserNodes(document.components.map(c=>({id:c.id,position:c.position,...deviceNodeGeometry(c),data:{tick,running:tick%2===0}})),nodes,parents);
    for(const wire of document.wires){
      const point=getEdgePosition({id:wire.id,sourceNode:nodes.get(wire.from.componentId),targetNode:nodes.get(wire.to.componentId),sourceHandle:wire.from.terminalId,targetHandle:wire.to.terminalId,connectionMode:ConnectionMode.Loose});
      assert.ok(point,`wire ${wire.id} disappeared at render ${tick}`);
      assert.deepEqual({x:point.sourceX,y:point.sourceY},resolveTerminal(document,wire.from).world);
      assert.deepEqual({x:point.targetX,y:point.targetY},resolveTerminal(document,wire.to).world);
    }
  }
});
test('180-degree rotation updates logical handles even when component dimensions stay equal',()=>{
  const document=createLessonDocument('motor-course-01',{wired:true}),strip=document.components.find(c=>c.id===document.roles.xt16);
  const rotated=rotateComponent(rotateComponent(strip));
  const original=deviceNodeGeometry(strip),next=deviceNodeGeometry(rotated);
  assert.deepEqual(original.measured,next.measured);assert.notDeepEqual(original.handles,next.handles);
  const t=next.handles.find(h=>h.id==='T1');
  assert.deepEqual({x:rotated.position.x+t.x,y:rotated.position.y+t.y},resolveTerminal({...document,components:document.components.map(c=>c.id===strip.id?rotated:c)},{componentId:strip.id,terminalId:'T1'}).world);
});
