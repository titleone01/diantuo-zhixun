import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["app/simulator/core/engine.ts"], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
const { simulate } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const component = (id, type, extra = {}) => ({ id, type, label: id, position: { x: 0, y: 0 }, ...extra });
const doc = (...components) => ({ schemaVersion: 1, title: "Independent engine review", components: [component("source", "supply"), ...components], wires: [] });
const wire = (document, a, at, b, bt) => document.wires.push({ id: `r-${document.wires.length}`, from: { componentId: a, terminalId: at }, to: { componentId: b, terminalId: bt }, color: "#888888" });
function twoTimers(document) {
  for (const [id, delayMs] of [["t1", 1000], ["t2", 2000]]) {
    document.components.push(component(id, "timer380", { settings: { delayMs } }));
    wire(document, "source", "L1", id, "A1"); wire(document, "source", "L2", id, "A2");
  }
}

test("review: one time window must retain an unsupported motor state at an earlier deadline", () => {
  const document = doc(component("m", "motor-star-delta")); twoTimers(document);
  for (const [index, terminal] of ["U1", "V1", "W1"].entries()) wire(document, "source", `L${index + 1}`, "m", terminal);
  wire(document, "source", "PE", "m", "PE"); wire(document, "m", "U2", "m", "V2"); wire(document, "m", "V2", "m", "W2");
  wire(document, "source", "N", "t1", "25"); wire(document, "t1", "28", "t2", "15"); wire(document, "t2", "16", "m", "U2");
  const initial = simulate(document); assert.equal(initial.components.m.active, true);
  const intermediate = simulate(document, initial.runtime, { type: "advance-time", ms: 1000 });
  assert.equal(intermediate.supported, false); assert.ok(intermediate.diagnostics.some(item => item.code === "MOTOR_CONNECTION_INVALID"));
  const window = simulate(document, initial.runtime, { type: "advance-time", ms: 2000 });
  assert.equal(window.supported, false, "a later valid topology must not erase the unsupported interval");
  assert.ok(window.diagnostics.some(item => item.code === "MOTOR_CONNECTION_INVALID"));
});

test("review: a time window retains temporary missing-phase evidence even after the next deadline restores supply", () => {
  const document = doc(component("m", "motor")); twoTimers(document);
  wire(document, "source", "L1", "m", "U"); wire(document, "source", "L2", "m", "V"); wire(document, "source", "PE", "m", "PE");
  wire(document, "source", "L3", "t1", "15"); wire(document, "t1", "16", "m", "W");
  wire(document, "source", "L3", "t2", "25"); wire(document, "t2", "28", "m", "W");
  const initial = simulate(document); assert.equal(initial.components.m.active, true);
  const intermediate = simulate(document, initial.runtime, { type: "advance-time", ms: 1000 });
  assert.equal(intermediate.components.m.active, false); assert.ok(intermediate.diagnostics.some(item => item.code === "MOTOR_PHASE_MISSING"));
  const window = simulate(document, initial.runtime, { type: "advance-time", ms: 2000 });
  assert.ok(window.diagnostics.some(item => item.code === "MOTOR_PHASE_MISSING"), "restoring phase at the final deadline must not hide the earlier loss");
});

test("review: a short only exposed by a compound-button open interval is latched before its final contacts close", () => {
  const document = doc(component("sb", "push-no"), component("km", "contactor380"), component("gate", "switch1"));
  for (const input of ["11", "23"]) wire(document, "source", "L1", "sb", input);
  for (const output of ["12", "24"]) wire(document, "sb", output, "km", "A1");
  wire(document, "km", "A2", "source", "L2");
  wire(document, "source", "L1", "gate", "1"); wire(document, "gate", "2", "km", "21"); wire(document, "km", "22", "source", "L2");
  let result = simulate(document); assert.equal(result.components.km.active, true);
  result = simulate(document, result.runtime, { type: "press", componentId: "sb" }); assert.equal(result.components.km.active, true);
  result = simulate(document, result.runtime, { type: "toggle", componentId: "gate" }); assert.equal(result.runtime.faultLatched, false);
  result = simulate(document, result.runtime, { type: "release", componentId: "sb" });
  assert.equal(result.runtime.faultLatched, true); assert.equal(result.runtime.powerOn, false);
  const cause = result.diagnostics.find(item => item.code === "PHASE_SHORT"); assert.ok(cause); assert.ok(cause.wireIds.length);
  result = simulate(document, result.runtime, { type: "press", componentId: "sb" });
  result = simulate(document, result.runtime, { type: "power", enabled: true });
  assert.equal(result.runtime.faultLatched, true); assert.deepEqual(result.diagnostics.find(item => item.code === "PHASE_SHORT"), cause);
});
