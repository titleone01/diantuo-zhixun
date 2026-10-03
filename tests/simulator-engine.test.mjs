import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

// Bundle the same browser/server pure TypeScript modules, rather than copying their logic.
const bundled = await build({stdin:{contents:'export * from "./engine";export * from "./lessons";export * from "./catalog";export * from "./validation";export * from "../editor/geometry";',resolveDir:fileURLToPath(new URL("../app/simulator/core/",import.meta.url))},bundle:true,format:"esm",platform:"node",write:false,logLevel:"silent"});
const {simulate,initialRuntime,assessLesson,createLessonDocument,LESSONS,CATALOG,getDefinition,componentSize,resolveTerminal,validateDocument,wireEndpoints,wireRoute,wirePath}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const wired = (id="motor-self-hold") => createLessonDocument(id,{wired:true});
const connect=(doc,a,at,b,bt)=>doc.wires.push({id:`test-${doc.wires.length}`,from:{componentId:a,terminalId:at},to:{componentId:b,terminalId:bt},color:"#a855f7"});
const has=(result,code)=>result.diagnostics.some(d=>d.code===code);
const run=(doc,events)=>events.reduce((result,event)=>simulate(doc,result.runtime,event),simulate(doc,initialRuntime(doc)));
const startEvents=[{type:"toggle",componentId:"breaker"},{type:"press",componentId:"start"}];
const device=(id,type)=>({id,type,label:id,position:{x:0,y:0}});
const small=(...components)=>({schemaVersion:1,title:"电气测试",components:[device("source","supply"),...components],wires:[]});

for(const lesson of LESSONS)test(`new simulator: ${lesson.id} reference topology passes behavioral assessment`,()=>{
  const doc=wired(lesson.id),before=JSON.stringify(doc),result=assessLesson(doc);
  assert.equal(result.status,"passed",JSON.stringify(result));assert.equal(result.passed,result.total);assert.equal(JSON.stringify(doc),before,"assessment must not mutate the user scene");
});

test("new simulator: blank lesson is incomplete, never successful merely because it is safe",()=>{
  const doc=createLessonDocument("motor-self-hold");assert.equal(assessLesson(doc).status,"incomplete");
  const result=run(doc,startEvents);assert.equal(result.components.motor.active,false);assert.equal(result.components.km.active,false);
});

test("new simulator: jogging needs continuous button pressure",()=>{
  const doc=wired("motor-jog");let result=run(doc,startEvents);assert.equal(result.components.motor.active,true);
  result=simulate(doc,result.runtime,{type:"release",componentId:"start"});assert.equal(result.components.km.active,false);assert.equal(result.components.motor.active,false);
});

test("new simulator: self-hold persists after release; stop dominates even with START held",()=>{
  const doc=wired();let result=run(doc,[...startEvents,{type:"release",componentId:"start"}]);assert.equal(result.components.motor.active,true);
  result=simulate(doc,result.runtime,{type:"press",componentId:"start"});result=simulate(doc,result.runtime,{type:"press",componentId:"stop"});assert.equal(result.components.motor.active,false);
  result=simulate(doc,result.runtime,{type:"release",componentId:"start"});result=simulate(doc,result.runtime,{type:"release",componentId:"stop"});assert.equal(result.components.km.active,false);
});

test("new simulator: missing latch is reported but not falsely treated as a short",()=>{
  const doc=wired();doc.wires=doc.wires.filter(w=>!(w.to.componentId==="km"&&w.to.terminalId==="14"));
  const result=assessLesson(doc);assert.notEqual(result.status,"passed");assert.equal(has(result,"SELF_HOLD_MISSING"),true);assert.equal(has(result,"PHASE_SHORT"),false);
});

test("new simulator: overload changes contacts; a bypass remains electrically powered and is diagnosed",()=>{
  const doc=wired();connect(doc,"fr","95","fr","96");let result=run(doc,[...startEvents,{type:"release",componentId:"start"},{type:"trip-overload",componentId:"fr"}]);
  assert.equal(result.components.motor.active,true,"do not hard-code the overload state into motor logic");
  const assessment=assessLesson(doc),failure=assessment.diagnostics.find(d=>d.code==="OVERLOAD_INEFFECTIVE");assert.equal(assessment.status,"failed");assert.ok(failure);assert.ok(failure.wireIds.length>0);assert.ok(failure.componentIds.includes("fr"));
});

test("new simulator: overload RESET and restored supply do not spontaneously restart",()=>{
  const doc=wired();let result=run(doc,[...startEvents,{type:"release",componentId:"start"},{type:"trip-overload",componentId:"fr"}]);assert.equal(result.components.motor.active,false);
  result=simulate(doc,result.runtime,{type:"reset-overload",componentId:"fr"});assert.equal(result.components.motor.active,false);
  result=simulate(doc,result.runtime,{type:"press",componentId:"start"});result=simulate(doc,result.runtime,{type:"release",componentId:"start"});assert.equal(result.components.motor.active,true);
  result=simulate(doc,result.runtime,{type:"power",enabled:false});result=simulate(doc,result.runtime,{type:"power",enabled:true});assert.equal(result.components.motor.active,false);
});

test("new simulator: detects a downstream short only when the breaker closes, with path evidence",()=>{
  const doc=wired();connect(doc,"breaker","2","breaker","4");let result=simulate(doc,initialRuntime(doc));assert.equal(has(result,"PHASE_SHORT"),false);
  result=simulate(doc,result.runtime,{type:"toggle",componentId:"breaker"});const fault=result.diagnostics.find(d=>d.code==="PHASE_SHORT");assert.ok(fault);assert.equal(result.runtime.faultLatched,true);assert.equal(result.components.motor.active,false);assert.ok(fault.wireIds.includes(doc.wires.at(-1).id));assert.ok(fault.terminalIds.includes("breaker::2"));
});

test("new simulator: a contactor-closing short is checked during fixed-point iteration",()=>{
  const doc=wired();connect(doc,"km","2","km","4");let result=run(doc,[{type:"toggle",componentId:"breaker"}]);assert.equal(has(result,"PHASE_SHORT"),false);
  result=simulate(doc,result.runtime,{type:"press",componentId:"start"});assert.equal(has(result,"PHASE_SHORT"),true);assert.equal(result.runtime.faultLatched,true);assert.equal(result.components.km.active,false);
});

test("new simulator: phase-neutral and phase-earth wire shorts are different diagnostics",()=>{
  for(const [terminal,code] of [["N","PHASE_NEUTRAL_SHORT"],["PE","PHASE_EARTH_SHORT"]]){const doc=small();connect(doc,"source","L1","source",terminal);const result=simulate(doc,initialRuntime(doc));assert.equal(has(result,code),true);assert.equal(result.runtime.faultLatched,true);}
});

test("new simulator: 220V L-N and 380V phase-phase coils operate, wrong voltage does not",()=>{
  for(const [type,returnPort,expected] of [["contactor220","N",true],["contactor380","L2",true],["contactor220","L2",false],["contactor380","N",false]]){
    const doc=small(device("km",type));connect(doc,"source","L1","km","A1");connect(doc,"source",returnPort,"km","A2");const result=simulate(doc,initialRuntime(doc));assert.equal(result.components.km.active,expected);assert.equal(has(result,"COIL_VOLTAGE_MISMATCH"),!expected);
  }
});

test("new simulator: same-phase and open-return coils remain released",()=>{
  const doc=small(device("km","contactor220"));connect(doc,"source","L1","km","A1");let result=simulate(doc,initialRuntime(doc));assert.equal(result.components.km.active,false);assert.equal(has(result,"OPEN_CONTROL_PATH"),true);
  connect(doc,"source","L1","km","A2");result=simulate(doc,initialRuntime(doc));assert.equal(result.components.km.voltage,0);assert.equal(result.components.km.active,false);
});

test("new simulator: PE is an explicit motor terminal and cannot serve as a neutral return",()=>{
  assert.ok(getDefinition("motor").terminals.some(t=>t.id==="PE"));
  for(const [type,a,b] of [["contactor220","A1","A2"],["lamp","L","N"]]){const doc=small(device("load",type));connect(doc,"source","L1","load",a);connect(doc,"source","PE","load",b);const result=simulate(doc,initialRuntime(doc));assert.equal(has(result,"EARTH_AS_RETURN"),true);assert.equal(result.components.load.active,false);assert.equal(result.runtime.faultLatched,true);}
});

test("new simulator: missing PE fails safety without pretending it prevents motor energization",()=>{
  const doc=wired();doc.wires=doc.wires.filter(w=>!(w.to.componentId==="motor"&&w.to.terminalId==="PE"));const result=run(doc,startEvents);assert.equal(result.components.motor.active,true);assert.equal(has(result,"PE_MISSING"),true);assert.notEqual(assessLesson(doc).status,"passed");
});

test("new simulator: phase loss and reverse rotation are reported separately from contactor pickup",()=>{
  const missing=wired();missing.wires=missing.wires.filter(w=>!(w.to.componentId==="motor"&&w.to.terminalId==="W"));const absent=run(missing,startEvents);assert.equal(absent.components.km.active,true);assert.equal(absent.components.motor.active,false);assert.equal(has(absent,"MOTOR_PHASE_MISSING"),true);
  const reversed=wired();for(const w of reversed.wires)if(w.to.componentId==="motor"&&["U","V"].includes(w.to.terminalId))w.to.terminalId=w.to.terminalId==="U"?"V":"U";const swapped=run(reversed,startEvents);assert.equal(swapped.components.motor.active,true);assert.equal(swapped.components.motor.direction,"reverse");assert.notEqual(assessLesson(reversed).status,"passed");
});

test("new simulator: a genuine series-load topology is unsupported, not mistaken for open wiring or a short",()=>{
  const doc=small(device("a","contactor220"),device("b","contactor220"));connect(doc,"source","L1","a","A1");connect(doc,"a","A2","b","A1");connect(doc,"b","A2","source","N");const result=simulate(doc,initialRuntime(doc));assert.equal(result.supported,false);assert.equal(has(result,"UNSUPPORTED_LOAD_NETWORK"),true);assert.equal(has(result,"PHASE_SHORT"),false);
});

test("new simulator: a dangling parallel branch does not make the complete load unsupported",()=>{
  const doc=small(device("a","contactor220"),device("b","contactor220"));connect(doc,"source","L1","a","A1");connect(doc,"source","N","a","A2");connect(doc,"source","N","b","A2");const result=simulate(doc,initialRuntime(doc));assert.equal(result.supported,true);assert.equal(result.components.a.active,true);assert.equal(result.components.b.active,false);
});

test("new simulator: self-interrupting NC coil oscillation has bounded termination",()=>{
  const doc=small(device("km","contactor220"));connect(doc,"source","L1","km","21");connect(doc,"km","22","km","A1");connect(doc,"source","N","km","A2");const result=simulate(doc,initialRuntime(doc));assert.equal(result.supported,false);assert.equal(has(result,"UNSTABLE_CONTACTOR_LOOP"),true);assert.equal(result.runtime.faultLatched,true);
});

test("new simulator: intermediate terminals, wire direction, colors and screen placement preserve equivalence",()=>{
  const doc=wired(),original=doc.wires[0];doc.components.push(device("junction","terminal"));doc.wires[0]={...original,to:{componentId:"junction",terminalId:"A"}};connect(doc,"junction","B",original.to.componentId,original.to.terminalId);
  for(const wire of doc.wires){[wire.from,wire.to]=[wire.to,wire.from];wire.color="#c026d3";wire.waypoints=[{x:3,y:900}];}
  doc.components[0].position={x:9999,y:-180};const result=assessLesson(doc);assert.equal(result.status,"passed",JSON.stringify(result));
  const world=resolveTerminal(doc,{componentId:"source",terminalId:"L1"}).world;assert.deepEqual(world,{x:10024,y:-122});
});

test("new simulator: reversing the order of series STOP and overload control contacts remains valid",()=>{
  const doc=wired();const edits=new Map([["fuse::2",["fr","95"]],["stop::12",["start","23"]],["fr::96",["stop","11"]]]);
  for(const wire of doc.wires){const change=edits.get(`${wire.from.componentId}::${wire.from.terminalId}`);if(change)wire.to={componentId:change[0],terminalId:change[1]};}
  assert.equal(assessLesson(doc).status,"passed");
});

test("new simulator: crossed traveller wires remain a valid two-way lighting circuit",()=>{
  const doc=wired("lighting-two-way");for(const w of doc.wires)if(w.from.componentId==="switchA"&&w.to.componentId==="switchB")w.to.terminalId=w.to.terminalId==="1"?"2":"1";assert.equal(assessLesson(doc).status,"passed");
});

test("new simulator: switching neutral fails despite the lamp toggling",()=>{
  const doc=wired("lighting-single");doc.wires=[];connect(doc,"source","L1","breaker","1");connect(doc,"breaker","2","lamp","L");connect(doc,"lamp","N","switchA","1");connect(doc,"switchA","2","source","N");const result=assessLesson(doc);assert.equal(result.status,"failed");assert.equal(has(result,"SWITCHED_NEUTRAL"),true);
});

test("new simulator: permanent fuse bypass is rejected by functional isolation, not edge matching",()=>{
  const doc=wired();connect(doc,"fuse","1","fuse","2");assert.equal(run(doc,startEvents).components.motor.active,true);assert.equal(has(assessLesson(doc),"PROTECTION_BYPASS"),true);
});

test("new simulator: import guard rejects invalid references, versions, duplicate edges and unsafe IDs",()=>{
  const valid=wired();assert.equal(validateDocument(valid).valid,true);
  for(const mutate of [d=>{d.schemaVersion=99;},d=>{d.components[0].id="__proto__";},d=>{d.wires[0].to.terminalId="missing";},d=>{d.components[0].position.x=Infinity;},d=>{d.wires.push({...d.wires[0],id:"duplicate-edge"});},d=>{d.wires[0].color="url(evil)";}]){const doc=structuredClone(valid);mutate(doc);assert.equal(validateDocument(doc).valid,false);}
});

test("new simulator: no lesson is unsupported for grading; multiple supplies unsupported for electrical solving",()=>{
  const doc=small();assert.equal(assessLesson(doc).status,"unsupported");doc.components.push(device("supply2","supply"));const result=simulate(doc,initialRuntime(doc));assert.equal(result.supported,false);assert.equal(has(result,"MULTIPLE_SOURCES_UNSUPPORTED"),true);
});

test("new simulator: a latched teaching fault requires explicit reset and re-enabling power",()=>{
  const doc=small();connect(doc,"source","L1","source","L2");let result=simulate(doc,initialRuntime(doc));assert.equal(result.runtime.faultLatched,true);doc.wires=[];result=simulate(doc,result.runtime,{type:"power",enabled:true});assert.equal(result.components.source.active,false);result=simulate(doc,result.runtime,{type:"reset-fault"});assert.equal(result.runtime.powerOn,false);result=simulate(doc,result.runtime,{type:"power",enabled:true});assert.equal(result.components.source.active,true);
});

test("new simulator: invalid imported documents fail closed before runtime initialization",()=>{
  for(const doc of [null,{schemaVersion:1}, {...wired(),components:[device("invalid","unknown-type")]}]){
    const result=simulate(doc);assert.equal(result.supported,false);assert.equal(result.runtime.powerOn,false);assert.equal(has(result,"INVALID_DOCUMENT"),true);
  }
});

test("new simulator: upper and lower A2 are equivalent; both compound-button contacts follow pressure",()=>{
  const doc=wired();for(const wire of doc.wires)for(const endpoint of [wire.from,wire.to])if(endpoint.componentId==="km"&&endpoint.terminalId==="A2")endpoint.terminalId="A2_top";
  assert.equal(assessLesson(doc).status,"passed");
  const button=small(device("button","push-no"));connect(button,"source","L1","button","11");connect(button,"source","L2","button","23");
  let result=simulate(button);assert.equal(result.terminals["button::12"].potential,"L1");assert.equal(result.terminals["button::24"].potential,"floating");
  result=simulate(button,result.runtime,{type:"press",componentId:"button"});assert.equal(result.terminals["button::12"].potential,"floating");assert.equal(result.terminals["button::24"].potential,"L2");
});

test("new simulator: the two visible terminal-block poles are insulated from one another",()=>{
  const doc=small(device("block","terminal"));connect(doc,"source","L1","block","A");connect(doc,"source","L2","block","A2");
  const result=simulate(doc);assert.equal(result.runtime.faultLatched,false);assert.equal(result.terminals["block::B"].potential,"L1");assert.equal(result.terminals["block::B2"].potential,"L2");
});

test("new simulator: sprites retain original aspect ratio and calibrated handles stay inside each drawing",()=>{
  for(const def of CATALOG){
    for(const pin of def.terminals){assert.ok(pin.x>=0&&pin.x<=def.width,`${def.type}/${pin.id} x`);assert.ok(pin.y>=0&&pin.y<=def.height,`${def.type}/${pin.id} y`);}
    if(["supply","pe-terminal","wire-duct","wire-duct-vertical"].includes(def.type))continue;
    const source={"auxiliary-no":"contactor380","relay380":"relay220","motor-star-delta":"motor6","motor-dahlander":"motor6"}[def.type]??def.type;
    const svg=readFileSync(new URL(`../public/sim-assets/${source}.svg`,import.meta.url),"utf8");
    const scale=def.type==="relay380"?2.5:def.type==="auxiliary-no"?1.5:def.type==="terminal"?0.75:1;
    const crop=def.type==="auxiliary-no"?{x:112,y:31,width:39.5,height:137}:{x:0,y:0};
    const viewbox=svg.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
    const width=Number(svg.match(/\bwidth="([\d.]+)(?:px)?"/)?.[1]??viewbox?.[2]);
    const height=Number(svg.match(/\bheight="([\d.]+)(?:px)?"/)?.[1]??viewbox?.[3]);
    assert.ok(Math.abs(def.width-(crop.width??width)*scale)<0.001,`${def.type} width`);assert.ok(Math.abs(def.height-(crop.height??height)*scale)<0.001,`${def.type} height`);
    const circles=[...svg.matchAll(/<path\b[^>]*>/g)].flatMap(([path])=>{
      const d=path.match(/\bd="([^"]+)"/)?.[1];
      const relayCircle=d?.match(/^M([\d.]+),([\d.]+)c2\.21,0,4,1\.79,4,4s-1\.79,4-4,4-4-1\.79-4-4,1\.79-4,4-4Z$/);
      if(relayCircle)return [{x:(Number(relayCircle[1])-crop.x)*scale,y:(Number(relayCircle[2])+4-crop.y)*scale}];
      if(!d||/[LHVAQ]/i.test(d)||(d.match(/C/g)??[]).length!==4)return [];
      const pairs=[...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(m=>[Number(m[1]),Number(m[2])]);
      const xs=pairs.map(p=>p[0]),ys=pairs.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
      return Math.abs((maxX-minX)-(maxY-minY))<0.02?[{x:((minX+maxX)/2-crop.x)*scale,y:((minY+maxY)/2-crop.y)*scale}]:[];
    });
    for(const pin of def.terminals)assert.ok(circles.some(c=>Math.abs(c.x-pin.x)<0.01&&Math.abs(c.y-pin.y)<0.01),`${def.type}/${pin.id} must align to an actual vector circle center`);
  }
});

test("new simulator: rendered wire routes use instance-local terminal coordinates through moves and reloads",()=>{
  const doc=wired(),wire=doc.wires[0],savedRefs=JSON.stringify({from:wire.from,to:wire.to});
  const initial=wireEndpoints(doc,wire),initialPath=wirePath(doc,wire);
  assert.deepEqual(initial,{from:resolveTerminal(doc,wire.from).world,to:resolveTerminal(doc,wire.to).world});
  doc.components.find(c=>c.id===wire.from.componentId).position.x+=143.75;
  const moved=wireEndpoints(doc,wire);assert.equal(moved.from.x,initial.from.x+143.75);assert.deepEqual(moved.to,initial.to);assert.notEqual(wirePath(doc,wire),initialPath);assert.equal(JSON.stringify({from:wire.from,to:wire.to}),savedRefs);
  wire.waypoints=[{x:-11.25,y:600.5},{x:420.25,y:2.5}];const route=wireRoute(doc,wire);
  assert.deepEqual(route[0],moved.from);assert.deepEqual(route.at(-1),moved.to);
  for(let i=1;i<route.length;i++)assert.ok(route[i].x===route[i-1].x||route[i].y===route[i-1].y,"orthogonal segment");
  const reloaded=JSON.parse(JSON.stringify(doc));assert.deepEqual(wireEndpoints(reloaded,reloaded.wires[0]),moved);assert.equal(wirePath(reloaded,reloaded.wires[0]),wirePath(doc,wire));
  assert.equal(assessLesson(reloaded).status,"passed");
});

test('duct instance size survives validation and reload while schema 1 documents retain their default footprint',()=>{
  for(const type of ['wire-duct','wire-duct-vertical']) {
    const doc=small(device('duct',type)), duct=doc.components[1], definition=getDefinition(type);
    assert.equal(validateDocument(doc).valid,true);
    assert.deepEqual(componentSize(duct),{width:definition.width,height:definition.height});
    for(const size of [{width:24,height:4000},{width:4000,height:24},{width:620.5,height:80.25}]) {
      duct.size=size;const checked=validateDocument(JSON.parse(JSON.stringify(doc)));
      assert.equal(checked.valid,true);assert.equal(checked.document.schemaVersion,1);
      assert.deepEqual(componentSize(checked.document.components[1]),size);
    }
    for(const size of [{width:23.9,height:100},{width:100,height:4000.1},{width:NaN,height:100},{width:100},{width:100,height:100,depth:5}]) {
      duct.size=size;assert.equal(validateDocument(doc).valid,false);
    }
  }
  const doc=small(device('km','contactor380'));doc.components[1].size={width:100,height:100};
  assert.equal(validateDocument(doc).valid,false,'electrical devices cannot acquire duct-only resize metadata');
});

test('compact terminal poles retain isolated electrical identities and exact scaled SVG coordinates',()=>{
  const block=getDefinition('terminal'),pe=getDefinition('pe-terminal');
  assert.equal(block.width,121.5*.75);assert.equal(block.height,101.5*.75);
  assert.equal(pe.width,60.75*.75);assert.equal(pe.height,101.5*.75);
  assert.deepEqual(block.terminals.map(pin=>[pin.id,pin.x,pin.y]),[['A',32.497*.75,27.498*.75],['B',32.497*.75,73.498*.75],['A2',88.497*.75,27.498*.75],['B2',88.497*.75,73.498*.75]]);
  assert.deepEqual(pe.terminals.map(pin=>[pin.id,pin.x,pin.y]),block.terminals.slice(0,2).map(pin=>[pin.id,pin.x,pin.y]));
  const doc=small(device('xt','terminal'),device('pe','pe-terminal'));
  connect(doc,'source','L1','xt','A');connect(doc,'source','N','xt','A2');connect(doc,'source','PE','pe','A');
  const result=simulate(doc);assert.equal(result.terminals['xt::B'].energized,true);
  for(const key of ['source::N','source::PE','xt::B2','pe::A','pe::B'])assert.equal(result.terminals[key].energized,false,key);
});

test("new simulator: arbitrary crossings and drawing styles do not create electrical junctions",()=>{
  const doc=wired();for(const [index,wire] of doc.wires.entries()){wire.style=["orthogonal","straight","curve"][index%3];wire.waypoints=[{x:500,y:500},{x:10,y:10}];}
  assert.equal(validateDocument(doc).valid,true);assert.equal(assessLesson(doc).status,"passed");
  for(const wire of doc.wires){const ends=wireEndpoints(doc,wire),route=wireRoute(doc,wire);assert.deepEqual(route[0],ends.from);assert.deepEqual(route.at(-1),ends.to);}
});

test("new simulator: a fuse placed solely in the neutral return cannot pass the course",()=>{
  const doc=wired("motor-jog");
  doc.wires=doc.wires.filter(w=>w.from.componentId!=="fuse"&&w.to.componentId!=="fuse"&&!(w.from.componentId==="km"&&w.from.terminalId==="A2"));
  connect(doc,"breaker","2","fr","95");connect(doc,"km","A2","fuse","1");connect(doc,"fuse","2","source","N");
  assert.equal(run(doc,startEvents).components.motor.active,true);
  const assessment=assessLesson(doc);assert.equal(assessment.status,"failed");assert.equal(has(assessment,"FUSE_ON_NEUTRAL"),true);
});

test("new simulator: protective earth cannot pass through a fuse even when the intact fuse conducts",()=>{
  const doc=wired();doc.components.push(device("earthFuse","fuse"));const wire=doc.wires.find(w=>w.to.componentId==="motor"&&w.to.terminalId==="PE");wire.to={componentId:"earthFuse",terminalId:"1"};connect(doc,"earthFuse","2","motor","PE");
  const result=run(doc,startEvents);assert.equal(result.components.motor.active,true);assert.equal(has(result,"PE_MISSING"),true);assert.notEqual(assessLesson(doc).status,"passed");
});

test("new simulator: a motor winding terminal connected to PE is a fault, not a normal load return",()=>{
  const doc=small(device("motor","motor"));connect(doc,"source","L1","motor","U");connect(doc,"source","L2","motor","V");connect(doc,"source","PE","motor","W");connect(doc,"source","PE","motor","PE");
  const result=simulate(doc);assert.equal(has(result,"MOTOR_EARTH_RETURN"),true);assert.equal(result.runtime.faultLatched,true);assert.equal(result.components.motor.active,false);
});

test("new simulator: hazards hidden behind added controls cannot pass and include replayable action evidence",()=>{
  for(const lessonId of ["motor-self-hold","lighting-single","lighting-two-way"]){
    const doc=wired(lessonId);doc.components.push(device("hiddenSwitch","switch1"));connect(doc,"source","L1","hiddenSwitch","1");connect(doc,"source","L2","hiddenSwitch","2");
    assert.equal(simulate(doc).runtime.faultLatched,false,"the hidden branch is initially open");
    const assessment=assessLesson(doc);assert.equal(assessment.status,"failed");const fault=assessment.diagnostics.find(d=>d.code==="PHASE_SHORT"&&d.actionSequence);assert.ok(fault);assert.ok(fault.wireIds.length>0);
    const replayed=run(doc,fault.actionSequence);assert.equal(has(replayed,"PHASE_SHORT"),true);
  }
});

test("new simulator: course assessment records the actual scripted actions and observations",()=>{
  const doc=wired(),assessment=assessLesson(doc);assert.equal(assessment.status,"passed");assert.ok(assessment.trace.length>=15);
  const press=assessment.trace.find(e=>e.event==="按下启动"),release=assessment.trace.find(e=>e.event==="松开启动"),overload=assessment.trace.find(e=>e.event==="过载 TEST");
  assert.equal(press.action.type,"press");assert.equal(press.components.motor.active,true);assert.equal(release.components.motor.active,true);assert.equal(overload.action.type,"trip-overload");assert.equal(overload.components.motor.active,false);
  assert.doesNotThrow(()=>JSON.stringify(assessment));
});

test("new simulator: a latched short preserves its evidence through release and every ordinary control action",()=>{
  const doc=wired();connect(doc,"km","2","km","4");let result=run(doc,startEvents);assert.equal(has(result,"PHASE_SHORT"),true);
  const first=structuredClone(result.diagnostics.find(d=>d.code==="PHASE_SHORT"));assert.ok(first.wireIds.length);assert.equal(result.runtime.faultLatched,true);
  for(const action of [{type:"release",componentId:"start"},{type:"toggle",componentId:"breaker"},{type:"reset-overload",componentId:"fr"},{type:"press",componentId:"stop"},{type:"power",enabled:true}]){
    result=simulate(doc,result.runtime,action);assert.equal(result.runtime.faultLatched,true);assert.equal(result.runtime.powerOn,false);assert.deepEqual(result.diagnostics.find(d=>d.code==="PHASE_SHORT"),first);assert.ok(result.runtime.latchedDiagnostics.some(d=>d.code==="PHASE_SHORT"));
  }
  result=simulate(doc,result.runtime,{type:"reset-fault"});assert.equal(result.runtime.faultLatched,false);assert.equal(has(result,"PHASE_SHORT"),false);assert.deepEqual(result.runtime.latchedDiagnostics,[]);
  assert.deepEqual(initialRuntime(doc).latchedDiagnostics,[],"ending and restarting the simulation resets the teaching session");
});

test("new simulator: a motor fed through KM auxiliary contacts cannot pass as a protected main circuit",()=>{
  const doc=wired("motor-jog");
  for(const wire of doc.wires)for(const ref of [wire.from,wire.to])if(ref.componentId==="km"&&["1","2"].includes(ref.terminalId))ref.terminalId=ref.terminalId==="1"?"13":"14";
  assert.equal(run(doc,startEvents).components.motor.active,true,"the discrete electrical state must not conceal the incorrect terminal choice");
  const assessment=assessLesson(doc),failure=assessment.diagnostics.find(d=>d.code==="MAIN_CONTACT_BYPASS");assert.equal(assessment.status,"failed");assert.ok(failure);assert.ok(failure.wireIds.length);assert.ok(failure.terminalIds.includes("km::13"));assert.equal(assessment.checks.find(c=>c.id==="main-contactor").passed,false);
});

test("new simulator: permuting KM power poles consistently is equivalent and does not require reference wire pairs",()=>{
  const doc=wired();const permutation={"1":"3","2":"4","3":"5","4":"6","5":"1","6":"2"};
  for(const wire of doc.wires)for(const ref of [wire.from,wire.to])if(ref.componentId==="km"&&permutation[ref.terminalId])ref.terminalId=permutation[ref.terminalId];
  assert.equal(assessLesson(doc).status,"passed");
});

test("new simulator: an extra unprotected motor remains physically powered but is outside course coverage",()=>{
  for(const lessonId of ["motor-jog","motor-self-hold","lighting-single","lighting-two-way"]){
    const doc=wired(lessonId);doc.components.push(device("extraMotor","motor"));for(const [a,b] of [["L1","U"],["L2","V"],["L3","W"],["PE","PE"]])connect(doc,"source",a,"extraMotor",b);
    assert.equal(simulate(doc).components.extraMotor.active,true);
    const assessment=assessLesson(doc);assert.equal(assessment.status,"unsupported");assert.equal(has(assessment,"LESSON_LOAD_UNCOVERED"),true);assert.equal(assessment.checks.find(c=>c.id==="load-coverage").passed,false);
  }
});

test("new simulator: an extra motor with phase loss cannot receive a passing safety check",()=>{
  const doc=wired("motor-jog");doc.components.push(device("extraMotor","motor"));connect(doc,"source","L1","extraMotor","U");connect(doc,"source","PE","extraMotor","PE");
  const assessment=assessLesson(doc);assert.notEqual(assessment.status,"passed");assert.equal(has(assessment,"MOTOR_PHASE_MISSING"),true);assert.equal(assessment.checks.find(c=>c.id==="safety").passed,false);
});

test("new simulator: extra lamps and coils also require their own course objectives",()=>{
  for(const type of ["lamp","contactor220"]){const doc=wired("lighting-single");doc.components.push(device("extraLoad",type));connect(doc,"source","L1","extraLoad",type==="lamp"?"L":"A1");connect(doc,"source","N","extraLoad",type==="lamp"?"N":"A2");assert.equal(simulate(doc).components.extraLoad.active,true);assert.equal(assessLesson(doc).status,"unsupported");}
});

test("new simulator: a lighting neutral fused on its own cannot pass even when the intact fuse conducts",()=>{
  for(const lessonId of ["lighting-single","lighting-two-way"]){
    const doc=wired(lessonId);doc.components.push(device("neutralFuse","fuse"));const wire=doc.wires.find(w=>w.from.componentId==="lamp"&&w.from.terminalId==="N");wire.to={componentId:"neutralFuse",terminalId:"1"};connect(doc,"neutralFuse","2","source","N");
    const state=initialRuntime(doc);state.switches.breaker=true;state.switches.switchA=lessonId==="lighting-single";assert.equal(simulate(doc,state).components.lamp.active,true,"do not hide the closed circuit behind the grading rule");
    const assessment=assessLesson(doc);assert.equal(assessment.status,"failed");assert.equal(assessment.checks.find(c=>c.id==="neutral").passed,false);assert.equal(has(assessment,"SWITCHED_NEUTRAL"),true);
  }
});

test("new simulator: lighting neutral through either insulated ordinary terminal pole remains equivalent",()=>{
  for(const lessonId of ["lighting-single","lighting-two-way"])for(const [upper,lower] of [["A","B"],["A2","B2"]]){
    const doc=wired(lessonId);doc.components.push(device("neutralBlock","terminal"));const wire=doc.wires.find(w=>w.from.componentId==="lamp"&&w.from.terminalId==="N");wire.to={componentId:"neutralBlock",terminalId:upper};connect(doc,"neutralBlock",lower,"source","N");
    assert.equal(assessLesson(doc).status,"passed");
  }
});

test("new simulator: a PE-labelled terminal used as an ordinary phase feed is diagnosed and latched",()=>{
  const doc=wired("motor-jog");doc.components.push(device("livePE","pe-terminal"));const wire=doc.wires.find(w=>w.from.componentId==="source"&&w.from.terminalId==="L1"),target=wire.to;wire.to={componentId:"livePE",terminalId:"A"};connect(doc,"livePE","B",target.componentId,target.terminalId);
  let result=simulate(doc);const failure=result.diagnostics.find(d=>d.code==="EARTH_TERMINAL_LIVE");assert.ok(failure);assert.ok(failure.terminalIds.includes("livePE::A"));assert.ok(failure.wireIds.includes(wire.id));assert.equal(result.runtime.faultLatched,true);
  result=simulate(doc,result.runtime,{type:"release",componentId:"start"});assert.equal(has(result,"EARTH_TERMINAL_LIVE"),true);assert.equal(assessLesson(doc).status,"failed");
});

test("new simulator: a motor housing PE terminal receiving a phase is a fault independent of winding return",()=>{
  const doc=wired("motor-jog"),wire=doc.wires.find(w=>w.to.componentId==="motor"&&w.to.terminalId==="PE");wire.from={componentId:"source",terminalId:"L2"};const result=simulate(doc);
  assert.equal(has(result,"EARTH_TERMINAL_LIVE"),true);assert.equal(result.runtime.faultLatched,true);assert.notEqual(assessLesson(doc).status,"passed");
});

test("new simulator: a PE terminal cannot substitute for an ordinary neutral return terminal",()=>{
  const doc=wired("motor-jog");doc.components.push(device("neutralPE","pe-terminal"));const wire=doc.wires.find(w=>w.from.componentId==="km"&&w.from.terminalId==="A2");wire.to={componentId:"neutralPE",terminalId:"A"};connect(doc,"neutralPE","B","source","N");
  const result=simulate(doc);assert.equal(has(result,"EARTH_TERMINAL_NEUTRAL"),true);assert.equal(result.runtime.faultLatched,true);assert.equal(assessLesson(doc).status,"failed");
});

test("extended engine: a compound jogging latch drops during the release gap without course-specific commands",()=>{
  const doc=small(device("km","contactor380"),device("jog","push-no"));
  connect(doc,"source","L1","jog","11");connect(doc,"source","L1","jog","23");connect(doc,"jog","12","km","13");connect(doc,"km","14","km","A1");connect(doc,"jog","24","km","A1");connect(doc,"km","A2","source","L2");
  let result=simulate(doc);result=simulate(doc,result.runtime,{type:"press",componentId:"jog"});assert.equal(result.components.km.active,true);
  result=simulate(doc,result.runtime,{type:"release",componentId:"jog"});assert.equal(result.components.km.active,false);
});

test("extended engine: independent auxiliary blocks follow their owner without joining separate control nets",()=>{
  const aux={...device("aux","auxiliary-no"),linkedTo:"km"},doc=small(device("km","contactor380"),aux);
  connect(doc,"source","L1","km","A1");connect(doc,"source","L2","km","A2");connect(doc,"source","L1","km","13");connect(doc,"source","L3","aux","13");
  const result=simulate(doc);assert.equal(result.runtime.faultLatched,false);assert.equal(result.terminals["km::14"].potential,"L1");assert.equal(result.terminals["aux::14"].potential,"L3");
  const draft=structuredClone(doc);delete draft.components.find(c=>c.id==="aux").linkedTo;assert.equal(validateDocument(draft).valid,true);assert.equal(simulate(draft).supported,false);assert.equal(has(simulate(draft),"AUXILIARY_OWNER_MISSING"),true);
  aux.linkedTo="source";assert.equal(validateDocument(doc).valid,false);
});

const timerCircuit=()=>{
  const doc=small({...device("t1","timer380"),settings:{delayMs:1000}},{...device("t2","timer380"),settings:{delayMs:2000}});
  connect(doc,"source","L1","t1","A1");connect(doc,"source","L2","t1","A2");connect(doc,"source","L1","t1","25");connect(doc,"t1","28","t2","A1");connect(doc,"source","L2","t2","A2");return doc;
};

test("extended engine: one large time step processes chained timer deadlines just like segmented replay",()=>{
  const doc=timerCircuit(),first=simulate(doc),before=JSON.stringify(first.runtime);
  let result=simulate(doc,first.runtime,{type:"advance-time",ms:999});assert.equal(result.components.t1.state,"timing");assert.equal(result.components.t2.active,false);
  result=simulate(doc,result.runtime,{type:"advance-time",ms:1});assert.equal(result.components.t1.state,"done");assert.equal(result.runtime.timers.t2.startedAt,1000);
  result=simulate(doc,result.runtime,{type:"advance-time",ms:1999});assert.equal(result.components.t2.state,"timing");
  result=simulate(doc,result.runtime,{type:"advance-time",ms:1});assert.equal(result.components.t2.state,"done");
  const one=simulate(doc,first.runtime,{type:"advance-time",ms:3000});assert.deepEqual(one.runtime,result.runtime);assert.equal(JSON.stringify(first.runtime),before,"time events must not mutate previous snapshots");
  const paused=simulate(doc,result.runtime);assert.equal(paused.runtime.timeMs,3000);assert.equal(paused.runtime.timers.t2.elapsedMs,2000);
});

test("extended engine: timer contacts are isolated and timer loss of power cancels its previous deadline",()=>{
  const doc=small({...device("kt","timer380"),settings:{delayMs:1000}});
  connect(doc,"source","L1","kt","A1");connect(doc,"source","L3","kt","A2");connect(doc,"source","L1","kt","15");connect(doc,"source","L2","kt","25");
  let result=simulate(doc);assert.equal(result.terminals["kt::16"].potential,"L1");assert.equal(result.terminals["kt::28"].potential,"floating");
  result=simulate(doc,result.runtime,{type:"advance-time",ms:1000});assert.equal(result.terminals["kt::16"].potential,"floating");assert.equal(result.terminals["kt::28"].potential,"L2");assert.equal(result.runtime.faultLatched,false);
  result=simulate(doc,result.runtime,{type:"power",enabled:false});assert.equal(result.runtime.timers.kt.done,false);assert.equal(result.runtime.timers.kt.startedAt,null);
  result=simulate(doc,result.runtime,{type:"advance-time",ms:5000});result=simulate(doc,result.runtime,{type:"power",enabled:true});assert.equal(result.runtime.timers.kt.startedAt,6000);
  result=simulate(doc,result.runtime,{type:"advance-time",ms:999});assert.equal(result.runtime.timers.kt.done,false);
  result=simulate(doc,result.runtime,{type:"advance-time",ms:1});assert.equal(result.runtime.timers.kt.done,true);
});

test("extended engine: malformed timer parameters or time events cannot corrupt the clock",()=>{
  for(const delayMs of [-1,0,Infinity,NaN,3_600_001]){const doc=timerCircuit();doc.components.find(c=>c.id==="t1").settings.delayMs=delayMs;assert.equal(validateDocument(doc).valid,false);}
  const doc=timerCircuit(),base=simulate(doc);
  for(const ms of [-1,Infinity,NaN,3_600_001]){const result=simulate(doc,base.runtime,{type:"advance-time",ms});assert.equal(result.supported,false);assert.equal(result.runtime.timeMs,0);assert.equal(has(result,"INVALID_TIME_STEP"),true);}
});

const sixMotor=(type="motor-star-delta",ends=false)=>{
  const doc=small(device("m",type));for(const [index,pin] of (ends?["U2","V2","W2"]:["U1","V1","W1"]).entries())connect(doc,"source",`L${index+1}`,"m",pin);connect(doc,"source","PE","m","PE");return doc;
};

test("extended engine: six isolated leads mean different things for Y/delta and Dahlander motors",()=>{
  const star=sixMotor();assert.equal(simulate(star).components.m.active,false);assert.equal(has(simulate(star),"MOTOR_WINDING_OPEN"),true);
  const dual=structuredClone(star);dual.components.find(c=>c.id==="m").type="motor-dahlander";const low=simulate(dual);assert.equal(low.components.m.active,true);assert.equal(low.components.m.speed,"low");assert.equal(low.components.m.connection,"delta");
  connect(star,"m","U2","m","V2");connect(star,"m","V2","m","W2");const y=simulate(star);assert.equal(y.components.m.connection,"star");assert.equal(y.components.m.voltage,220);
  star.components.find(c=>c.id==="m").type="motor-dahlander";const wrong=simulate(star);assert.equal(wrong.supported,false);assert.equal(wrong.components.m.active,false);assert.equal(has(wrong,"MOTOR_CONNECTION_INVALID"),true);
});

test("extended engine: delta requires three consistently oriented complete winding voltages",()=>{
  const doc=sixMotor();connect(doc,"m","U1","m","W2");connect(doc,"m","V1","m","U2");connect(doc,"m","W1","m","V2");
  let result=simulate(doc);assert.equal(result.supported,true);assert.equal(result.components.m.connection,"delta");assert.equal(result.components.m.direction,"forward");
  [doc.wires[0].from.terminalId,doc.wires[1].from.terminalId]=[doc.wires[1].from.terminalId,doc.wires[0].from.terminalId];result=simulate(doc);assert.equal(result.components.m.direction,"reverse");
  const invalid=sixMotor();connect(invalid,"m","U1","m","U2");connect(invalid,"m","V1","m","W2");connect(invalid,"m","W1","m","V2");result=simulate(invalid);assert.equal(result.supported,false);assert.equal(result.components.m.active,false);assert.equal(has(result,"MOTOR_CONNECTION_INVALID"),true);
});

test("extended engine: a star point must float and six-lead motors retain real PE diagnostics",()=>{
  for(const type of ["motor-star-delta","motor-dahlander"]){
    const doc=sixMotor(type,type==="motor-dahlander"),pins=type==="motor-dahlander"?["U1","V1","W1"]:["U2","V2","W2"];
    connect(doc,"m",pins[0],"m",pins[1]);connect(doc,"m",pins[1],"m",pins[2]);assert.equal(simulate(doc).components.m.active,true);
    const neutral=structuredClone(doc);connect(neutral,"source","N","m",pins[0]);assert.equal(simulate(neutral).supported,false);assert.equal(has(simulate(neutral),"MOTOR_CONNECTION_INVALID"),true);
    const unearthed=structuredClone(doc);unearthed.wires=unearthed.wires.filter(w=>w.to.terminalId!=="PE");assert.equal(simulate(unearthed).components.m.active,true);assert.equal(has(simulate(unearthed),"PE_MISSING"),true);
    const earth=structuredClone(doc);connect(earth,"source","PE","m",pins[0]);assert.equal(simulate(earth).runtime.faultLatched,true);assert.equal(has(simulate(earth),"MOTOR_EARTH_RETURN"),true);
  }
});

test("extended engine: floating motor taps connected to another load are explicitly outside the discrete model",()=>{
  for(const type of ["motor-star-delta","motor-dahlander"]){
    const doc=sixMotor(type);if(type==="motor-star-delta"){connect(doc,"m","U2","m","V2");connect(doc,"m","V2","m","W2");}
    doc.components.push(device("ka","relay380"));connect(doc,"m","U2","ka","A1");connect(doc,"ka","A2","source","L1");
    const result=simulate(doc);assert.equal(result.supported,false);assert.equal(result.components.m.active,false);const proof=result.diagnostics.find(d=>d.code==="UNSUPPORTED_MOTOR_LOAD_NETWORK");assert.ok(proof);assert.ok(proof.wireIds.length);
  }
});

test("extended engine: malformed imports fail closed before action preprocessing",()=>{
  const doc=small(device("unknown","not-a-component"));
  for(const action of [{type:"press",componentId:"unknown"},{type:"release",componentId:"unknown"},{type:"advance-time",ms:1000}]){assert.doesNotThrow(()=>simulate(doc,undefined,action));const result=simulate(doc,undefined,action);assert.equal(result.supported,false);assert.equal(has(result,"INVALID_DOCUMENT"),true);}
});

test("extended engine: wire ducts are drawing objects and can never create electrical terminals",()=>{
  const doc=wired();doc.components.push(device("duct-h","wire-duct"),device("duct-v","wire-duct-vertical"));assert.equal(assessLesson(doc).status,"passed");
  connect(doc,"source","L1","duct-h","1");assert.equal(validateDocument(doc).valid,false);assert.equal(simulate(doc).supported,false);
});

test("extended engine: a hazard appearing in a compound-contact release gap remains latched",()=>{
  const doc=small(device("km","contactor380"),device("jog","push-no"));
  connect(doc,"source","L1","jog","11");connect(doc,"source","L1","jog","23");connect(doc,"jog","12","km","13");connect(doc,"km","14","km","A1");connect(doc,"jog","24","km","A1");connect(doc,"km","A2","source","L2");
  connect(doc,"source","L1","km","21");connect(doc,"source","L2","km","22");
  const previous=initialRuntime(doc);previous.contactors.km=true;previous.pressed.jog=true;
  let result=simulate(doc,previous,{type:"release",componentId:"jog"});assert.equal(result.runtime.faultLatched,true);assert.equal(has(result,"PHASE_SHORT"),true);
  result=simulate(doc,result.runtime,{type:"advance-time",ms:1000});assert.equal(has(result,"PHASE_SHORT"),true);assert.equal(result.runtime.powerOn,false);
});

test("extended engine: a long time step retains an invalid intermediate winding network even when the final state recovers",()=>{
  const doc=sixMotor();connect(doc,"m","U2","m","V2");connect(doc,"m","V2","m","W2");
  for(const [id,delayMs] of [["t1",1000],["t2",2000]]){doc.components.push({...device(id,"timer380"),settings:{delayMs}});connect(doc,"source","L1",id,"A1");connect(doc,"source","L2",id,"A2");}
  connect(doc,"source","N","t1","25");connect(doc,"t1","28","t2","15");connect(doc,"t2","16","m","U2");
  const base=simulate(doc);assert.equal(base.supported,true);assert.equal(base.components.m.connection,"star");
  const middle=simulate(doc,base.runtime,{type:"advance-time",ms:1000});assert.equal(middle.supported,false);assert.equal(has(middle,"MOTOR_CONNECTION_INVALID"),true);
  const result=simulate(doc,base.runtime,{type:"advance-time",ms:2000});assert.equal(result.runtime.timeMs,2000);assert.equal(result.components.m.active,true,"retain the actual final restored motor state");assert.equal(result.components.m.connection,"star");assert.equal(result.runtime.faultLatched,false,"do not invent a physical trip for a discrete-model error");
  assert.equal(result.supported,false,"the whole time window was not supported");const proof=result.diagnostics.find(d=>d.code==="MOTOR_CONNECTION_INVALID");assert.ok(proof);assert.equal(proof.event,"虚拟时间 1000ms");
});

test("extended engine: a normal open-winding interval does not become a fault latch during time advancement",()=>{
  const doc=sixMotor();doc.components.push({...device("kt","timer380"),settings:{delayMs:1000}},device("kmy","contactor380"));
  connect(doc,"source","L1","kt","A1");connect(doc,"source","L2","kt","A2");connect(doc,"source","L1","kt","25");connect(doc,"kt","28","kmy","A1");connect(doc,"source","L2","kmy","A2");
  connect(doc,"m","U2","kmy","1");connect(doc,"m","V2","kmy","3");connect(doc,"m","W2","kmy","5");connect(doc,"kmy","2","kmy","4");connect(doc,"kmy","4","kmy","6");
  const result=simulate(doc,undefined,{type:"advance-time",ms:2000});assert.equal(result.supported,true);assert.equal(result.components.m.connection,"star");assert.equal(result.runtime.faultLatched,false);assert.equal(has(result,"MOTOR_WINDING_OPEN"),false);
});
