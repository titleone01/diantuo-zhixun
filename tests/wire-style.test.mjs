import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createWireCurve, createWireGeometry } from "../app/training/scene/wire-geometry.ts";
import { getTerminalColor, getWireColor, normalizeWireColor } from "../app/training/scene/wire-style.ts";

const terminal = (key, label = key, internalGroup) => ({
  key, label, internalGroup, position: [0, 0, 0], exitDirection: [0, 0, 1],
});

test("wire defaults follow the starting terminal and a later color override wins", () => {
  const phase1 = terminal("1", "1/L1");
  const phase2 = terminal("3", "3/L2");
  const phase3 = terminal("5", "5/L3");
  assert.equal(getTerminalColor(phase1), getTerminalColor(terminal("L1B", "L1/B", "L1")));
  assert.equal(new Set([phase1, phase2, phase3].map(getTerminalColor)).size, 3);
  assert.equal(getWireColor({}, phase2), getTerminalColor(phase2));
  assert.equal(getWireColor({ color: "#8052CD" }, phase2), "#8052cd");
  assert.equal(getWireColor({ color: "invalid" }, phase2), getTerminalColor(phase2));
  assert.equal(normalizeWireColor("url(https://example.invalid)"), undefined);
});

test("neutral and earth are identified explicitly, while numbered control terminals remain control markers", () => {
  assert.notEqual(getTerminalColor(terminal("N")), getTerminalColor(terminal("PEA", "PE/A", "PE")));
  assert.equal(getTerminalColor(terminal("PEA")), getTerminalColor(terminal("PEB")));
  assert.equal(getTerminalColor(terminal("13", "13/NO")), getTerminalColor(terminal("A1")));
  assert.equal(getTerminalColor(terminal("3", "3")), getTerminalColor(terminal("A1")));
  assert.equal(getTerminalColor(terminal("T2", "FR1 4/T2")), getTerminalColor(terminal("4", "4/T2")));
});

const ductRoute = [[-4, 0.6, -8.25], [-13.5, 0.6, -8.25], [-13.5, 0.6, 8.25], [-3, 0.6, 8.25]];

test("straight and curved geometry retain terminal endpoints and stay inside the same duct network", () => {
  for (const style of ["straight", "curve"]) {
    const path = createWireCurve(ductRoute, style);
    assert.deepEqual(path.getPoint(0).toArray(), ductRoute[0]);
    assert.deepEqual(path.getPoint(1).toArray(), ductRoute.at(-1));
    for (const point of path.getPoints(1000)) {
      const distanceToDuct = Math.min(Math.abs(point.x + 13.5), Math.abs(point.z + 8.25), Math.abs(point.z - 8.25));
      assert.ok(distanceToDuct + 0.098 < 0.75, `${style} route left a 30 mm duct`);
      assert.ok(Math.abs(point.y - 0.6) < 1e-12);
    }
    const geometry = createWireGeometry(ductRoute, style, 0.057);
    assert.ok(geometry.attributes.position.count > 0);
    assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
    geometry.dispose();
  }
  const straight = createWireCurve(ductRoute, "straight");
  const curved = createWireCurve(ductRoute, "curve");
  assert.ok(straight.curves.every((segment) => segment.isLineCurve3));
  assert.ok(curved.curves.some((segment) => segment.isQuadraticBezierCurve3));
  assert.ok(curved.getLength() < straight.getLength());
});

// Bundle the actual catalog and router so these tests exercise the source
// assets without changing application imports to Node-specific JSON syntax.
const bundled = await build({
  stdin: {
    contents: 'export { buildWireRoute } from "./app/training/scene/routing.ts"; export { initialDeviceInstances, resolveTerminal } from "./app/training/scene/catalog.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true, format: "esm", platform: "node", write: false,
});
const scene = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

test("appearance edits never change physical endpoints or route after a component is moved and rotated", () => {
  const instances = scene.initialDeviceInstances.map((instance) => instance.id === "instance-x2"
    ? { ...instance, position: [-7, 0.2, 9], rotationY: Math.PI / 2 }
    : instance);
  const wire = { id: "endpoint-proof", from: "instance-x1::L1A", to: "instance-x2::L3B", kind: "main" };
  const initial = scene.buildWireRoute(instances, wire, 4);
  const modified = scene.buildWireRoute(instances, { ...wire, color: "#8b52c7", style: "straight" }, 4);
  assert.deepEqual(modified, initial);
  assert.deepEqual(modified[0], scene.resolveTerminal(instances, wire.from).world);
  assert.deepEqual(modified.at(-1), scene.resolveTerminal(instances, wire.to).world);
  for (const style of ["straight", "curve"]) {
    const path = createWireCurve(modified, style);
    assert.deepEqual(path.getPoint(0).toArray(), modified[0]);
    assert.deepEqual(path.getPoint(1).toArray(), modified.at(-1));
  }
});
