import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({ stdin: { contents: 'export * from "./app/simulator/core/lessons"; export * from "./app/simulator/core/motor-courses"; export * from "./app/simulator/core/motor-course-assessment"; export * from "./app/simulator/core/catalog"; export * from "./app/simulator/core/duct-layout"; export * from "./app/simulator/core/validation";', resolveDir: process.cwd() }, bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { LESSONS, createLessonDocument, createMotorCourseDocument, assessMotorCourse, componentSize, isWireDuct, arrangeTrainingDucts, putWiresInDucts, validateDocument, TRAINING_LAYOUT_REFERENCES, trainingLayoutReference } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const graph = document => ({ components: document.components.filter(component => !isWireDuct(component.type) && component.type!=="din-rail").map(({ position, ...component }) => component), wires: document.wires.map(({ style, routing, ...wire }) => wire), roles: document.roles });
const overlaps = (a, b) => { const sa = componentSize(a), sb = componentSize(b); return a.position.x < b.position.x + sb.width && a.position.x + sa.width > b.position.x && a.position.y < b.position.y + sb.height && a.position.y + sa.height > b.position.y; };

function assertBetweenChannels(document, id, row) {
  const component = document.components.find(component => component.id === (document.roles?.[id] ?? id));
  assert.ok(component, `layout role ${id} exists`);
  const horizontal = document.components.filter(component => component.type === "wire-duct");
  assert.ok(component.position.y > horizontal[row].position.y + componentSize(horizontal[row]).height, `${id} starts below channel ${row}`);
  assert.ok(component.position.y + componentSize(component).height < horizontal[row + 1].position.y, `${id} ends above channel ${row + 1}`);
}

for (const lesson of LESSONS) test(`${lesson.id}: blank and demonstration initialize one identical six-channel layout`, () => {
  const blank = createLessonDocument(lesson.id), demo = createLessonDocument(lesson.id, { wired: true });
  assert.equal(blank.wires.length, 0);
  assert.deepEqual(blank.components, demo.components);
  assert.deepEqual(blank.roles, demo.roles);
  assert.equal(validateDocument(demo).valid, true);
  const ducts = demo.components.filter(component => isWireDuct(component.type));
  assert.equal(ducts.length, 6);
  assert.equal(ducts.filter(component => component.type === "wire-duct").length, 4);
  assert.equal(ducts.filter(component => component.type === "wire-duct-vertical").length, 2);
  assert.equal(arrangeTrainingDucts(demo), demo, "initialization cannot add a second six-channel layout");
  for (const duct of ducts) for (const component of demo.components.filter(component => !isWireDuct(component.type) && component.type!=="din-rail")) assert.equal(overlaps(duct, component), false, `${duct.id} covers ${component.id}`);
  for (const wire of demo.wires) {
    assert.equal(wire.style, "orthogonal");
    assert.equal(wire.routing, "duct");
  }
  const reference = TRAINING_LAYOUT_REFERENCES[lesson.id];
  if (reference) {
    assert.equal(trainingLayoutReference(demo), reference.file);
    assert.equal(demo.components.filter(component => component.type === "fuse2").length, 1);
    assert.equal(demo.components.filter(component => component.type === "terminal-strip16").length, lesson.id === "motor-course-06" ? 2 : 1);
    assert.equal(demo.components.some(component => component.id === "fu2a" || component.id === "fu2b"), false);
    for (const [row, ids] of reference.rows.entries()) for (const id of ids) assertBetweenChannels(demo, id, row);
    assertBetweenChannels(demo, "fu2", 0);
    const xt = demo.components.find(component => component.type === "terminal-strip16");
    for (const motor of demo.components.filter(component => component.type.startsWith("motor"))) assert.ok(motor.position.y >= xt.position.y + componentSize(xt).height + 76, "external motors stay below the complete XT row with terminal-lead clearance");
    const right = Math.max(...ducts.map(component => component.position.x + componentSize(component).width));
    for (const id of [...reference.buttons, ...(reference.limits ?? [])]) assert.ok(demo.components.find(component => component.id === id).position.x > right, `${id} stays in the external control box`);
    assert.equal(assessMotorCourse(demo, lesson.id).status, "passed", "placement and FU2 conversion preserve the course's electrical behavior");
  } else assert.equal(trainingLayoutReference(demo), TRAINING_LAYOUT_REFERENCES["motor-course-02"].file);
});

test("raw ten-course factories keep legacy electrical templates; arranging two-pole legacy protection does not rewrite IDs", () => {
  for (let number = 1; number <= 10; number++) {
    const id = `motor-course-${String(number).padStart(2, "0")}`, legacy = createMotorCourseDocument(id, { wired: true });
    assert.equal(legacy.components.some(component => isWireDuct(component.type)), false);
    assert.equal(legacy.components.some(component => component.type === "fuse2" || component.type === "terminal-strip16"), false);
    assert.ok(legacy.components.some(component => component.id === "fu2a"));
    assert.ok(legacy.components.some(component => component.id === "fu2b"));
    const before = JSON.stringify(legacy), arranged = arrangeTrainingDucts(legacy);
    assert.deepEqual(graph(arranged), graph(legacy));
    assertBetweenChannels(arranged, "fu2a", 0);
    assertBetweenChannels(arranged, "fu2b", 0);
    assert.equal(assessMotorCourse(arranged, id).status, "passed");
    assert.equal(JSON.stringify(legacy), before, "layout is a pure operation");
  }
});

test("repeated arrangement preserves existing custom duct positions, sizes, attachments and manual geometry", () => {
  const document = createLessonDocument("motor-course-09", { wired: true });
  document.components[0].position = { x: 432, y: 789 };
  const duct = document.components.find(component => isWireDuct(component.type));
  duct.position = { x: -345, y: 901 };
  duct.size = { width: 647, height: 53 };
  document.drawingMediaId = "private-layout";
  document.projectDrawings = { layout: { mediaId: "private-layout", type: "image/png" } };
  document.wires[0].style = "curve";
  delete document.wires[0].routing;
  document.wires[0].waypoints = [{ x: 12, y: 34 }];
  const before = JSON.stringify(document);
  assert.equal(arrangeTrainingDucts(document), document);
  assert.equal(JSON.stringify(document), before);
  const routed = putWiresInDucts(arrangeTrainingDucts(document));
  assert.deepEqual(routed.components, document.components);
  assert.deepEqual(routed.projectDrawings, document.projectDrawings);
  assert.deepEqual(graph(routed), graph(document));
  assert.deepEqual(routed.wires[0].waypoints, document.wires[0].waypoints, "manual hints remain available when leaving auto mode");
  assert.equal(routed.wires[0].routing, "duct");
  assert.equal(routed.wires[0].style, "orthogonal");
  assert.equal(JSON.stringify(document), before);
});

test("free custom documents recognize new FU2 as first-row protection and preserve role remapping", () => {
  const raw = createMotorCourseDocument("motor-course-02", { wired: true });
  raw.components = raw.components.map(component => ({ ...component, id: `saved-${component.id}` }));
  raw.roles = Object.fromEntries(Object.keys(raw.roles).map(role => [role, `saved-${role}`]));
  raw.wires = raw.wires.map(wire => ({ ...wire, from: { ...wire.from, componentId: `saved-${wire.from.componentId}` }, to: { ...wire.to, componentId: `saved-${wire.to.componentId}` } }));
  const arranged = arrangeTrainingDucts(raw);
  assertBetweenChannels(arranged, "fu2a", 0);
  assertBetweenChannels(arranged, "fu2b", 0);
  assert.equal(assessMotorCourse(arranged, raw.lessonId).status, "passed");

  const free = { schemaVersion: 1, title: "自由练习", components: [{ id: "my-fu2", type: "fuse2", label: "FU2", position: { x: 400, y: 2000 } }], wires: [] };
  assertBetweenChannels(arrangeTrainingDucts(free), "my-fu2", 0);
  assert.deepEqual(graph(arrangeTrainingDucts(free)), graph(free));
});
