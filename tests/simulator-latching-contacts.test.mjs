import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['app/simulator/core/engine.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { simulate, buildCircuitNetwork } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const component = (id, type) => ({id,type,label:id,position:{x:0,y:0}});
const circuit = (...components) => ({schemaVersion:1,title:'保持型复合触点转换',components:[component('source','supply'),...components],wires:[]});
const wire = (doc,a,at,b,bt) => doc.wires.push({id:`wire-${doc.wires.length}`,from:{componentId:a,terminalId:at},to:{componentId:b,terminalId:bt},color:'#777777'});
const toggle = (doc,result,id) => simulate(doc,result.runtime,{type:'toggle',componentId:id});

for (const type of ['push-latching-red','push-latching-green']) for (const direct of ['nc','no']) test(`${type}: ${direct.toUpperCase()} to the opposite self-hold path first releases KM, without restart on idle/reset`, () => {
  const doc=circuit(component('sb',type),component('km','contactor380'),component('stop','push-nc'),component('fr','overload'));
  wire(doc,'source','L1','stop','11');wire(doc,'stop','12','fr','95');wire(doc,'fr','96','sb','11');wire(doc,'fr','96','sb','23');
  const directOutput=direct==='nc'?'12':'24', holdOutput=direct==='nc'?'24':'12';
  wire(doc,'sb',directOutput,'km','A1');wire(doc,'sb',holdOutput,'km','13');wire(doc,'km','14','km','A1');wire(doc,'km','A2','source','L2');
  let result=simulate(doc);
  if(direct==='no')result=toggle(doc,result,'sb');
  assert.equal(result.components.km.active,true);
  result=toggle(doc,result,'sb');
  assert.equal(result.components.km.active,false,'both button contacts open before the opposite self-hold path closes');
  assert.equal(result.runtime.faultLatched,false);assert.equal(result.supported,true);
  result=simulate(doc,result.runtime);assert.equal(result.components.km.active,false);
  for(const action of [{type:'press',componentId:'stop'},{type:'release',componentId:'stop'},{type:'trip-overload',componentId:'fr'},{type:'reset-overload',componentId:'fr'},{type:'power',enabled:false},{type:'power',enabled:true}]) {
    result=simulate(doc,result.runtime,action);assert.equal(result.components.km.active,false,'a restored self-hold path cannot energize a released coil');
  }
});

for(const initialPressed of [false,true]) test(`latching transition from ${initialPressed?'NO':'NC'} retains a fault visible only in the open interval`,()=>{
  const doc=circuit(component('sb','push-latching-green'),component('km','contactor380'),component('gate','switch1'));
  for(const input of ['11','23'])wire(doc,'source','L1','sb',input);
  for(const output of ['12','24'])wire(doc,'sb',output,'km','A1');
  wire(doc,'km','A2','source','L2');wire(doc,'source','L1','gate','1');wire(doc,'gate','2','km','21');wire(doc,'km','22','source','L2');
  let result=simulate(doc);if(initialPressed)result=toggle(doc,result,'sb');
  assert.equal(result.components.km.active,true);result=toggle(doc,result,'gate');assert.equal(result.runtime.faultLatched,false);
  result=toggle(doc,result,'sb');assert.equal(result.runtime.faultLatched,true);assert.equal(result.runtime.powerOn,false);
  const cause=result.diagnostics.find(item=>item.code==='PHASE_SHORT');assert.ok(cause);assert.ok(cause.wireIds.length);
  result=toggle(doc,result,'sb');result=simulate(doc,result.runtime,{type:'power',enabled:true});
  assert.equal(result.runtime.faultLatched,true);assert.deepEqual(result.diagnostics.find(item=>item.code==='PHASE_SHORT'),cause);
});

test('latching selector changes between two electrically interlocked coils in both directions',()=>{
  const doc=circuit(component('selector','push-latching-red'),component('km1','contactor380'),component('km2','contactor380'));
  wire(doc,'source','L1','selector','11');wire(doc,'source','L1','selector','23');
  wire(doc,'selector','12','km2','21');wire(doc,'km2','22','km1','A1');
  wire(doc,'selector','24','km1','21');wire(doc,'km1','22','km2','A1');
  wire(doc,'source','L2','km1','A2');wire(doc,'source','L2','km2','A2');
  let result=simulate(doc);assert.equal(result.components.km1.active,true);assert.equal(result.components.km2.active,false);
  result=toggle(doc,result,'selector');assert.equal(result.components.km1.active,false);assert.equal(result.components.km2.active,true);
  result=toggle(doc,result,'selector');assert.equal(result.components.km1.active,true);assert.equal(result.components.km2.active,false);
  assert.equal(result.supported,true);assert.equal(result.runtime.faultLatched,false);
});

test('double-throw switches and breakers are not silently assigned latching-button open intervals',()=>{
  const doc=circuit(component('switch','switch2'),component('qf','breaker3'),component('km','contactor380'));
  wire(doc,'source','L1','switch','C');wire(doc,'switch','1','km','A1');wire(doc,'switch','2','km','13');wire(doc,'km','14','km','A1');wire(doc,'km','A2','source','L2');
  let result=simulate(doc);assert.equal(result.components.km.active,true);
  result=toggle(doc,result,'switch');assert.equal(result.components.km.active,true,'the existing double-throw transition contract is unchanged');
  result=toggle(doc,result,'qf');
  const net=buildCircuitNetwork(doc,result.runtime,{openLatchingContacts:'qf'});
  assert.equal(net.connected('qf::1','qf::2'),true);assert.equal(net.connected('qf::3','qf::4'),true);assert.equal(net.connected('qf::5','qf::6'),true);
});
