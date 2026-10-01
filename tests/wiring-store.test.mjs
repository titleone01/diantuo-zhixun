import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { build } from "esbuild";

// Bundle the real Zustand store and catalog in memory. No browser rendering,
// model download, temporary project file, or parallel copy of circuit logic.
const bundled = await build({
  stdin: {
    contents: [
      'export { useWiringSceneStore } from "./app/training/scene/store.ts";',
      'export { initialDeviceInstances, resolveTerminal, getAsset } from "./app/training/scene/catalog.ts";',
      'export { DOL_STANDARD_CONNECTIONS } from "./app/circuit-analysis.ts";',
      'export { getWireColor } from "./app/training/scene/wire-style.ts";',
      'export { buildWireRoute } from "./app/training/scene/routing.ts";',
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  bundle: true, format: "esm", platform: "node", write: false,
});
const {
  useWiringSceneStore: store, initialDeviceInstances, resolveTerminal, getAsset,
  DOL_STANDARD_CONNECTIONS, getWireColor, buildWireRoute,
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const clone = (value) => JSON.parse(JSON.stringify(value));
const state = () => store.getState();
const refresh = () => state().syncRuntime();
const deviceId = (reference) => {
  const instance = state().instances.find((item) => item.reference === reference);
  assert.ok(instance, `Missing fixture device ${reference}`);
  return instance.id;
};
const port = (electricalId) => {
  for (const instance of state().instances) {
    for (const terminal of getAsset(instance.assetId).terminals) {
      if (`${instance.reference}-${terminal.key}` === electricalId) return `${instance.id}::${terminal.key}`;
    }
  }
  assert.fail(`Missing fixture terminal ${electricalId}`);
};

function connect(from, to, kind = "main") {
  state().setWireKind(kind);
  state().beginTerminal(port(from));
  state().finishTerminal(port(to));
  refresh(); // WiringScene invokes this after its instances or wires change.
  return state().wires.at(-1);
}

function connectStandardCircuit() {
  for (const wire of DOL_STANDARD_CONNECTIONS) connect(wire.from, wire.to, wire.kind);
}

function operate(action, reference) {
  state()[action](deviceId(reference));
  refresh();
}

function persist() {
  const current = state();
  return clone({
    version: 2,
    instances: current.instances,
    wires: current.wires,
    wireKind: current.wireKind,
    wireStyle: current.wireStyle,
    past: current.past,
    future: current.future,
  });
}

beforeEach(() => {
  state().hydrateScene({
    version: 2, instances: clone(initialDeviceInstances), wires: [],
    wireKind: "main", wireStyle: "curve", past: [], future: [],
  });
  refresh();
});

test("new wires inherit their source terminal color and the currently selected line style", () => {
  state().setWireStyle("straight");
  const first = connect("X1-L2B", "QF1-3");
  assert.equal(first.color, "#16984b");
  assert.equal(first.style, "straight");
  state().setWireStyle("curve");
  const second = connect("X1-L1B", "QF1-1");
  assert.equal(second.color, "#e0a400");
  assert.equal(second.style, "curve");
  assert.equal(state().wires[0].style, "straight", "changing the default must not restyle existing wires");

  state().beginTerminal(first.to);
  state().finishTerminal(first.from);
  assert.equal(state().wires.length, 2, "reversed duplicate connections must not create a second wire");
});

test("editing one wire preserves connections and route, with reversible independent color and style edits", () => {
  const first = connect("X1-L1B", "QF1-1");
  const second = clone(connect("X1-L2B", "QF1-3"));
  const initialRoute = buildWireRoute(state().instances, first, 0);
  state().selectWire(first.id);
  state().updateSelectedWire({ color: "#8B52C7" });
  assert.equal(state().wires[0].color, "#8b52c7");
  assert.equal(state().wires[0].style, "curve");
  state().updateSelectedWire({ style: "straight" });
  assert.equal(state().wires[0].color, "#8b52c7");
  assert.equal(state().wires[0].style, "straight");
  assert.deepEqual(state().wires[1], second);
  assert.equal(state().wires[0].from, first.from);
  assert.equal(state().wires[0].to, first.to);
  assert.deepEqual(buildWireRoute(state().instances, state().wires[0], 0), initialRoute);

  const historyLength = state().past.length;
  state().updateSelectedWire({ color: "not-a-color" });
  assert.equal(state().past.length, historyLength, "rejected edits must not consume undo history");
  state().undo();
  assert.equal(state().wires[0].color, "#8b52c7");
  assert.equal(state().wires[0].style, "curve");
  state().undo();
  assert.deepEqual(state().wires[0], first);
  state().redo();
  state().redo();
  assert.equal(state().wires[0].color, "#8b52c7");
  assert.equal(state().wires[0].style, "straight");
});

test("saved scene appearance and undo history survive hydration, and older version 2 scenes remain editable", () => {
  const first = connect("X1-L2B", "QF1-3");
  state().selectWire(first.id);
  state().updateSelectedWire({ color: "#8052cd", style: "straight" });
  state().setWireStyle("straight");
  const saved = persist();
  state().resetBoard();
  state().hydrateScene(saved);
  assert.equal(state().wireStyle, "straight");
  assert.equal(state().wires[0].color, "#8052cd");
  assert.equal(state().wires[0].style, "straight");
  assert.equal(state().powerState, "off");
  state().undo();
  assert.deepEqual(state().wires[0], first);
  state().redo();
  assert.equal(state().wires[0].color, "#8052cd");

  const legacy = clone(saved);
  delete legacy.wireStyle;
  for (const snapshot of [legacy, ...legacy.past, ...legacy.future]) {
    for (const wire of snapshot.wires) {
      delete wire.color;
      delete wire.style;
    }
  }
  state().hydrateScene(legacy);
  assert.equal(state().wireStyle, "curve");
  const legacyWire = state().wires[0];
  const source = resolveTerminal(state().instances, legacyWire.from);
  assert.equal(getWireColor(legacyWire, source.terminal), "#16984b");
  state().selectWire(legacyWire.id);
  state().updateSelectedWire({ color: "#373f47", style: "straight" });
  assert.equal(state().wires[0].color, "#373f47");
  assert.equal(state().wires[0].from, first.from);
  assert.equal(state().wires[0].to, first.to);
  state().undo();
  assert.equal(getWireColor(state().wires[0], source.terminal), "#16984b");
});

test("the real scene store completes a correct DOL start, self-hold, stop, and restart cycle", () => {
  connectStandardCircuit();
  state().checkWiring();
  assert.equal(state().wiringAssessment.correct, true);
  state().confirmPowerOn();
  refresh();
  assert.equal(state().powerState, "energized");
  assert.equal(state().motorRunning, false, "the open breaker must prevent startup");
  operate("toggleBreaker", "QF1");
  assert.equal(state().contactorEngaged, false, "closing QF1 alone must not start the motor");
  operate("pressPushbutton", "SB2");
  assert.equal(state().contactorEngaged, true);
  assert.equal(state().motorRunning, true);
  assert.deepEqual(state().phaseAtMotor, ["L1", "L2", "L3"]);
  operate("releasePushbutton", "SB2");
  assert.equal(state().motorRunning, true, "KM1 auxiliary contacts must retain self-hold");
  operate("pressPushbutton", "SB1");
  assert.equal(state().contactorEngaged, false);
  assert.equal(state().motorRunning, false);
  operate("releasePushbutton", "SB1");
  assert.equal(state().motorRunning, false, "releasing STOP must not restart the motor");
  operate("pressPushbutton", "SB2");
  operate("releasePushbutton", "SB2");
  assert.equal(state().motorRunning, true);
  state().switchPowerOff();
  refresh();
  assert.equal(state().motorRunning, false);
  assert.equal(state().contactorEngaged, false);
});

test("a source short trips on power-on and needs fault removal plus explicit reset", () => {
  const short = connect("X1-L1A", "X1-L2A");
  state().confirmPowerOn();
  refresh();
  assert.equal(state().powerState, "tripped");
  assert.equal(state().motorRunning, false);
  assert.match(state().dangers.join(";"), /L1 与 L2 相间短路/);
  state().resetProtection();
  assert.equal(state().powerState, "tripped", "an existing source fault must prevent reset");
  state().selectWire(short.id);
  state().deleteSelectedWire();
  refresh();
  assert.equal(state().powerState, "tripped");
  state().confirmPowerOn();
  assert.equal(state().powerState, "tripped", "removing a fault alone must not bypass the protection latch");
  state().resetProtection();
  assert.equal(state().powerState, "off");
  assert.deepEqual(state().dangers, []);
});

test("a running motor short retains its trip diagnostic after the contactor drops out", () => {
  connectStandardCircuit();
  operate("toggleBreaker", "QF1");
  state().confirmPowerOn();
  refresh();
  operate("pressPushbutton", "SB2");
  operate("releasePushbutton", "SB2");
  assert.equal(state().motorRunning, true);
  const short = connect("X2-L1A", "X2-L2A");
  assert.equal(state().powerState, "tripped");
  assert.equal(state().contactorEngaged, false);
  assert.equal(state().motorRunning, false);
  const tripDangers = [...state().dangers];
  assert.match(tripDangers.join(";"), /L1 与 L2 相间短路/);
  refresh();
  refresh();
  assert.deepEqual(state().dangers, tripDangers, "opening KM1 must not erase the reason it tripped");
  state().selectWire(short.id);
  state().deleteSelectedWire();
  refresh();
  state().confirmPowerOn();
  assert.equal(state().powerState, "tripped");
  state().resetProtection();
  state().confirmPowerOn();
  refresh();
  assert.equal(state().powerState, "energized");
  assert.equal(state().motorRunning, false, "reset and power-on must not implicitly resume self-hold");
  operate("pressPushbutton", "SB2");
  assert.equal(state().motorRunning, true);
});

test("FR1 RESET retains a protection trip caused by a real short through its 97-98 contact", () => {
  connectStandardCircuit();
  // 97-98 is normally open. Placing its two sides on different phases makes
  // the overload test create a real short when that contact closes.
  connect("QF1-2", "KM1-97", "control");
  connect("QF1-4", "KM1-98", "control");
  operate("toggleBreaker", "QF1");
  state().confirmPowerOn();
  refresh();
  assert.equal(state().powerState, "energized");
  assert.deepEqual(state().dangers, []);
  state().tripOverload();
  refresh();
  assert.equal(state().overloadTripped, true);
  assert.equal(state().powerState, "tripped");
  const tripDangers = [...state().dangers];
  assert.match(tripDangers.join(";"), /L1 与 L2 相间短路/);

  state().resetOverload();
  assert.equal(state().overloadTripped, false);
  assert.equal(state().powerState, "tripped");
  assert.deepEqual(state().dangers, tripDangers, "FR1 RESET must not acknowledge a separate supply protection trip");
  refresh();
  assert.deepEqual(state().dangers, tripDangers);
  state().confirmPowerOn();
  assert.equal(state().powerState, "tripped");
  assert.equal(state().motorRunning, false);
});
