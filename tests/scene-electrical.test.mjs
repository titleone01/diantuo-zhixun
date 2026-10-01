import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// Bundle the real scene projection (including JSON asset contracts) in memory.
const compiled = await build({
  stdin: {
    contents: `export { analyzeSceneDol } from "./app/training/scene/electrical.ts";
export { initialDeviceInstances } from "./app/training/scene/catalog.ts";
export { DOL_STANDARD_CONNECTIONS } from "./app/circuit-analysis.ts";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { analyzeSceneDol, initialDeviceInstances, DOL_STANDARD_CONNECTIONS } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

const runtime = { powerEnabled: true, overloadTripped: false, contactorEngaged: false };
const wire = (from, to) => ({ id: `${from}-${to}`, from, to, kind: "main" });
const extra = (reference, assetId, operatingState) => ({
  id: `extra-${reference}`, reference, assetId, operatingState, position: [0, 0.2, 0], rotationY: 0,
});
const standardWires = () => {
  const references = Object.fromEntries(initialDeviceInstances.map((instance) => [instance.reference, instance.id]));
  const terminal = (id) => {
    const separator = id.indexOf("-");
    return `${references[id.slice(0, separator)]}::${id.slice(separator + 1)}`;
  };
  return DOL_STANDARD_CONNECTIONS.map((connection, index) => ({
    ...connection, id: `standard-${index}`, from: terminal(connection.from), to: terminal(connection.to),
  }));
};

test("an extra closed QF cannot hide a phase short while QF1 is open", () => {
  const qf = extra("QF2", "chint.nxb-63-3p", "closed");
  const wires = [wire("instance-x1::L1B", `${qf.id}::1`), wire(`${qf.id}::2`, "instance-x1::L2B")];
  const result = analyzeSceneDol([...initialDeviceInstances, qf], wires, runtime);
  assert.equal(result.powerAvailable, false);
  assert.match(result.dangers.join(";"), /L1 与 L2 相间短路/);
  const open = analyzeSceneDol([...initialDeviceInstances, { ...qf, operatingState: "open" }], wires, runtime);
  assert.deepEqual(open.dangers, []);
});

test("extra NO and NC buttons follow their existing contact contracts", () => {
  for (const [reference, assetId, keys, pressed, initiallyClosed] of [
    ["SB3", "chint.np2-ba31", ["13", "14"], "start-pressed", false],
    ["SB4", "chint.np2-ba42", ["11", "12"], "stop-pressed", true],
  ]) {
    const button = extra(reference, assetId, "idle");
    const wires = [wire("instance-x1::L1B", `${button.id}::${keys[0]}`), wire(`${button.id}::${keys[1]}`, "instance-x1::L2B")];
    const idleResult = analyzeSceneDol([...initialDeviceInstances, button], wires, runtime);
    const pressedResult = analyzeSceneDol([...initialDeviceInstances, { ...button, operatingState: pressed }], wires, runtime);
    assert.equal(idleResult.powerAvailable, !initiallyClosed);
    assert.equal(pressedResult.powerAvailable, initiallyClosed);
  }
});

test("an extra start button can start KM1 without being misreported as a permanent bypass", () => {
  const start = extra("SB3", "chint.np2-ba31", "start-pressed");
  const instances = initialDeviceInstances.map((instance) => instance.reference === "QF1"
    ? { ...instance, operatingState: "closed" } : instance);
  const wires = [...standardWires(),
    wire("instance-sb2::13", `${start.id}::13`), wire("instance-sb2::14", `${start.id}::14`),
  ];
  const result = analyzeSceneDol([...instances, start], wires, runtime);
  assert.deepEqual(result.dangers, []);
  assert.equal(result.motorRunning, true);
});

test("an unused extra contactor is harmless but any connected extra contactor blocks simulation explicitly", () => {
  const km = extra("KM2", "chint.nc1-0910-nre8-25");
  const instances = [...initialDeviceInstances, km];
  assert.deepEqual(analyzeSceneDol(instances, [], runtime).dangers, []);
  const result = analyzeSceneDol(instances, [wire("instance-x1::L1B", `${km.id}::1`)], runtime);
  assert.equal(result.powerAvailable, false);
  assert.equal(result.contactorEngaged, false);
  assert.equal(result.motorRunning, false);
  assert.match(result.dangers.join(";"), /KM2 已接入导线.*仅支持 KM1/);
});

test("PE terminal continuity is explicitly separated from external motor earthing validation", () => {
  const result = analyzeSceneDol(initialDeviceInstances, [], runtime);
  assert.equal(result.protectiveEarthConnected, true);
  assert.match(result.warnings.join(";"), /PE1 仅验证端子内部导通/);
  assert.match(result.warnings.join(";"), /M1 的保护接地路径尚未验证/);
});
