import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: 'export * from "./app/simulator/core/lessons"; export * from "./app/simulator/core/motor-courses"; export * from "./app/simulator/core/engine"; export * from "./app/simulator/core/catalog"; export * from "./app/simulator/core/validation"; export * from "./app/simulator/core/terminal-wiring"; export * from "./app/simulator/core/wire-colors"; export * from "./app/simulator/core/wiring-workmanship";', resolveDir: process.cwd() }, bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { createLessonDocument, createMotorCourseDocument, assessLesson, validateDocument, getDefinition, componentSize, getCourseTerminalAssignments, getCourseTerminalCount, terminalizeMotorCourse, getWireColorGroups, resolveConnectionColor, getConnectedTerminalColor, setWireGroupColor, normalizeDemonstrationWireColors, normalizeAutomaticControlWireColors, CONTROL_WIRE_COLOR, assessWiringWorkmanship } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const key = ref => `${ref.componentId}::${ref.terminalId}`;
const component = (id, type) => ({ id, type, label: id, position: { x: 0, y: 0 } });
const wire = (id, a, ap, b, bp, color = "#f04452") => ({ id, from: { componentId: a, terminalId: ap }, to: { componentId: b, terminalId: bp }, color });
const document = (components, wires = []) => ({ schemaVersion: 1, title: "端子分组验收", components, wires });

for (let number = 1; number <= 10; number++) test(`course ${number}: every external branch crosses its XT slot, behavior passes and blank stays blank`, () => {
  const lessonId = `motor-course-${String(number).padStart(2, "0")}`;
  const blank = createLessonDocument(lessonId), demo = createLessonDocument(lessonId, { wired: true });
  assert.equal(validateDocument(demo).valid, true);
  assert.equal(blank.wires.length, 0);
  assert.deepEqual(blank.components, demo.components);
  assert.deepEqual(blank.roles, demo.roles);
  assert.equal(demo.roles.xt16, "xt16");
  assert.equal(demo.components.filter(c => c.type.startsWith("terminal-strip")).length, 1);
  assert.equal(demo.components.find(c=>c.id==="xt16").type, number===10?"terminal-strip20":"terminal-strip16");
  assert.equal(demo.components.some(c=>c.type==="pe-terminal"),false);
  const assignments = getCourseTerminalAssignments(lessonId);
  for (const assignment of assignments) {
    const external = `${demo.roles[assignment.componentRole]}::${assignment.terminalId}`;
    const attached = demo.wires.filter(w => [w.from, w.to].some(ref => key(ref) === external));
    assert.equal(attached.length, assignment.used ? 1 : 0, `${external} has one external tail, unused NO has none`);
    if (!assignment.used) continue;
    const outside = `${demo.roles[assignment.stripRole]}::B${assignment.position}`, inside = `${demo.roles[assignment.stripRole]}::T${assignment.position}`;
    assert.ok(attached.some(w => [w.from, w.to].some(ref => key(ref) === outside)));
    if(assignment.requiresInternal) assert.ok(demo.wires.some(w => [w.from, w.to].some(ref => key(ref) === inside)));
  }
  assert.equal(assessLesson(demo).status, "passed");
  assert.equal(assessWiringWorkmanship(demo).status, "passed");
  assert.equal(assessWiringWorkmanship(blank).status, "incomplete");
  const strip = demo.components.find(c => c.id === "xt16");
  for (const external of demo.components.filter(c => c.type === "supply" || getDefinition(c.type).load?.kind === "motor")) assert.ok(external.position.y >= strip.position.y + componentSize(strip).height);
});

test("terminal capacity counts only original wire nets; N and PE retain dedicated source positions", () => {
  const counts=[10,11,12,12,14,16,16,11,14,17];
  for(let n=1;n<=10;n++){
    const id=`motor-course-${String(n).padStart(2,"0")}`,assignments=getCourseTerminalAssignments(id);
    assert.equal(new Set(assignments.map(a=>a.position)).size,counts[n-1]);
    assert.equal(getCourseTerminalCount(id),n===10?20:16);
    assert.deepEqual(assignments.filter(a=>a.componentRole==="source").map(a=>[a.terminalId,a.position]),[["L1",1],["L2",2],["L3",3],["N",4],["PE",5]]);
    assert.ok(assignments.filter(a=>a.terminalId==="PE").every(a=>a.position===5));
  }
  const assignments=getCourseTerminalAssignments("motor-course-06");
  assert.equal(assignments.filter(a=>a.componentRole.startsWith("sq")).length,12);
  assert.ok(assignments.every(a=>a.stripRole==="xt16"));
  const demo=createLessonDocument("motor-course-06",{wired:true});
  assert.equal(demo.roles.xt2,undefined);
  assert.deepEqual(demo.components.find(c=>c.id==="xt16").pePositions,[5]);
});

for (const number of [6, 7, 9, 10]) test(`course ${number}: conversion rewrites EVERY original branch without modifying its input`, () => {
  const raw = createMotorCourseDocument(`motor-course-${String(number).padStart(2, "0")}`, { wired: true });
  const before = JSON.stringify(raw), converted = terminalizeMotorCourse(raw);
  const assignments = new Map(getCourseTerminalAssignments(raw.lessonId).filter(a => a.used).map(a => [`${a.componentRole}::${a.terminalId}`, a]));
  for (const original of raw.wires) {
    if([original.from,original.to].some(ref=>ref.componentId==="pe")) continue;
    const expected=[original.from,original.to].map(ref=>{const a=assignments.get(key(ref));return a?{componentId:a.stripRole,terminalId:`T${a.position}`}:ref;});
    if(key(expected[0])===key(expected[1]))continue;
    const next = converted.wires.find(w => [key(w.from),key(w.to)].sort().join("|")===[key(expected[0]),key(expected[1])].sort().join("|"));
    assert.ok(next,"each original branch survives or collapses onto an already equivalent connection");
    for (const end of ["from", "to"]) {
      const a = assignments.get(key(original[end]));
      assert.ok([next.from,next.to].some(ref=>key(ref)===key(a ? { componentId: a.stripRole, terminalId: `T${a.position}` } : original[end])));
    }
  }
  assert.equal(JSON.stringify(raw), before);
  assert.equal(assessLesson(raw).status, "passed");
  assert.equal(assessLesson(converted).status, "passed");
});

test("old electrical grades remain independent of the new workmanship result", () => {
  const old = createMotorCourseDocument("motor-course-02", { wired: true }), before = JSON.stringify(old);
  assert.equal(assessLesson(old).status, "passed");
  assert.equal(assessWiringWorkmanship(old).status, "incomplete");
  assert.equal(JSON.stringify(old), before);
  const next = createLessonDocument("motor-course-02", { wired: true });
  next.wires.push(wire("bypass", "source", "L1", "qf", "1", "#e7b000"));
  assert.equal(assessLesson(next).status, "passed", "the direct parallel feed does not change electrical operation");
  assert.equal(assessWiringWorkmanship(next).status, "incomplete");
  assert.ok(assessWiringWorkmanship(next).diagnostics.some(d => d.code === "TERMINAL_BOUNDARY_BYPASS" && d.wireIds.includes("bypass")));
  for (const id of ["motor-jog", "motor-self-hold", "lighting-single", "lighting-two-way"]) assert.equal(assessWiringWorkmanship(createLessonDocument(id, { wired: true })).status, "unsupported");
});

test("PE on an ordinary XT is reported even if all conductors use the same green color", () => {
  const demo = createLessonDocument("motor-course-01", { wired: true });
  demo.wires.push(wire("pe-on-strip", "source", "PE", "xt16", "T16", "#659f2f"));
  const report = assessWiringWorkmanship(demo);
  assert.equal(report.status, "incomplete");
  assert.ok(report.diagnostics.some(d => d.code === "DEDICATED_PE_REQUIRED"));
});

test("color flows through either side of chained strips, ignores direction and survives reload/rotation", () => {
  const doc = document([component("s", "supply"), component("a", "terminal-strip16"), component("b", "terminal-strip16"), component("m", "motor")], [wire("red", "s", "L3", "a", "T2"), wire("bridge", "a", "B2", "b", "B8")]);
  const before = JSON.stringify(doc);
  for (const terminalId of ["T8", "B8"]) assert.equal(resolveConnectionColor(doc, { componentId: "b", terminalId }, { componentId: "m", terminalId: "U" }, "#e7b000").color, "#f04452");
  assert.equal(resolveConnectionColor(doc, { componentId: "m", terminalId: "U" }, { componentId: "b", terminalId: "T8" }, "#e7b000").color, "#f04452");
  doc.components[1].rotation = 270;
  assert.deepEqual(getWireColorGroups(doc), getWireColorGroups(JSON.parse(JSON.stringify(doc))));
  assert.equal(getConnectedTerminalColor(doc, { componentId: "a", terminalId: "B2" }), "#f04452");
  doc.components[1].rotation = undefined;
  assert.equal(JSON.stringify(doc), before);
});

test("new connection uses source color only before an existing group establishes its color", () => {
  const doc = document([component("s", "supply"), component("a", "terminal-strip16"), component("m", "motor")]);
  assert.deepEqual(resolveConnectionColor(doc, { componentId: "a", terminalId: "B2" }, { componentId: "s", terminalId: "L2" }), { color: "#20b963", conflict: false, sourceConflict: false });
  doc.wires.push(wire("chosen", "m", "U", "a", "T2", "#abc"));
  assert.equal(resolveConnectionColor(doc, { componentId: "s", terminalId: "L2" }, { componentId: "a", terminalId: "B2" }).color, "#aabbcc");
});

test("joining different existing colors reports conflict without mutating them; one group edit fixes all wires", () => {
  const doc = document([component("a", "terminal-strip16"), component("b", "terminal-strip16"), component("c", "terminal-strip16")], [wire("red", "a", "T1", "b", "T1"), wire("green", "a", "T2", "c", "T2", "#20b963")]);
  const before = JSON.stringify(doc);
  assert.equal(resolveConnectionColor(doc, { componentId: "b", terminalId: "B1" }, { componentId: "c", terminalId: "B2" }).conflict, true);
  assert.equal(JSON.stringify(doc), before);
  const joined = { ...doc, wires: [...doc.wires, wire("join", "b", "B1", "c", "B2")] };
  assert.equal(getConnectedTerminalColor(joined, { componentId: "c", terminalId: "T2" }), "#56616f");
  const changed = setWireGroupColor(joined, ["green"], "#8052CD");
  assert.deepEqual(changed.wires.map(w => w.color), ["#8052cd", "#8052cd", "#8052cd"]);
  assert.equal(joined.wires[0].color, "#f04452");
  const split = { ...changed, wires: changed.wires.filter(w => w.id !== "join") };
  assert.deepEqual(split.wires.map(w => w.color), ["#8052cd", "#8052cd"]);
  assert.throws(() => setWireGroupColor(doc, ["red"], "url(secret)"));
});

test("colors never cross contactor poles, NC/NO contacts or load windings", () => {
  const doc = document([component("s", "supply"), component("km", "contactor380"), component("m", "motor-star-delta"), component("sq", "limit-switch")], [wire("main", "s", "L1", "km", "1", "#e7b000"), wire("coil", "s", "L2", "km", "A2_top", "#20b963"), wire("motor", "s", "L3", "m", "U1"), wire("nc", "s", "L1", "sq", "11", "#e7b000")]);
  assert.equal(getConnectedTerminalColor(doc, { componentId: "km", terminalId: "2" }), "#56616f");
  assert.equal(getConnectedTerminalColor(doc, { componentId: "km", terminalId: "A1" }), "#56616f");
  assert.equal(getConnectedTerminalColor(doc, { componentId: "km", terminalId: "A2" }), "#20b963");
  assert.equal(getConnectedTerminalColor(doc, { componentId: "m", terminalId: "U2" }), "#56616f");
  assert.equal(getConnectedTerminalColor(doc, { componentId: "sq", terminalId: "12" }), "#56616f");
});

test("same visual color never hides a conflict between source conductors", () => {
  const doc = document([component("s", "supply"), component("a", "terminal-strip16")], [wire("a", "s", "L1", "a", "T1"), wire("b", "s", "L2", "a", "B1")]);
  assert.equal(resolveConnectionColor(doc, { componentId: "a", terminalId: "T1" }).sourceConflict, true);
  const recolored = setWireGroupColor(doc, ["a"], "#8052cd");
  assert.equal(resolveConnectionColor(recolored, { componentId: "a", terminalId: "B1" }).sourceConflict, true);
  assert.deepEqual(normalizeDemonstrationWireColors(recolored), recolored);
});

test("demonstration normalization is stable under wire reorder and never touches topology", () => {
  const raw = terminalizeMotorCourse(createMotorCourseDocument("motor-course-09", { wired: true }));
  const before = JSON.stringify(raw), normalized = normalizeDemonstrationWireColors(raw);
  const reordered = normalizeDemonstrationWireColors({ ...raw, components: [...raw.components].reverse(), wires: [...raw.wires].reverse() });
  assert.deepEqual(Object.fromEntries(normalized.wires.map(w => [w.id, w.color])), Object.fromEntries(reordered.wires.map(w => [w.id, w.color])));
  assert.deepEqual(normalized.wires.map(({ color, ...w }) => w), raw.wires.map(({ color, ...w }) => w));
  assert.equal(JSON.stringify(raw), before);
  assert.equal(assessLesson(normalized).status, "passed");
});

for(let number=1;number<=10;number++)test(`course ${number}: all FU2 downstream control conductors are black, including open contacts`,()=>{
  const doc=createLessonDocument(`motor-course-${String(number).padStart(2,"0")}`,{wired:true});
  const byId=new Map(doc.wires.map(w=>[w.id,w]));
  const controlGroups=getWireColorGroups(doc).filter(g=>g.controlCircuit&&g.wireIds.length);
  assert.ok(controlGroups.length>2,"both rails and intermediate open-contact sections are classified");
  for(const group of controlGroups)for(const id of group.wireIds)assert.equal(byId.get(id).color,CONTROL_WIRE_COLOR,id);
  for(const [terminal,color] of [["L1","#e7b000"],["L2","#20b963"],["L3","#f04452"],["N","#3478f6"],["PE","#659f2f"]])assert.equal(doc.wires.find(w=>[w.from,w.to].some(r=>r.componentId==="source"&&r.terminalId===terminal)).color,color);
  for(const id of ["1","3"])assert.notEqual(getConnectedTerminalColor(doc,{componentId:"fu2",terminalId:id}),CONTROL_WIRE_COLOR);
});

test("FU2 downstream pending connections default black while group recolor stays below the fuse",()=>{
  const doc=createLessonDocument("motor-course-02");
  assert.equal(resolveConnectionColor(doc,{componentId:"fu2",terminalId:"2"}).color,CONTROL_WIRE_COLOR);
  const demo=createLessonDocument("motor-course-02",{wired:true}),target=demo.wires.find(w=>[w.from,w.to].some(r=>r.componentId==="fu2"&&r.terminalId==="2"));
  const changed=setWireGroupColor(demo,[target.id],"#222222");
  assert.equal(getConnectedTerminalColor(changed,{componentId:"fu2",terminalId:"1"}),"#e7b000");
  assert.equal(getConnectedTerminalColor(changed,{componentId:"fu2",terminalId:"2"}),"#222222");
});


test("closing the FU2 connection last recolors previously automatic wires across open controls",()=>{
  const doc=createLessonDocument("motor-course-02");
  doc.wires=[wire("first","km","A1","sb2","24","#84909c"),wire("middle","sb2","23","sb1","12","#84909c"),wire("return","km","A2","fu2","4","#20b963"),wire("upstream","source","L1","fu2","1","#e7b000")].map(w=>({...w,colorMode:"auto"}));
  const last={...wire("last","sb1","11","fu2","2","#84909c"),colorMode:"auto"};
  const connected={...doc,wires:[...doc.wires,last]},before=JSON.stringify(connected),next=normalizeAutomaticControlWireColors(connected);
  assert.equal(JSON.stringify(connected),before,"color normalization is immutable");
  assert.ok(next.wires.filter(w=>w.id!=="upstream").every(w=>w.color===CONTROL_WIRE_COLOR));
  assert.equal(next.wires.find(w=>w.id==="upstream").color,"#e7b000");
  assert.equal(normalizeAutomaticControlWireColors(next),next,"unchanged colors are a no-op");
});

test("manual and historical wire colors remain authoritative when FU2 is connected last",()=>{
  for(const mode of [undefined,"manual"]){
    const doc=createLessonDocument("motor-course-01");
    doc.wires=[{...wire("saved","sb","24","km","A1","#8052cd"),...(mode?{colorMode:mode}:{})},{...wire("branch","km","13","sb","24","#84909c"),colorMode:"auto"},{...wire("last","sb","23","fu2","2","#84909c"),colorMode:"auto"}];
    const next=normalizeAutomaticControlWireColors(doc);
    assert.equal(next.wires.find(w=>w.id==="saved").color,"#8052cd");
    assert.equal(next.wires.find(w=>w.id==="branch").color,"#8052cd");
    assert.equal(next.wires.find(w=>w.id==="last").color,CONTROL_WIRE_COLOR);
  }
});

test("color modes round-trip, reject invalid values, and mark explicit color edits",()=>{
  const doc=createLessonDocument("motor-course-01",{wired:true});
  for(const mode of ["auto","manual"]){doc.wires[0].colorMode=mode;const checked=validateDocument(JSON.parse(JSON.stringify(doc)));assert.equal(checked.valid,true);assert.equal(checked.document.wires[0].colorMode,mode);}
  doc.wires[0].colorMode="unexpected";assert.equal(validateDocument(doc).valid,false);
  delete doc.wires[0].colorMode;
  const changed=setWireGroupColor(doc,[doc.wires[0].id],doc.wires[0].color);
  assert.equal(changed.wires[0].colorMode,"manual");
  assert.equal(doc.wires[0].colorMode,undefined);
});
