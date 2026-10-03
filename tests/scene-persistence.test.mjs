import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: [
      'export * from "./app/training/scene/persistence.ts";',
      'export { initialDeviceInstances, componentLibrary } from "./app/training/scene/catalog.ts";',
      'export { useWiringSceneStore } from "./app/training/scene/store.ts";',
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  bundle: true, format: "esm", platform: "node", write: false,
});
const { createScenePersistence, parsePersistedScene, initialDeviceInstances, componentLibrary, useWiringSceneStore: store } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const draft = () => ({
  version: 2, instances: structuredClone(initialDeviceInstances),
  wires: [{ id: "saved-wire", from: "instance-x1::L1B", to: "instance-qf1::1", kind: "main" }],
  wireKind: "main", past: [], future: [],
});
const snapshot = (scene) => ({ instances: structuredClone(scene.instances), wires: structuredClone(scene.wires) });
function memoryStorage(raw = null) {
  const values = new Map(raw === null ? [] : [["scene", raw]]);
  const writes = [];
  return {
    values, writes,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); values.set(key, value); },
  };
}

test("supported version 2 drafts restore the real store, optional appearance fields, and undo/redo history", () => {
  const saved = draft();
  const previous = draft();
  previous.wires = [];
  saved.past = [snapshot(previous)];
  const raw = JSON.stringify(saved);
  const storage = memoryStorage(raw);
  const persistence = createScenePersistence("scene", () => storage);
  persistence.load(store.getState().hydrateScene);
  assert.equal(persistence.getSnapshot().state, "ready");
  assert.deepEqual(store.getState().wires, saved.wires);
  assert.equal(store.getState().wireStyle, "curve");
  store.getState().undo();
  assert.equal(store.getState().wires.length, 0);
  store.getState().redo();
  assert.deepEqual(store.getState().wires, saved.wires);
  const changed = draft();
  changed.wireStyle = "straight";
  changed.wires[0].color = "#8B52C7";
  changed.wires[0].style = "straight";
  assert.equal(persistence.save(changed), true);
  assert.deepEqual(parsePersistedScene(storage.getItem("scene")), changed);
});

test("missing drafts permit first save, but callbacks before load do not write", () => {
  const storage = memoryStorage();
  const persistence = createScenePersistence("scene", () => storage);
  assert.equal(persistence.save(draft()), false);
  assert.equal(storage.writes.length, 0);
  persistence.load(() => assert.fail("missing data must not be hydrated"));
  assert.equal(persistence.save(draft()), true);
  assert.equal(storage.writes.length, 1);
});

test("real store editing, every catalog asset, reset, undo, and redo all produce reloadable drafts", () => {
  store.getState().hydrateScene(draft());
  const verify = () => {
    const { instances, wires, wireKind, wireStyle, past, future } = store.getState();
    const raw = JSON.stringify({ version: 2, instances, wires, wireKind, wireStyle, past, future });
    assert.deepEqual(parsePersistedScene(raw), JSON.parse(raw));
  };
  for (const asset of componentLibrary) {
    store.getState().addInstance(asset.assetId);
    verify();
  }
  const operations = [
    () => store.getState().beginMoveInstance("instance-x1"),
    () => store.getState().moveInstance("instance-x1", -6, 4),
    () => store.getState().finishMoveInstance("instance-x1"),
    () => store.getState().selectWire("saved-wire"),
    () => store.getState().deleteSelectedWire(),
    () => store.getState().undo(),
    () => store.getState().redo(),
    () => store.getState().undo(),
    () => store.getState().clearWires(),
    () => store.getState().undo(),
    () => store.getState().resetBoard(),
    () => store.getState().undo(),
    () => store.getState().redo(),
  ];
  for (const operation of operations) { operation(); verify(); }
});

test("malformed, empty, obsolete, and unsupported drafts stay byte-for-byte intact across autosave attempts", () => {
  const invalid = ["", "  broken JSON\n", "null", "{}", JSON.stringify({ ...draft(), version: 3 }),
    JSON.stringify({ ...draft(), wireKind: ["main"] }), JSON.stringify({ ...draft(), past: null })];
  for (const raw of invalid) {
    const storage = memoryStorage(raw);
    const persistence = createScenePersistence("scene", () => storage);
    persistence.load(() => assert.fail("invalid data must not be hydrated"));
    assert.equal(persistence.getSnapshot().state, "blocked");
    assert.match(persistence.getSnapshot().message, /原文已保留.*自动保存已暂停/);
    assert.equal(persistence.save(draft()), false);
    persistence.load(() => assert.fail("blocked session must not resume itself"));
    assert.equal(persistence.save(draft()), false);
    assert.equal(storage.getItem("scene"), raw);
    assert.equal(storage.writes.length, 0);
  }
});

test("invalid instances, wire endpoints, and every undo/redo snapshot are rejected before hydration", () => {
  const mutations = [
    (scene) => { scene.instances[0].position = [0, 1]; },
    (scene) => { scene.instances[0].rotationY = "0"; },
    (scene) => { scene.instances[0].assetId = "missing-asset"; },
    (scene) => { scene.instances[0].operatingState = ["open"]; },
    (scene) => { scene.instances[1].id = scene.instances[0].id; },
    (scene) => { scene.instances[1].reference = scene.instances[0].reference; },
    (scene) => { scene.instances = scene.instances.filter((instance) => instance.reference !== "SB1"); },
    (scene) => { scene.wires[0].to = "instance-qf1::missing-terminal"; },
    (scene) => { scene.wires[0].to = "missing-device::1"; },
    (scene) => { scene.wires[0].kind = ["main"]; },
    (scene) => { scene.wires[0].color = 123; },
    (scene) => { scene.wires.push({ ...scene.wires[0] }); },
  ];
  for (const mutate of mutations) {
    for (const location of ["current", "past", "future"]) {
      const saved = draft();
      const invalid = draft();
      mutate(invalid);
      if (location === "current") Object.assign(saved, invalid);
      else saved[location] = [snapshot(invalid)];
      const raw = JSON.stringify(saved);
      const storage = memoryStorage(raw);
      const persistence = createScenePersistence("scene", () => storage);
      persistence.load(() => assert.fail(`invalid ${location} must not reach hydration`));
      assert.equal(persistence.getSnapshot().state, "blocked");
      assert.equal(persistence.save(draft()), false);
      assert.equal(storage.getItem("scene"), raw);
    }
  }
  assert.throws(() => parsePersistedScene(JSON.stringify(draft()).replace('"rotationY":0', '"rotationY":1e400')));
});

test("browser storage getter and read failures pause autosave without throwing or writing", () => {
  let writes = 0;
  for (const getStorage of [
    () => { throw new Error("SecurityError"); },
    () => ({ getItem: () => { throw new Error("SecurityError"); }, setItem: () => { writes++; } }),
  ]) {
    const persistence = createScenePersistence("scene", getStorage);
    assert.doesNotThrow(() => persistence.load(() => assert.fail("unreadable storage")));
    assert.equal(persistence.getSnapshot().state, "blocked");
    assert.match(persistence.getSnapshot().message, /无法读取/);
    assert.equal(persistence.save(draft()), false);
  }
  assert.equal(writes, 0);
});

test("quota errors preserve the last stored draft and keep subsequent autosaves paused", () => {
  const raw = JSON.stringify(draft());
  const storage = memoryStorage(raw);
  let attempts = 0;
  storage.setItem = () => { attempts++; throw new Error("QuotaExceededError"); };
  const persistence = createScenePersistence("scene", () => storage);
  const notices = [];
  const unsubscribe = persistence.subscribe(() => notices.push(persistence.getSnapshot().message));
  persistence.load(() => {});
  const changed = draft();
  changed.wires = [];
  assert.equal(persistence.save(changed), false);
  assert.equal(storage.getItem("scene"), raw);
  assert.equal(persistence.save(changed), false);
  assert.equal(attempts, 1);
  assert.match(notices.at(-1), /保存失败.*本次修改尚未保存/);
  unsubscribe();
});

test("a failed hydrate callback never permits a later template autosave", () => {
  const raw = JSON.stringify(draft());
  const storage = memoryStorage(raw);
  const persistence = createScenePersistence("scene", () => storage);
  persistence.load(() => { throw new Error("unsupported renderer contract"); });
  assert.equal(persistence.save(draft()), false);
  assert.equal(storage.getItem("scene"), raw);
  assert.equal(storage.writes.length, 0);
});

test("a draft changed by another tab is preserved instead of silently overwritten", () => {
  const storage = memoryStorage(JSON.stringify(draft()));
  const persistence = createScenePersistence("scene", () => storage);
  persistence.load(() => {});
  const external = "  external draft awaiting recovery  ";
  storage.values.set("scene", external);
  assert.equal(persistence.save(draft()), false);
  assert.equal(storage.getItem("scene"), external);
  assert.match(persistence.getSnapshot().message, /其他页面更改/);
  assert.equal(storage.writes.length, 0);
});
