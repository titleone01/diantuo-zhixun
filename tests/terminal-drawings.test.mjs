import assert from 'node:assert/strict';
import test from 'node:test';
import { createSchematicModel, loadDrawingCore, renderLayout, renderSchematic, validateDrawingTopology, wireNodes, wireJunctions } from '../scripts/prepare-terminal-drawings.mjs';

const core=await loadDrawingCore();
for(let number=1;number<=10;number++)test(`course ${number}: revised drawings preserve every physical wire, fixed bridge and all 16 terminal positions`,()=>{
  const document=core.createLessonDocument(`motor-course-${String(number).padStart(2,'0')}`,{wired:true}),before=JSON.stringify(document);
  const model=createSchematicModel(core,document),drawing=renderSchematic(core,document),result=validateDrawingTopology(core,document,drawing);
  assert.equal(result.status,'passed');assert.equal(result.wireCount,document.wires.length);
  for(const connection of drawing.connections){assert.deepEqual(connection.points[0],model.anchors.get(`${connection.from.componentId}::${connection.from.terminalId}`));assert.deepEqual(connection.points.at(-1),model.anchors.get(`${connection.to.componentId}::${connection.to.terminalId}`));}
  for(const strip of document.components.filter(c=>c.type==='terminal-strip16'))for(let position=1;position<=16;position++)assert.ok(drawing.svg.includes(`data-fixed-component="${strip.id}" data-fixed-a="T${position}" data-fixed-b="B${position}"`));
  const layout=renderLayout(core,document);for(const component of document.components.filter(c=>!core.isLayoutObject(c.type)))assert.ok(layout.svg.includes(`data-component-id="${component.id}"`));
  assert.ok(drawing.svg.includes('N 不参与 380V 控制，PE 独立'));
  assert.equal(JSON.stringify(document),before,'drawing generation cannot mutate source practice');
});

test('topology verification rejects a missing wire, swapped terminal and omitted fixed bridge',()=>{
  const document=core.createLessonDocument('motor-course-01',{wired:true}),drawing=renderSchematic(core,document);
  assert.throws(()=>validateDrawingTopology(core,document,{...drawing,svg:drawing.svg.replace('data-wire-id=','data-removed-wire-id=')}));
  assert.throws(()=>validateDrawingTopology(core,document,{...drawing,svg:drawing.svg.replace('data-from="','data-from="wrong-')}));
  assert.throws(()=>validateDrawingTopology(core,document,{...drawing,svg:drawing.svg.replace('data-fixed-component=','data-removed-fixed-component=')}));
});

test('wire node labels never short a normally closed contact or a coil',()=>{
  const document=core.createLessonDocument('motor-course-02',{wired:true}),nodes=wireNodes(document);
  const contactor=document.components.find(c=>c.type==='contactor380');
  assert.notEqual(nodes.get(`${contactor.id}::A1`),nodes.get(`${contactor.id}::A2`));
  assert.notEqual(nodes.get(`${document.roles.sb1}::11`),nodes.get(`${document.roles.sb1}::12`));
});

test('same-node T branches receive dots; unrelated crossing wires never do',()=>{
  const horizontal={node:'N01',points:[{x:0,y:20},{x:40,y:20}]},vertical={node:'N02',points:[{x:20,y:0},{x:20,y:40}]};
  assert.deepEqual(wireJunctions([horizontal,vertical]),[]);
  assert.deepEqual(wireJunctions([horizontal,{...vertical,node:'N01'}]),[{x:20,y:20,node:'N01'}]);
  assert.deepEqual(wireJunctions([horizontal,{node:'N01',points:[{x:20,y:20},{x:20,y:40}]}]),[{x:20,y:20,node:'N01'}]);
});
