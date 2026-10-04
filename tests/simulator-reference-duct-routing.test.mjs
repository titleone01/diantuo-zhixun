import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({ stdin: { contents: 'export * from "./app/simulator/core/lessons"; export * from "./app/simulator/core/catalog"; export * from "./app/simulator/core/duct-layout"; export * from "./app/simulator/core/duct-routing"; export * from "./app/simulator/core/validation"; export * from "./app/simulator/editor/geometry";', resolveDir: process.cwd() }, bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { LESSONS, createLessonDocument, componentSize, isWireDuct, resolveTerminal, arrangeTrainingDucts, putWiresInDucts, routeWireInDucts, segmentInsideDucts, validateDocument, wirePath, TRAINING_LAYOUT_REFERENCES, trainingLayoutReference } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const graph = document => ({ components: document.components.filter(component => !isWireDuct(component.type)).map(({ position, ...component }) => component), wires: document.wires.map(({ style, waypoints, ...wire }) => wire), roles: document.roles });
const overlaps = (a, b) => { const sa = componentSize(a), sb = componentSize(b); return a.position.x < b.position.x + sb.width && a.position.x + sa.width > b.position.x && a.position.y < b.position.y + sb.height && a.position.y + sa.height > b.position.y; };

for (const lesson of LESSONS) test(`${lesson.id}: practice and demonstration have identical clear ducts and every wire stays in them`, () => {
  const practice = createLessonDocument(lesson.id), document = createLessonDocument(lesson.id, { wired: true });
  assert.equal(practice.wires.length, 0);
  assert.deepEqual(practice.components, document.components);
  assert.equal(validateDocument(document).valid, true);
  const ducts = document.components.filter(component => isWireDuct(component.type));
  assert.equal(ducts.length, 6, "use the reference's four horizontal and two vertical channels only");
  assert.equal(ducts.filter(component => component.type === "wire-duct").length, 4);
  assert.equal(ducts.filter(component => component.type === "wire-duct-vertical").length, 2);
  const reference = TRAINING_LAYOUT_REFERENCES[lesson.id];
  if (reference) {
    assert.equal(trainingLayoutReference(document), reference.file);
    const horizontal = ducts.filter(component => component.type === "wire-duct");
    for (const [index, ids] of reference.rows.entries()) for (const id of ids.filter(id => document.components.some(component => component.id === id))) {
      const component = document.components.find(component => component.id === id);
      assert.ok(component.position.y > horizontal[index].position.y + componentSize(horizontal[index]).height);
      assert.ok(component.position.y + componentSize(component).height < horizontal[index + 1].position.y);
    }
    const right = Math.max(...ducts.map(component => component.position.x + componentSize(component).width));
    for (const id of [...reference.buttons, ...(reference.limits ?? [])]) assert.ok(document.components.find(component => component.id === id).position.x > right, "controls stay external as drawn");
  } else assert.equal(trainingLayoutReference(document), "电动机连续运行控制电路布局图.png", "missing layout borrows the documented existing layout");
  for (const duct of ducts) for (const component of document.components.filter(component => !isWireDuct(component.type))) assert.equal(overlaps(duct, component), false, `${duct.id} covers ${component.id}`);
  const before = JSON.stringify(document);
  for (const wire of document.wires) {
    assert.equal(wire.style, "duct");
    const route = routeWireInDucts(document, wire);
    assert.equal(route.status, "routed", `${wire.id}: ${route.message}`);
    assert.deepEqual(route.sections[0][0], resolveTerminal(document, wire.from).world);
    assert.deepEqual(route.sections[0].at(-1), resolveTerminal(document, wire.to).world);
    for (let index = 1; index < route.trunk.length; index++) assert.ok(segmentInsideDucts(document, route.trunk[index - 1], route.trunk[index]), `${wire.id}: internal segment escaped ducts`);
  }
  assert.equal(JSON.stringify(document), before, "routing is presentation and must not edit the circuit");
});

test("a legacy graph can be arranged and routed without replacing IDs, manual hints, attachments or custom ducts", () => {
  const full = createLessonDocument("motor-course-09", { wired: true });
  const legacy = { ...full, components: full.components.filter(component => !isWireDuct(component.type)), drawingMediaId: "own-drawing", drawingMediaType: "image/png", wires: full.wires.map(wire => ({ ...wire, style: "orthogonal", waypoints: [{ x: 12, y: 34 }] })) };
  const before = JSON.stringify(legacy), arranged = putWiresInDucts(arrangeTrainingDucts(legacy));
  assert.deepEqual(graph(arranged), graph(legacy));
  assert.equal(arranged.drawingMediaId, legacy.drawingMediaId);
  assert.deepEqual(arranged.wires[0].waypoints, legacy.wires[0].waypoints);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(arrangeTrainingDucts(arranged), arranged, "repeat arrangement preserves every custom position and size");
});

const fixture = () => ({ schemaVersion: 1, title: "连通线槽测试", components: [
  { id: "a", type: "terminal", label: "XT1", position: { x: 80, y: 60 } },
  { id: "b", type: "terminal", label: "XT2", position: { x: 380, y: 260 } },
  { id: "top", type: "wire-duct", label: "WD1", position: { x: 0, y: 0 }, size: { width: 500, height: 40 } },
  { id: "bottom", type: "wire-duct", label: "WD2", position: { x: 0, y: 200 }, size: { width: 500, height: 40 } },
  { id: "left", type: "wire-duct-vertical", label: "WD3", position: { x: 0, y: 0 }, size: { width: 40, height: 240 } },
  { id: "right", type: "wire-duct-vertical", label: "WD4", position: { x: 460, y: 0 }, size: { width: 40, height: 240 } },
], wires: [{ id: "route", from: { componentId: "a", terminalId: "A" }, to: { componentId: "b", terminalId: "A" }, color: "#f04452", style: "duct" }] });

test("route chooses the shorter connected trunk, keeps stable lanes, and ignores manual waypoints", () => {
  const document = fixture(), wire = document.wires[0];
  const route = routeWireInDucts(document, wire);
  assert.equal(route.status, "routed");
  assert.ok(route.trunk.some(point => point.x >= 460), "the right trunk is shorter than going via x=20");
  assert.ok(!route.trunk.some(point => point.x < 40));
  wire.waypoints = [{ x: 999, y: 999 }];
  assert.deepEqual(routeWireInDucts(document, wire), route);
  assert.deepEqual(routeWireInDucts(JSON.parse(JSON.stringify(document)), wire), route, "JSON reload preserves the same route");
  assert.deepEqual(graph(document).wires, graph(JSON.parse(JSON.stringify(document))).wires);
});

test("moving devices or resizing and moving ducts recomputes world endpoints and routes", () => {
  const document = fixture(), wire = document.wires[0], before = routeWireInDucts(document, wire);
  document.components[0].position.x += 36;
  let route = routeWireInDucts(document, wire);
  assert.equal(route.status, "routed");
  assert.notDeepEqual(route.sections[0][0], before.sections[0][0]);
  assert.deepEqual(route.sections[0][0], resolveTerminal(document, wire.from).world);
  document.components.find(component => component.id === "right").position.x = 560;
  route = routeWireInDucts(document, wire);
  assert.equal(route.status, "routed");
  assert.ok(route.trunk.some(point => point.x <= 40), "moving the right duct disconnects it, so the connected left path is used");
  document.components.find(component => component.id === "left").size.height = 100;
  route = routeWireInDucts(document, wire);
  assert.equal(route.status, "disconnected", "resized rectangles invalidate the network cache even in mutable test fixtures");
  assert.equal((wirePath(document, wire).match(/M /g) ?? []).length, 2, "unconnected leads are separate SVG subpaths, never a cross-board fallback");
});

test("missing or obstructed ducts give explicit presentation errors without changing the electrical graph", () => {
  const document = fixture(), wire = document.wires[0];
  document.components = document.components.filter(component => !isWireDuct(component.type));
  assert.equal(routeWireInDucts(document, wire).status, "missing");
  const blocked = fixture(); blocked.components.push({ id: "block", type: "terminal", label: "挡住入槽的元件", position: { x: 80, y: 0 } });
  const before = JSON.stringify(blocked);
  assert.equal(routeWireInDucts(blocked, blocked.wires[0]).status, "blocked");
  assert.equal(JSON.stringify(blocked), before);
});

test("manual straight, curve and waypoint routes retain the existing behavior", () => {
  const document = fixture(), original = JSON.stringify(document);
  assert.ok(wirePath(document, { ...document.wires[0], style: "curve" }).includes(" C "));
  assert.equal((wirePath(document, { ...document.wires[0], style: "straight" }).match(/L /g) ?? []).length, 1);
  assert.ok(wirePath(document, { ...document.wires[0], style: "orthogonal", waypoints: [{ x: 999, y: 888 }] }).includes("999"));
  assert.equal(JSON.stringify(document), original);
});
