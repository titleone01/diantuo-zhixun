import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundle=await build({stdin:{contents:'export * from "./app/simulator/core/catalog";export * from "./app/simulator/core/validation";export * from "./app/simulator/core/engine";export * from "./app/simulator/editor/node-geometry";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {mirrorComponent,rotateComponent,componentSize,resolveTerminal,getDefinition,validateDocument,deviceNodeGeometry,simulate,initialRuntime}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const component=(id,type)=>({id,type,label:id,position:{x:40,y:70}});
const doc=(components,wires=[])=>({schemaVersion:1,title:'镜像旋转与PE槽位验收',components,wires});
const wire=(id,a,ap,b,bp)=>({id,from:{componentId:a,terminalId:ap},to:{componentId:b,terminalId:bp},color:'#e2bc20'});

test('supply mirror puts all five ordered terminals above the label and persists stable world anchors',()=>{
  const original=component('s','supply'),mirrored=mirrorComponent(original),document=doc([mirrored]);
  assert.equal(mirrored.rotation,0);assert.equal(mirrored.mirrored,true);
  assert.deepEqual(componentSize(original),componentSize(mirrored));
  const xs=[];
  for(const id of ['L1','L2','L3','N','PE']){
    const resolved=resolveTerminal(document,{componentId:'s',terminalId:id});
    assert.equal(resolved.terminal.side,'top');assert.equal(resolved.terminal.y,12);xs.push(resolved.world.x);
    const handle=deviceNodeGeometry(mirrored).handles.find(h=>h.id===id);
    assert.deepEqual({x:mirrored.position.x+handle.x,y:mirrored.position.y+handle.y},resolved.world);
    assert.deepEqual(resolveTerminal(JSON.parse(JSON.stringify(document)),{componentId:'s',terminalId:id}),resolved);
  }
  assert.deepEqual(xs,[...xs].sort((a,b)=>a-b));
  assert.equal(mirrorComponent(mirrored).mirrored,false);
  assert.equal(validateDocument(document).valid,true);
  assert.equal(validateDocument(doc([{...original,rotation:270}])).valid,true,'historical rotations remain readable');
});

test('rotating a limit switch preserves its center, contact IDs and all terminal world anchors',()=>{
  let current=component('sq','limit-switch');const original={...current};
  const center={x:current.position.x+componentSize(current).width/2,y:current.position.y+componentSize(current).height/2};
  for(let turn=0;turn<4;turn++){
    current=rotateComponent(current);const document=doc([current]);
    assert.equal(validateDocument(document).valid,true);
    assert.equal(current.position.x+componentSize(current).width/2,center.x);
    assert.equal(current.position.y+componentSize(current).height/2,center.y);
    for(const handle of deviceNodeGeometry(current).handles)assert.deepEqual({x:current.position.x+handle.x,y:current.position.y+handle.y},resolveTerminal(document,{componentId:'sq',terminalId:handle.id}).world);
  }
  assert.deepEqual(current.position,original.position);assert.equal(current.rotation,0);
  assert.equal(validateDocument(doc([{...current,mirrored:true}])).valid,false);
});

test('20-position block matches vector dimensions, keeps every slot isolated and validates PE metadata',async()=>{
  const definition=getDefinition('terminal-strip20');
  assert.equal(definition.terminals.length,40);assert.equal(definition.fixedConnections.length,20);
  const svg=await readFile(new URL('../public/sim-assets/terminal-strip20.svg',import.meta.url),'utf8');
  assert.match(svg,/viewBox="0 0 911.25 76.125"/);assert.match(svg,/>20<\/text>/);
  const strip={...component('xt','terminal-strip20'),pePositions:[5]};
  assert.equal(validateDocument(doc([strip])).valid,true);
  assert.equal(resolveTerminal(doc([strip]),{componentId:'xt',terminalId:'T5'}).terminal.electrical,'earth');
  assert.equal(resolveTerminal(doc([strip]),{componentId:'xt',terminalId:'T4'}).terminal.electrical,'contact');
  for(const pePositions of [[0],[21],[5,5],['5'],[1.2],null])assert.equal(validateDocument(doc([{...strip,pePositions}])).valid,false);
});

test('integrated PE slot conducts protective earth and still detects neutral/phase misuse',()=>{
  const source=component('s','supply'),motor=component('m','motor'),strip={...component('xt','terminal-strip20'),pePositions:[5]};
  const wires=[wire('in','s','PE','xt','T5'),wire('out','xt','B5','m','PE')];
  const document=doc([source,motor,strip],wires);
  assert.equal(simulate(document,initialRuntime(document)).diagnostics.some(d=>d.code==='PE_MISSING'),false);
  const missing=doc(document.components,[wires[0]]);
  assert.equal(simulate(missing,initialRuntime(document)).diagnostics.some(d=>d.code==='PE_MISSING'),true);
  for(const [supplyPin,code] of [['N','EARTH_TERMINAL_NEUTRAL'],['L1','EARTH_TERMINAL_LIVE']]){
    const bad=doc(document.components,[wire('bad','s',supplyPin,'xt','T5')]);
    assert.ok(simulate(bad,{...initialRuntime(document),powerOn:true}).diagnostics.some(d=>d.code===code));
  }
});
