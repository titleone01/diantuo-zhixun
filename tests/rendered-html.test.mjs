import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function publishedPageSource() {
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  const scriptUrl = html.match(/<script type="module" src="([^"]+\.js)"><\/script>/)?.[1];
  assert.ok(scriptUrl, "Pages index must reference its JavaScript entry");
  const relativeScript = scriptUrl.replace(/^\/diantuo-zhixun\//, "");
  const bundle = await readFile(new URL(`../docs/${relativeScript}`, import.meta.url), "utf8");
  const decodedBundle = bundle
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
  return `${html}\n${decodedBundle}`;
}

test("generated Pages entry contains the current 2D static demonstration", async () => {
  const bundle = await publishedPageSource();
  for (const label of ["电拓智训", "器件库", "图纸集", "仿真广场", "元器件百科", "个人中心", "开始仿真", "草稿箱", "静态演示", "项目图纸", "曲线", "motor-self-hold"]) assert.ok(bundle.includes(label), label);
  assert.match(bundle, /diantuo:simulator:demo:v1/);
  assert.doesNotMatch(bundle, /BOOTSTRAP_SECRET/);
  for (const type of ["breaker3", "contactor380", "push-no", "motor"]) {
    const asset = await readFile(new URL(`../docs/sim-assets/${type}.svg`, import.meta.url), "utf8");
    assert.match(asset, /<svg/);
  }
});
test("keeps component assets, scene instances, 3D rendering, and simulation separated", async () => {
  const [page, catalog, store, canvas, controlPanel, electrical, analysis, packageJson, terminalAsset, breakerAsset, starterAsset, deviceModels, router, architecture] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/WiringScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/DolControlPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/electrical.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/circuit-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/training/component-library/chint/jcuk-5n-3p-row.json", import.meta.url), "utf8"),
    readFile(new URL("../app/training/component-library/chint/nxb-63.json", import.meta.url), "utf8"),
    readFile(new URL("../app/training/component-library/chint/nc1-0910.json", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/DeviceModels.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/routing.ts", import.meta.url), "utf8"),
    readFile(new URL("../architecture/3d-wiring.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /SimulatorApp/);
  assert.match(catalog, /componentLibrary/);
  assert.match(catalog, /worldTerminalPosition/);
  assert.match(store, /create<WiringSceneState>/);
  assert.match(store, /addInstance/);
  assert.match(store, /beginTerminal/);
  assert.match(store, /finishTerminal/);
  assert.match(store, /beginMoveInstance/);
  assert.match(store, /hydrateScene/);
  assert.match(store, /toggleBreaker/);
  assert.match(store, /confirmPowerOn/);
  assert.match(store, /tripOverload/);
  assert.match(store, /syncRuntime/);
  assert.match(canvas, /<Canvas/);
  assert.match(canvas, /orthographic/);
  assert.match(canvas, /application\/x-electrical-asset/);
  // Persistence behavior (including corrupt drafts and quota errors) is covered
  // by scene-persistence.test.mjs; the canvas delegates to that boundary.
  assert.match(canvas, /createScenePersistence\(storageKey\)/);
  assert.match(canvas, /four-rail-cabinet/);
  assert.match(canvas, /mouseButtons\.MIDDLE = THREE\.MOUSE\.PAN/);
  assert.match(canvas, /screenSpacePanning/);
  assert.match(canvas, /useCallback\(\(\) => onMovingChange\(true\)/);
  assert.match(canvas, /左键拖动空白 \/ 中键拖动画布/);
  assert.match(controlPanel, /M1 外部电机接口/);
  assert.match(controlPanel, /标准答案评分不限制安全非标准接线上电/);
  assert.doesNotMatch(canvas, /ReactFlow/);
  assert.match(analysis, /export function analyzeCircuit/);
  assert.match(analysis, /export function analyzeDolCircuit/);
  assert.match(analysis, /export function evaluateDolStandardAnswer/);
  assert.match(electrical, /projectSceneWires/);
  assert.match(electrical, /createDolCircuitModel/);
  assert.match(packageJson, /"@react-three\/fiber"/);
  assert.match(packageJson, /"@react-three\/drei"/);
  assert.match(packageJson, /"zustand"/);
  assert.match(packageJson, /"three"/);
  assert.match(packageJson, /"@xyflow\/react"/);
  assert.match(terminalAsset, /CHINT_JCUK-5N\.glb/);
  assert.match(terminalAsset, /"sourcePosition3d"/);
  assert.match(terminalAsset, /"type": "din-rail"/);
  assert.match(breakerAsset, /CHINT_NXB-63_3P\.glb/);
  assert.match(breakerAsset, /"kind": "breaker-toggle"/);
  assert.match(breakerAsset, /"contactPairs"/);
  assert.match(breakerAsset, /"sourcePosition3d"/);
  assert.match(breakerAsset, /"pivot": \[-8\.5, 22\.3, -19\.1\]/);
  assert.match(breakerAsset, /"axis": "y"/);
  assert.match(starterAsset, /"coil": \{ "pair": \["A1", "A2"\], "ratedVoltageV": 380 \}/);
  assert.match(starterAsset, /"ncPair": \["95", "96"\]/);
  assert.match(deviceModels, /official-breaker-handle-pivot/);
  assert.match(deviceModels, /pivot\.position\.fromArray/);
  assert.doesNotMatch(deviceModels, /BreakerActuator/);
  assert.doesNotMatch(deviceModels, /Box3\(\)\.setFromObject\(handle\)/);
  assert.match(deviceModels, /scene-breaker-state/);
  assert.match(router, /routeInDuctNetwork/);
  assert.match(router, /nearestDuctEntry/);
  assert.match(architecture, /单一 React Three Fiber 场景/);
  assert.match(architecture, /资产不是实例/);
});

test("component library assets expose stable 3D terminal contracts", async () => {
  const urls = [
    "../app/training/component-library/chint/jcuk-5n-3p-row.json",
    "../app/training/component-library/chint/jcuk-5jd.json",
    "../app/training/component-library/chint/nxb-63.json",
    "../app/training/component-library/chint/nc1-0910.json",
    "../app/training/component-library/chint/np2-ba31.json",
    "../app/training/component-library/chint/np2-ba42.json",
  ];
  for (const url of urls) {
    const asset = JSON.parse(await readFile(new URL(url, import.meta.url), "utf8"));
    assert.equal(asset.schemaVersion, 1);
    assert.ok(["din-rail", "panel-screw"].includes(asset.mounting.type));
    assert.ok(asset.terminals.length >= 2);
    for (const terminal of asset.terminals) {
      assert.equal(terminal.position.length, 3);
      assert.equal(terminal.exitDirection.length, 3);
      assert.ok(terminal.position.every(Number.isFinite));
    }
  }
});
