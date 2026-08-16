import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCircuit } from "../app/circuit-analysis.ts";

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
