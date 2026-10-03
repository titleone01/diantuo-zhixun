import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({ stdin: { contents: 'export * from "./motor-course-assessment"; export * from "./motor-courses"; export * from "./engine"; export * from "./validation";', resolveDir: fileURLToPath(new URL("../app/simulator/core/", import.meta.url)) }, bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { assessMotorCourse, createMotorCourseDocument, MOTOR_COURSES, simulate, initialRuntime, validateDocument, buildCircuitNetwork } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const wired = number => createMotorCourseDocument(`motor-course-${String(number).padStart(2, "0")}`, { wired: true });
const assess = document => assessMotorCourse(document, document.lessonId);
const failures = result => JSON.stringify({ status: result.status, checks: result.checks.filter(check => !check.passed), diagnostics: [...new Set(result.diagnostics.map(diagnostic => diagnostic.code))] });
const connect = (document, from, fromTerminal, to, toTerminal) => {
  let index = document.wires.length; while (document.wires.some(wire => wire.id === `test-${index}`)) index++;
  document.wires.push({ id: `test-${index}`, from: { componentId: from, terminalId: fromTerminal }, to: { componentId: to, terminalId: toTerminal }, color: "#8866cc" });
};
const removeAt = (document, componentId, terminalId) => { document.wires = document.wires.filter(wire => ![wire.from, wire.to].some(port => port.componentId === componentId && port.terminalId === terminalId)); };
const mutateFails = (number, mutate, code) => {
  const document = wired(number); mutate(document);
  assert.equal(validateDocument(document).valid, true, "counterexample must still be a structurally valid circuit document");
  const result = assess(document); assert.notEqual(result.status, "passed", `incorrect topology passed: course ${number}`);
  if (code) assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === code), failures(result));
  return result;
};
function legacyFuses(document, rename = false) {
  const combined = document.components.find(component => component.id === "fu1");
  document.components = document.components.filter(component => component.id !== "fu1");
  delete document.roles.fu1;
  for (let index = 0; index < 3; index++) {
    const role = `fu1${"abc"[index]}`, id = rename ? `archived_${role}` : role;
    document.components.push({ id, type: "fuse", label: `FU1-${index+1}`, position: { x: combined.position.x + index*65, y: combined.position.y } });
    document.roles[role] = id;
  }
  for (const wire of document.wires) for (const endpoint of [wire.from, wire.to]) {
    if (endpoint.componentId !== "fu1") continue;
    const port = Number(endpoint.terminalId), role = `fu1${"abc"[Math.floor((port - 1)/2)]}`;
    endpoint.componentId = document.roles[role]; endpoint.terminalId = port % 2 ? "1" : "2";
  }
  return document;
}

for (let number = 1; number <= 10; number++) {
  test(`course ${number}: red and green momentary button colors are electrically interchangeable`, () => {
    const document = wired(number);
    for (const component of document.components) {
      if (component.type === "push-no") component.type = "push-nc";
      else if (component.type === "push-nc") component.type = "push-no";
    }
    const result = assess(document); assert.equal(result.status, "passed", failures(result));
  });
  test(`course ${number}: legacy independent FU1 snapshots retain their IDs and remain assessable`, () => {
    const document = legacyFuses(wired(number), number % 2 === 0), before = JSON.stringify(document);
    assert.equal(validateDocument(document).valid, true);
    const result = assess(document); assert.equal(result.status, "passed", failures(result));
    assert.equal(JSON.stringify(document), before, "assessment does not migrate a stored snapshot");
  });
  test(`course ${number}: bypassing any one FU3 pole is detected independently of the other two`, () => {
    for (const [input, output] of [["1", "2"], ["3", "4"], ["5", "6"]]) {
      const document = wired(number); connect(document, "fu1", input, "fu1", output); const bypassId = document.wires.at(-1).id;
      const result = assess(document);
      assert.notEqual(result.status, "passed", `FU1 ${input}-${output} bypass must fail`);
      assert.equal(result.checks.find(check => check.id === "main-fuses-path")?.passed, false);
      assert.ok(result.diagnostics.some(item => item.code === "FUSE_BYPASS" && item.wireIds.includes(bypassId)), failures(result));
    }
  });
}

test("fuse cut probe isolates one internal channel without dropping the other phases or changing runtime", () => {
  const document = wired(1);
  let result = simulate(document, initialRuntime(document));
  result = simulate(document, result.runtime, { type: "toggle", componentId: "qf" });
  result = simulate(document, result.runtime, { type: "press", componentId: "sb" });
  assert.equal(result.components.m.active, true);
  const runtime = JSON.stringify(result.runtime);
  for (const terminals of [["1", "2"], ["2", "1"]]) {
    const probe = buildCircuitNetwork(document, result.runtime, { excludeFixedConnection: { componentId: "fu1", terminals } });
    assert.deepEqual(probe.potentials("m::U"), []);
    assert.deepEqual(probe.potentials("m::V"), ["L2"]);
    assert.deepEqual(probe.potentials("m::W"), ["L3"]);
  }
  assert.equal(JSON.stringify(result.runtime), runtime);
});

test("legacy FU1 bypass and an extra unassigned three-pole fuse cannot silently pass", () => {
  const legacy = legacyFuses(wired(7), true); connect(legacy, legacy.roles.fu1b, "1", legacy.roles.fu1b, "2");
  const result = assess(legacy); assert.notEqual(result.status, "passed"); assert.ok(result.diagnostics.some(item => item.code === "FUSE_BYPASS"));
  const extra = wired(1); extra.components.push({ id: "extra_fu", type: "fuse3", label: "额外FU", position: {x:0,y:0} });
  assert.equal(assess(extra).status, "unsupported");
});

test("holding buttons cannot replace the courses' momentary button contract, regardless of color", () => {
  for (let number = 1; number <= 10; number++) for (const type of ["push-latching-red", "push-latching-green"]) {
    const document = wired(number);
    document.components.find(component => component.type === "push-no").type = type;
    assert.equal(validateDocument(document).valid, true);
    const result = assess(document); assert.equal(result.status, "incomplete");
    assert.ok(result.diagnostics.some(item => item.code === "LESSON_ROLE_MISSING"));
  }
});

for (const lesson of MOTOR_COURSES) {
  test(`${lesson.id}: reference passes representative scenarios and graph protection checks`, () => {
    const document = createMotorCourseDocument(lesson.id, { wired: true }), before = JSON.stringify(document);
    const result = assess(document); assert.equal(result.status, "passed", failures(result));
    assert.equal(result.passed, result.total); assert.ok(result.trace.length > 10);
    assert.equal(JSON.stringify(document), before, "assessment may not modify the user's scene");
  });
  test(`${lesson.id}: blank wiring never passes`, () => {
    const result = assess(createMotorCourseDocument(lesson.id)); assert.equal(result.status, "incomplete", failures(result));
  });
}
for (const number of [1, 3, 7, 9, 10]) test(`course ${number}: equivalent terminal intermediary, reversed wires, renamed instances and layout all pass`, () => {
  const document = wired(number), old = document.wires.shift();
  document.components.push({ id: "intermediate", type: "terminal", label: "XT", position: { x: 10, y: 10 } });
  connect(document, old.from.componentId, old.from.terminalId, "intermediate", "A");
  connect(document, "intermediate", "B", old.to.componentId, old.to.terminalId);
  const renamed = new Map(document.components.map(component => [component.id, `renamed_${component.id}`]));
  for (const component of document.components) { component.id = renamed.get(component.id); component.position = { x: component.position.x + 37, y: component.position.y - 19 }; if (component.linkedTo) component.linkedTo = renamed.get(component.linkedTo); }
  for (const wire of document.wires) { [wire.from, wire.to] = [wire.to, wire.from]; wire.from.componentId = renamed.get(wire.from.componentId); wire.to.componentId = renamed.get(wire.to.componentId); wire.color = "#777777"; wire.style = "curve"; wire.waypoints = [{ x: 300, y: 400 }]; }
  document.roles = Object.fromEntries(Object.entries(document.roles).map(([role, id]) => [role, renamed.get(id)]));
  const result = assess(document); assert.equal(result.status, "passed", failures(result));
});

test("course 01 follows the supplied drawing without requiring FR", () => {
  const document = wired(1); assert.equal(document.components.some(component => component.type === "overload"), false); assert.equal(assess(document).status, "passed");
});
for (const [name, mutate, code] of [
  ["main fuse bypass", doc => connect(doc, "fu1", "1", "fu1", "2"), "FUSE_BYPASS"],
  ["return-side control fuse bypass", doc => connect(doc, "fu2b", "1", "fu2b", "2"), "CONTROL_PROTECTION_BYPASS"],
  ["one main contact bypass", doc => connect(doc, "km", "1", "km", "2"), "CONTACTOR_BYPASS"],
  ["missing PE", doc => removeAt(doc, "m", "PE"), "PE_MISSING"],
  ["missing motor phase", doc => removeAt(doc, "m", "W")],
  ["wrong coil voltage", doc => { removeAt(doc, "km", "A2"); connect(doc, "km", "A2", "source", "N"); }, "COIL_VOLTAGE_MISMATCH"],
  ["phase reaches PE", doc => connect(doc, "fu1", "2", "m", "PE"), "PHASE_EARTH_SHORT"],
  ["short appears when contactor closes", doc => connect(doc, "km", "2", "km", "4"), "PHASE_SHORT"],
]) test(`course 01 rejects ${name}`, () => mutateFails(1, mutate, code));

test("overload control works but bypassed FR main path is still rejected", () => mutateFails(2, doc => connect(doc, "fr", "1", "fr", "2"), "OVERLOAD_MAIN_BYPASS"));
for (const [fuse, input, output] of [["fu1", "3", "4"], ["fu1", "5", "6"], ["fu2a", "1", "2"]]) test(`each fuse matters independently: ${fuse}:${input}-${output} bypass cannot pass`, () => mutateFails(1, doc => connect(doc, fuse, input, fuse, output), fuse === "fu1" ? "FUSE_BYPASS" : "CONTROL_PROTECTION_BYPASS"));
test("protection diagnostics retain the bypass wire and a replayable action sequence", () => {
  const document = wired(1); connect(document, "fu1", "1", "fu1", "2"); const bypass = document.wires.at(-1).id;
  const result = assess(document);
  const diagnostic = result.diagnostics.find(item => item.code === "FUSE_BYPASS" && item.wireIds.includes(bypass));
  assert.ok(diagnostic, failures(result)); assert.ok(diagnostic.terminalIds.includes("m::U")); assert.ok(diagnostic.actionSequence.length > 0);
});
test("added unassessed load cannot silently pass a known lesson", () => {
  const document = wired(1); document.components.push({ id: "extra_motor", type: "motor", label: "M extra", position: { x: 0, y: 0 } });
  const result = assess(document); assert.equal(result.status, "unsupported"); assert.ok(result.diagnostics.some(item => item.code === "UNASSESSED_COMPONENTS"));
});
test("course 03 rejects bypassed compound-button NC that falsely latches jogging", () => mutateFails(3, doc => connect(doc, "sb3", "11", "sb3", "12"), "JOG_LATCHED"));
test("course 04 rejects bypassed electrical interlock", () => mutateFails(4, doc => connect(doc, "km1", "21", "km1", "22")));
test("course 05 rejects missing reverse-button cross NC", () => mutateFails(5, doc => connect(doc, "sb2", "11", "sb2", "12"), "INTERLOCK_INEFFECTIVE"));
for (const number of [4, 5]) for (const start of ["sb1", "sb2"]) test(`course ${number}: held ${start} cannot bypass STOP/FR while its normal self-hold branch stays protected`, () => {
  const result = mutateFails(number, doc => { removeAt(doc, start, "23"); connect(doc, "fu2a", "2", start, "23"); }, "STOP_CONTROL_BYPASS");
  assert.ok(result.diagnostics.some(item => item.code === "OVERLOAD_CONTROL_BYPASS"));
});
test("course 06 rejects missing reversing limit NO", () => mutateFails(6, doc => removeAt(doc, "sq1", "24")));
test("course 06 rejects bypassed directional overtravel limit", () => mutateFails(6, doc => connect(doc, "sq3", "11", "sq3", "12"), "LIMIT_INEFFECTIVE"));
for (const limit of ["sq1", "sq2"]) test(`course 06: held ${limit} fed upstream of STOP/FR must not be falsely accepted`, () => {
  const result = mutateFails(6, doc => { removeAt(doc, limit, "23"); connect(doc, "fu2a", "2", limit, "23"); }, "STOP_CONTROL_BYPASS");
  assert.ok(result.diagnostics.some(item => item.code === "OVERLOAD_CONTROL_BYPASS"));
  assert.ok(result.checks.some(item => item.id.includes("trip") && !item.passed));
  assert.ok(result.checks.some(item => item.id.endsWith("stop") && !item.passed));
});
test("course 07 rejects missing M1 permission for M2", () => mutateFails(7, doc => connect(doc, "km1_aux", "13", "km1_aux", "14"), "SEQUENCE_PERMISSION_MISSING"));
test("course 07 rejects missing M2 bypass of M1 stop", () => mutateFails(7, doc => removeAt(doc, "km2_aux", "14"), "STOP_SEQUENCE_INEFFECTIVE"));
test("course 07 rejects one ineffective FR despite the other one working", () => mutateFails(7, doc => connect(doc, "fr2", "95", "fr2", "96"), "OVERLOAD_INEFFECTIVE"));
test("course 08 rejects a timer NO bypass causing immediate start", () => mutateFails(8, doc => connect(doc, "kt", "25", "kt", "28"), "TIMER_BYPASS"));
test("course 08 rejects KM NC bypass leaving KA and KT permanently energized", () => mutateFails(8, doc => connect(doc, "km", "21", "km", "22")));
test("course 09 rejects a star point connected to neutral", () => mutateFails(9, doc => connect(doc, "kmy", "2", "source", "N")));
test("course 09 rejects missing star shorting branch", () => mutateFails(9, doc => removeAt(doc, "kmy", "6")));
test("course 09 rejects delta bypass of the star interlock", () => mutateFails(9, doc => connect(doc, "kmy", "21", "kmy", "22")));
test("course 10 rejects missing common-point contactor feed while KM2 still energizes", () => mutateFails(10, doc => removeAt(doc, "km3", "A1")));
test("course 10 rejects incomplete high-speed common connection", () => mutateFails(10, doc => removeAt(doc, "km3", "6")));
for (const start of ["sb2", "sb3"]) test(`course 10: ${start} held cannot evade FR TEST merely because control power also crosses FR's fixed main pole`, () => {
  const document = wired(10);
  removeAt(document, "fu2a", "1"); connect(document, "fr", "2", "fu2a", "1");
  for (const [component, terminal] of [["fr", "95"], ["fr", "96"], ["sb1", "11"], ["sb1", "12"]]) removeAt(document, component, terminal);
  connect(document, "fu2a", "2", "sb1", "11"); connect(document, "sb1", "12", "fr", "95");
  for (const [component, terminal] of [["km1", "13"], ["km2", "13"], ["sb2", "23"], ["sb3", "23"]]) connect(document, component === start ? "sb1" : "fr", component === start ? "12" : "96", component, terminal);
  assert.equal(validateDocument(document).valid, true);
  let running = simulate(document, initialRuntime(document));
  running = simulate(document, running.runtime, { type: "toggle", componentId: "qf" });
  running = simulate(document, running.runtime, { type: "press", componentId: start });
  assert.equal(running.components.m.active, true);
  const heldTrip = simulate(document, running.runtime, { type: "trip-overload", componentId: "fr" });
  assert.equal(heldTrip.components.m.active, true, "the counterexample really bypasses the control NC while the request stays held");
  const released = simulate(document, running.runtime, { type: "release", componentId: start });
  const tappedTrip = simulate(document, released.runtime, { type: "trip-overload", componentId: "fr" });
  assert.equal(tappedTrip.components.m.active, false, "a nominal tap-then-TEST check alone misses this bypass");
  const result = assess(document);
  assert.notEqual(result.status, "passed", "removing the whole FR wrongly treats its fixed main poles as trip contacts");
  assert.ok(result.diagnostics.some(item => item.code === "OVERLOAD_CONTROL_BYPASS"), failures(result));
  removeAt(document, start, "23"); connect(document, "fr", "96", start, "23");
  const repaired = assess(document);
  assert.equal(repaired.status, "passed", `the same main-pole control feed is valid when every request is protected: ${failures(repaired)}`);
});

test("course 10 rejects opposite phase sequence between speed groups", () => mutateFails(10, doc => {
  for (const wire of doc.wires) for (const port of [wire.from, wire.to]) if (port.componentId === "km2") { if (port.terminalId === "1") port.terminalId = "5"; else if (port.terminalId === "5") port.terminalId = "1"; }
}));

for (const number of [8, 9]) test(`course ${number}: configurable delay and segmented time preserve the same behavior`, () => {
  const document = wired(number); document.components.find(component => component.id === "kt").settings.delayMs = 800;
  assert.equal(assess(document).status, "passed");
  let initial = simulate(document, initialRuntime(document));
  for (const action of [{ type: "toggle", componentId: "qf" }, { type: "press", componentId: "sb1" }, { type: "release", componentId: "sb1" }]) initial = simulate(document, initial.runtime, action);
  const once = simulate(document, initial.runtime, { type: "advance-time", ms: 801 });
  let segmented = initial;
  for (const ms of [300, 499, 1, 1]) segmented = simulate(document, segmented.runtime, { type: "advance-time", ms });
  assert.deepEqual(segmented.components, once.components); assert.deepEqual(segmented.runtime.contactors, once.runtime.contactors);
});
for (const number of [8, 9]) test(`course ${number}: minimum and maximum legal timer settings remain assessable`, () => {
  for (const delayMs of [1, 3_600_000]) {
    const document = wired(number);
    document.components.find(component => component.id === "kt").settings.delayMs = delayMs;
    assert.equal(validateDocument(document).valid, true);
    const result = assess(document);
    assert.equal(result.status, "passed", `${delayMs}ms: ${failures(result)}`);
    assert.ok(result.trace.every(entry => entry.action?.type !== "advance-time" || entry.action.ms <= 3_600_000));
    assert.equal(result.diagnostics.some(item => item.code === "INVALID_TIME_STEP"), false);
  }
});

for (const number of [8, 9]) test(`course ${number}: ordered stop and deadline events at the boundary remain replayable`, () => {
  const document = wired(number); document.components.find(component => component.id === "kt").settings.delayMs = 800;
  let initial = simulate(document, initialRuntime(document));
  for (const action of [{ type: "toggle", componentId: "qf" }, { type: "press", componentId: "sb1" }, { type: "release", componentId: "sb1" }, { type: "advance-time", ms: 799 }]) initial = simulate(document, initial.runtime, action);
  const stopped = simulate(document, initial.runtime, { type: "press", componentId: "sb2" });
  const stopThenDeadline = simulate(document, stopped.runtime, { type: "advance-time", ms: 1 });
  assert.equal(stopThenDeadline.components.m.active, false); assert.equal(stopThenDeadline.components.kt.active, false);
  const deadline = simulate(document, initial.runtime, { type: "advance-time", ms: 1 });
  assert.equal(deadline.components.m.active, true);
  if (number === 9) assert.equal(deadline.components.m.connection, "delta");
  const deadlineThenStop = simulate(document, deadline.runtime, { type: "press", componentId: "sb2" });
  assert.equal(deadlineThenStop.components.m.active, false);
  assert.equal(deadlineThenStop.runtime.timeMs, stopThenDeadline.runtime.timeMs);
});
