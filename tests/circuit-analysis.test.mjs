import assert from "node:assert/strict";
import test from "node:test";

import {
  DOL_STANDARD_CONNECTIONS,
  analyzeCircuit,
  analyzeDolCircuit,
  evaluateDolStandardAnswer,
} from "../app/circuit-analysis.ts";

const wire = (from, to) => ({ from, to });

test("allows an incomplete but non-dangerous circuit to be energized", () => {
  const result = analyzeCircuit([]);

  assert.equal(result.energized, true);
  assert.equal(result.contactorEngaged, false);
  assert.equal(result.motorRunning, false);
  assert.deepEqual(result.dangers, []);
});

test("trips immediately on a phase-to-phase short circuit", () => {
  const result = analyzeCircuit([wire("XT-L1", "XT-L2")]);

  assert.equal(result.energized, false);
  assert.match(result.dangers.join(";"), /L1 与 L2 相间短路/);
});

test("treats both physical sides of each TB-1506 pole as internally common", () => {
  const result = analyzeCircuit([
    wire("XT-L1-B", "KM-A1"), wire("KM-A2", "XT-L2-B"),
  ]);

  assert.equal(result.energized, true);
  assert.equal(result.contactorEngaged, true);
  assert.deepEqual(result.dangers, []);
});

test("detects a permanently bypassed safety component", () => {
  const result = analyzeCircuit([wire("SB1-11", "SB1-12")]);

  assert.equal(result.energized, false);
  assert.match(result.dangers.join(";"), /SB1 停止按钮被短接/);
});

test("energizes the contactor and motor for a complete working circuit", () => {
  const wires = [
    wire("XT-L1", "FU2-1"), wire("FU2-2", "FR-95"), wire("FR-96", "SB1-11"),
    wire("SB1-12", "SB2-13"), wire("SB2-14", "KM-A1"), wire("KM-A2", "XT-L2"),
    wire("KM-13", "SB2-13"), wire("KM-14", "SB2-14"),
    wire("XT-L1", "QF-L1"), wire("XT-L2", "QF-L2"), wire("XT-L3", "QF-L3"),
    wire("QF-U11", "FU1-U11"), wire("QF-V11", "FU1-V11"), wire("QF-W11", "FU1-W11"),
    wire("FU1-U21", "KM-U21"), wire("FU1-V21", "KM-V21"), wire("FU1-W21", "KM-W21"),
    wire("KM-U31", "FR-U31"), wire("KM-V31", "FR-V31"), wire("KM-W31", "FR-W31"),
    wire("FR-U", "M-U"), wire("FR-V", "M-V"), wire("FR-W", "M-W"),
    wire("XT-PE", "M-PE"),
  ];
  const result = analyzeCircuit(wires);

  assert.equal(result.energized, true);
  assert.equal(result.contactorEngaged, true);
  assert.equal(result.motorRunning, true);
  assert.deepEqual(result.dangers, []);
});

test("accepts a safe phase permutation and still runs the motor", () => {
  const wires = [
    wire("XT-L1", "KM-A1"), wire("KM-A2", "XT-L2"),
    wire("XT-L1", "KM-U21"), wire("KM-U31", "M-V"),
    wire("XT-L2", "KM-V21"), wire("KM-V31", "M-W"),
    wire("XT-L3", "KM-W21"), wire("KM-W31", "M-U"),
  ];
  const result = analyzeCircuit(wires);

  assert.equal(result.energized, true);
  assert.equal(result.contactorEngaged, true);
  assert.equal(result.motorRunning, true);
  assert.deepEqual(result.dangers, []);
});

const dolModel = (overrides = {}) => ({
  wires: DOL_STANDARD_CONNECTIONS,
  fixedConnections: [
    ["X1-L1A", "X1-L1B"], ["X1-L2A", "X1-L2B"], ["X1-L3A", "X1-L3B"],
    ["X2-L1A", "X2-L1B"], ["X2-L2A", "X2-L2B"], ["X2-L3A", "X2-L3B"],
    ["PE1-PEA", "PE1-PEB"],
  ],
  phaseSources: ["X1-L1A", "X1-L2A", "X1-L3A"],
  protectiveEarthSource: "PE1-PEA",
  powerEnabled: true,
  breaker: { closed: true, contacts: [["QF1-1", "QF1-2"], ["QF1-3", "QF1-4"], ["QF1-5", "QF1-6"]] },
  startButton: { pressed: true, contact: ["SB2-13", "SB2-14"] },
  stopButton: { pressed: false, contact: ["SB1-11", "SB1-12"] },
  overload: { tripped: false, ncContact: ["KM1-95", "KM1-96"], noContact: ["KM1-97", "KM1-98"] },
  contactor: {
    previouslyEngaged: false,
    coil: ["KM1-A1", "KM1-A2"],
    mainContacts: [["KM1-1", "KM1-T1"], ["KM1-3", "KM1-T2"], ["KM1-5", "KM1-T3"]],
    auxiliaryNO: [["KM1-13", "KM1-14"]],
  },
  motor: { phases: ["X2-L1B", "X2-L2B", "X2-L3B"], protectiveEarth: "PE1-PEB" },
  protectedContacts: [
    { contact: ["QF1-1", "QF1-2"], label: "QF1 第一极被短接" },
    { contact: ["SB1-11", "SB1-12"], label: "SB1 停止按钮被短接" },
    { contact: ["KM1-95", "KM1-96"], label: "FR1 95-96 被短接" },
  ],
  ...overrides,
});

test("runs M1 while SB2 is pressed on the complete DOL circuit", () => {
  const result = analyzeDolCircuit(dolModel());

  assert.equal(result.powerAvailable, true);
  assert.equal(result.contactorEngaged, true);
  assert.equal(result.motorRunning, true);
  assert.equal(result.protectiveEarthConnected, true);
  assert.deepEqual(result.phaseAtMotor, ["L1", "L2", "L3"]);
});

test("keeps KM1 engaged through 13-14 after SB2 is released", () => {
  const model = dolModel();
  const result = analyzeDolCircuit({
    ...model,
    startButton: { ...model.startButton, pressed: false },
    contactor: { ...model.contactor, previouslyEngaged: true },
  });

  assert.equal(result.contactorEngaged, true);
  assert.equal(result.motorRunning, true);
});

test("releases KM1 and stops M1 when SB1 is pressed", () => {
  const model = dolModel();
  const result = analyzeDolCircuit({
    ...model,
    startButton: { ...model.startButton, pressed: false },
    stopButton: { ...model.stopButton, pressed: true },
    contactor: { ...model.contactor, previouslyEngaged: true },
  });

  assert.equal(result.contactorEngaged, false);
  assert.equal(result.motorRunning, false);
});

test("opens FR1 95-96 and stops M1 after an overload trip", () => {
  const model = dolModel();
  const result = analyzeDolCircuit({
    ...model,
    startButton: { ...model.startButton, pressed: false },
    overload: { ...model.overload, tripped: true },
    contactor: { ...model.contactor, previouslyEngaged: true },
  });

  assert.equal(result.contactorEngaged, false);
  assert.equal(result.motorRunning, false);
  assert.match(result.warnings.join(";"), /95-96 断开/);
});

test("permits safe non-standard wiring to energize without claiming that M1 runs", () => {
  const result = analyzeDolCircuit(dolModel({ wires: [] }));

  assert.equal(result.powerAvailable, true);
  assert.equal(result.contactorEngaged, false);
  assert.equal(result.motorRunning, false);
  assert.deepEqual(result.dangers, []);
});

test("trips the DOL power permission on a phase-to-phase short", () => {
  const result = analyzeDolCircuit(dolModel({
    wires: [{ from: "X1-L1B", to: "X1-L2B", kind: "main" }],
  }));

  assert.equal(result.powerAvailable, false);
  assert.equal(result.motorRunning, false);
  assert.match(result.dangers.join(";"), /L1 与 L2 相间短路/);
});

test("scores the standard answer independently from power permission", () => {
  const complete = evaluateDolStandardAnswer(DOL_STANDARD_CONNECTIONS);
  const incomplete = evaluateDolStandardAnswer(DOL_STANDARD_CONNECTIONS.slice(0, -1));

  assert.equal(complete.correct, true);
  assert.equal(complete.completed, complete.total);
  assert.equal(incomplete.correct, false);
  assert.equal(incomplete.completed, incomplete.total - 1);
  assert.equal(incomplete.missing.length, 1);
});
