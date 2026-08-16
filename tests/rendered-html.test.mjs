import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the minimal wiring workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>电拓智训 \| 电气控制虚拟实训平台<\/title>/i);
  assert.match(html, /电气器件库/);
  assert.match(html, /TB-1506/);
  assert.match(html, /NXB-125 3P/);
  assert.match(html, /NC1-0910/);
  assert.match(html, /单击放到空位，或拖到目标导轨/);
  assert.match(html, /撤回/);
  assert.match(html, /重做/);
  assert.match(html, /本机自动保存/);
  assert.doesNotMatch(html, /实训原理图/);
  assert.doesNotMatch(html, /申请上电/);
  assert.doesNotMatch(html, /保存进度/);
});
test("keeps component assets, scene instances, 3D rendering, and simulation separated", async () => {
  const [page, catalog, store, canvas, analysis, packageJson, terminalAsset, router, architecture] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/WiringScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/circuit-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/training/component-library/chint/tb-1506.json", import.meta.url), "utf8"),
    readFile(new URL("../app/training/scene/routing.ts", import.meta.url), "utf8"),
    readFile(new URL("../architecture/3d-wiring.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /TrainingCanvas/);
  assert.match(catalog, /componentLibrary/);
  assert.match(catalog, /worldTerminalPosition/);
  assert.match(store, /create<WiringSceneState>/);
  assert.match(store, /addInstance/);
  assert.match(store, /beginTerminal/);
  assert.match(store, /finishTerminal/);
  assert.match(store, /beginMoveInstance/);
  assert.match(store, /hydrateScene/);
  assert.match(canvas, /<Canvas/);
  assert.match(canvas, /orthographic/);
  assert.match(canvas, /application\/x-electrical-asset/);
  assert.match(canvas, /localStorage/);
  assert.match(canvas, /four-rail-cabinet/);
  assert.doesNotMatch(canvas, /ReactFlow/);
  assert.match(analysis, /export function analyzeCircuit/);
  assert.match(packageJson, /"@react-three\/fiber"/);
  assert.match(packageJson, /"@react-three\/drei"/);
  assert.match(packageJson, /"zustand"/);
  assert.match(packageJson, /"three"/);
  assert.doesNotMatch(packageJson, /"@xyflow\/react"/);
  assert.match(terminalAsset, /CHINT_TB-1506_no-cover\.glb/);
  assert.match(terminalAsset, /"sourcePosition3d"/);
  assert.match(terminalAsset, /"coverPolicy": "removed-for-wiring"/);
  assert.match(router, /routeInDuctNetwork/);
  assert.match(router, /nearestDuctEntry/);
  assert.match(architecture, /单一 React Three Fiber 场景/);
  assert.match(architecture, /资产不是实例/);
});

test("component library assets expose stable 3D terminal contracts", async () => {
  const urls = [
    "../app/training/component-library/chint/tb-1506.json",
    "../app/training/component-library/chint/nxb-125.json",
    "../app/training/component-library/chint/nc1-0910.json",
  ];
  for (const url of urls) {
    const asset = JSON.parse(await readFile(new URL(url, import.meta.url), "utf8"));
    assert.equal(asset.schemaVersion, 1);
    assert.equal(asset.mounting.type, "din-rail");
    assert.ok(asset.terminals.length >= 6);
    for (const terminal of asset.terminals) {
      assert.equal(terminal.position.length, 3);
      assert.equal(terminal.exitDirection.length, 3);
      assert.ok(terminal.position.every(Number.isFinite));
    }
  }
});
