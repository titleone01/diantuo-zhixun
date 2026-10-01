import assert from "node:assert/strict";
import test from "node:test";

import { analyzeDolCircuit, DOL_STANDARD_CONNECTIONS } from "../app/circuit-analysis.ts";

const wire = (from, to) => ({ from, to, kind: "main" });
const pair = (from, to) => [from, to];
const makeModel = () => ({
  wires: DOL_STANDARD_CONNECTIONS.map((connection) => ({ ...connection })),
  fixedConnections: [
    pair("X1-L1A", "X1-L1B"), pair("X1-L2A", "X1-L2B"), pair("X1-L3A", "X1-L3B"),
    pair("X2-L1A", "X2-L1B"), pair("X2-L2A", "X2-L2B"), pair("X2-L3A", "X2-L3B"),
    pair("PE1-PEA", "PE1-PEB"),
  ],
  phaseSources: ["X1-L1A", "X1-L2A", "X1-L3A"],
  protectiveEarthSource: "PE1-PEA",
  powerEnabled: true,
  breaker: { closed: true, contacts: [pair("QF1-1", "QF1-2"), pair("QF1-3", "QF1-4"), pair("QF1-5", "QF1-6")] },
  startButton: { pressed: false, contact: pair("SB2-13", "SB2-14") },
  stopButton: { pressed: false, contact: pair("SB1-11", "SB1-12") },
  overload: { tripped: false, ncContact: pair("KM1-95", "KM1-96"), noContact: pair("KM1-97", "KM1-98") },
  contactor: {
    previouslyEngaged: false,
    coil: pair("KM1-A1", "KM1-A2"),
    mainContacts: [pair("KM1-1", "KM1-T1"), pair("KM1-3", "KM1-T2"), pair("KM1-5", "KM1-T3")],
    auxiliaryNO: [pair("KM1-13", "KM1-14")],
  },
  motor: { phases: ["X2-L1B", "X2-L2B", "X2-L3B"], protectiveEarth: "PE1-PEB" },
  protectedContacts: [
    { contact: pair("QF1-1", "QF1-2"), label: "QF1 第一极被短接" },
    { contact: pair("SB1-11", "SB1-12"), label: "SB1 停止按钮被短接" },
    { contact: pair("KM1-95", "KM1-96"), label: "FR1 95-96 被短接" },
    { contact: pair("KM1-A1", "KM1-A2"), label: "KM1 线圈被短接" },
  ],
});

test("a load-side phase short is blocked when QF closes", () => {
  const model = makeModel();
  model.wires.push(wire("QF1-2", "QF1-4"));
  model.breaker.closed = false;
  assert.deepEqual(analyzeDolCircuit(model).dangers, []);
  model.breaker.closed = true;
  const result = analyzeDolCircuit(model);
  assert.equal(result.powerAvailable, false);
  assert.equal(result.motorRunning, false);
  assert.match(result.dangers.join(";"), /L1 与 L2 相间短路/);
});

test("a short created by pressing SB2 is detected through the closed control contact", () => {
  const model = makeModel();
  model.wires = [
    wire("X1-L1B", "QF1-1"), wire("X1-L2B", "QF1-3"),
    wire("QF1-2", "SB2-13"), wire("QF1-4", "SB2-14"),
  ];
  assert.deepEqual(analyzeDolCircuit(model).dangers, []);
  model.startButton.pressed = true;
  const result = analyzeDolCircuit(model);
  assert.equal(result.powerAvailable, false);
  assert.match(result.dangers.join(";"), /相间短路/);
});

test("a motor-side short trips on the same analysis that would engage KM1", () => {
  const model = makeModel();
  model.wires.push(wire("X2-L1B", "X2-L2B"));
  assert.deepEqual(analyzeDolCircuit(model).dangers, []);
  model.startButton.pressed = true;
  const result = analyzeDolCircuit(model);
  assert.equal(result.powerAvailable, false);
  assert.equal(result.contactorEngaged, false);
  assert.equal(result.motorRunning, false);
  assert.deepEqual(result.phaseAtMotor, ["-", "-", "-"]);
  assert.match(result.dangers.join(";"), /相间短路/);
});

test("a motor-side ground fault trips when KM1 would engage", () => {
  const model = makeModel();
  model.wires.push(wire("X2-L3B", "PE1-PEB"));
  model.startButton.pressed = true;
  const result = analyzeDolCircuit(model);
  assert.equal(result.powerAvailable, false);
  assert.equal(result.motorRunning, false);
  assert.match(result.dangers.join(";"), /L3 对保护地短路/);
});

test("an exposed motor earth terminal is checked even when its PE connection is missing", () => {
  const model = makeModel();
  model.fixedConnections = model.fixedConnections.filter(([from]) => from !== "PE1-PEA");
  model.wires.push(wire("X2-L1B", "PE1-PEB"));
  model.startButton.pressed = true;
  const result = analyzeDolCircuit(model);
  assert.equal(result.protectiveEarthConnected, false);
  assert.equal(result.powerAvailable, false);
  assert.match(result.dangers.join(";"), /L1 对保护地短路/);
});

test("the complete DOL circuit obeys power, QF, SB1, FR1, start and holding states", () => {
  for (let flags = 0; flags < 64; flags += 1) {
    const model = makeModel();
    model.powerEnabled = Boolean(flags & 1);
    model.breaker.closed = Boolean(flags & 2);
    model.stopButton.pressed = Boolean(flags & 4);
    model.overload.tripped = Boolean(flags & 8);
    model.startButton.pressed = Boolean(flags & 16);
    model.contactor.previouslyEngaged = Boolean(flags & 32);
    const shouldRun = model.powerEnabled && model.breaker.closed
      && !model.stopButton.pressed && !model.overload.tripped
      && (model.startButton.pressed || model.contactor.previouslyEngaged);
    const result = analyzeDolCircuit(model);
    assert.equal(result.contactorEngaged, shouldRun, `KM1 state for flags ${flags}`);
    assert.equal(result.motorRunning, shouldRun, `M1 state for flags ${flags}`);
    assert.deepEqual(result.dangers, [], `no false short for flags ${flags}`);
  }
});

test("without the holding branch M1 runs only while SB2 is pressed", () => {
  const model = makeModel();
  model.wires = model.wires.filter(({ from }) => from !== "KM1-13" && from !== "KM1-14");
  model.startButton.pressed = true;
  const starting = analyzeDolCircuit(model);
  assert.equal(starting.motorRunning, true);
  model.contactor.previouslyEngaged = starting.contactorEngaged;
  model.startButton.pressed = false;
  assert.equal(analyzeDolCircuit(model).motorRunning, false);
});

test("a 380V coil does not engage with both terminals on the same phase", () => {
  const model = makeModel();
  model.wires = model.wires.map((connection) => connection.from === "KM1-A2"
    ? { ...connection, to: "QF1-2" } : connection);
  model.startButton.pressed = true;
  const result = analyzeDolCircuit(model);
  assert.equal(result.contactorEngaged, false);
  assert.equal(result.motorRunning, false);
  assert.match(result.warnings.join(";"), /380V/);
});

test("a missing main phase never reports motor operation", () => {
  const model = makeModel();
  model.wires = model.wires.filter(({ from }) => from !== "KM1-T3");
  model.startButton.pressed = true;
  const result = analyzeDolCircuit(model);
  assert.equal(result.contactorEngaged, true);
  assert.equal(result.motorRunning, false);
  assert.match(result.warnings.join(";"), /未获得完整三相/);
});

test("cutting training power removes live motor phase indicators", () => {
  const model = makeModel();
  model.contactor.previouslyEngaged = true;
  model.powerEnabled = false;
  const result = analyzeDolCircuit(model);
  assert.equal(result.motorRunning, false);
  assert.deepEqual(result.phaseAtMotor, ["-", "-", "-"]);
});

test("releasing stop and resetting an overload do not restart without a new start command", () => {
  const model = makeModel();
  model.startButton.pressed = true;
  model.contactor.previouslyEngaged = analyzeDolCircuit(model).contactorEngaged;
  model.startButton.pressed = false;
  assert.equal(analyzeDolCircuit(model).motorRunning, true);
  model.stopButton.pressed = true;
  model.contactor.previouslyEngaged = analyzeDolCircuit(model).contactorEngaged;
  model.stopButton.pressed = false;
  assert.equal(analyzeDolCircuit(model).motorRunning, false);
  model.startButton.pressed = true;
  model.contactor.previouslyEngaged = analyzeDolCircuit(model).contactorEngaged;
  model.startButton.pressed = false;
  model.overload.tripped = true;
  model.contactor.previouslyEngaged = analyzeDolCircuit(model).contactorEngaged;
  model.overload.tripped = false;
  assert.equal(analyzeDolCircuit(model).motorRunning, false);
});
