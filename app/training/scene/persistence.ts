import { componentCatalog } from "./catalog";
import { createDolCircuitModel } from "./electrical";
import type { PersistedWiringScene, SceneSnapshot } from "./store";

type SceneStorage = Pick<Storage, "getItem" | "setItem">;
type PersistenceStatus = { state: "pending" | "ready" | "blocked"; message: string };
const initialStatus: PersistenceStatus = { state: "pending", message: "正在读取本机草稿" };
const wireKinds = new Set(["main", "control", "earth"]);
const operatingStates = new Set(["open", "closed", "idle", "start-pressed", "stop-pressed", "engaged", "tripped"]);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isStyle = (value: unknown) => value === undefined || value === "straight" || value === "curve";

function assertSnapshot(value: unknown): asserts value is SceneSnapshot {
  if (!isRecord(value) || !Array.isArray(value.instances) || !Array.isArray(value.wires)) throw new Error("Invalid scene snapshot");
  const instanceIds = new Set<string>();
  const references = new Set<string>();
  for (const instance of value.instances) {
    if (!isRecord(instance) || !isText(instance.id) || instance.id.includes("::")
      || !isText(instance.reference) || !isText(instance.assetId) || !componentCatalog.has(instance.assetId)
      || !Array.isArray(instance.position) || instance.position.length !== 3 || !instance.position.every(Number.isFinite)
      || !Number.isFinite(instance.rotationY)
      || (instance.operatingState !== undefined && (!isText(instance.operatingState) || !operatingStates.has(instance.operatingState)))
      || instanceIds.has(instance.id) || references.has(instance.reference)) throw new Error("Invalid scene instance");
    instanceIds.add(instance.id);
    references.add(instance.reference);
  }
  const wireIds = new Set<string>();
  for (const wire of value.wires) {
    if (!isRecord(wire) || !isText(wire.id) || !isText(wire.from) || !isText(wire.to)
      || !isText(wire.kind) || !wireKinds.has(wire.kind) || !isStyle(wire.style)
      || (wire.color !== undefined && (typeof wire.color !== "string" || !/^#[0-9a-f]{6}$/i.test(wire.color)))
      || wireIds.has(wire.id)) throw new Error("Invalid scene wire");
    wireIds.add(wire.id);
  }
  // Reuse the real catalog and DOL contract: missing template devices or dangling
  // terminals must be rejected before rendering, simulation, undo, or redo.
  const snapshot = value as SceneSnapshot;
  createDolCircuitModel(snapshot.instances, snapshot.wires, {
    powerEnabled: false, overloadTripped: false, contactorEngaged: false,
  });
}

export function parsePersistedScene(raw: string): PersistedWiringScene {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.version !== 2 || !isText(value.wireKind) || !wireKinds.has(value.wireKind)
    || !isStyle(value.wireStyle) || !Array.isArray(value.past) || !Array.isArray(value.future)) {
    throw new Error("Unsupported scene draft");
  }
  const history = [...value.past, ...value.future];
  assertSnapshot(value);
  for (const snapshot of history) assertSnapshot(snapshot);
  return value as PersistedWiringScene;
}

/** A blocked session never writes again, including delayed autosave callbacks. */
export function createScenePersistence(key: string, getStorage: () => SceneStorage = () => localStorage) {
  let storage: SceneStorage | undefined;
  let expectedRaw: string | null = null;
  let status = initialStatus;
  const listeners = new Set<() => void>();
  const update = (next: PersistenceStatus) => {
    status = next;
    for (const listener of listeners) listener();
  };
  const block = (message: string) => update({ state: "blocked", message });
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => status,
    getServerSnapshot: () => initialStatus,
    load: (hydrate: (scene: PersistedWiringScene) => void) => {
      if (status.state !== "pending") return;
      try {
        storage = getStorage();
        expectedRaw = storage.getItem(key);
      } catch {
        block("本机草稿无法读取，自动保存已暂停；本次修改只保留在页面中，请先检查浏览器存储权限。");
        return;
      }
      if (expectedRaw !== null) {
        try {
          hydrate(parsePersistedScene(expectedRaw));
        } catch {
          block("旧草稿损坏或当前版本不支持，原文已保留，自动保存已暂停；请先备份并修复旧草稿，本次修改尚未保存。");
          return;
        }
      }
      update({ state: "ready", message: "本机自动保存" });
    },
    save: (scene: PersistedWiringScene) => {
      if (status.state !== "ready" || !storage) return false;
      try {
        // Do not silently replace a draft changed by another tab after load.
        if (storage.getItem(key) !== expectedRaw) {
          block("本机草稿已被其他页面更改，自动保存已暂停；现有草稿未覆盖，本次修改尚未保存。");
          return false;
        }
        const raw = JSON.stringify(scene);
        storage.setItem(key, raw);
        expectedRaw = raw;
        return true;
      } catch {
        block("本机草稿保存失败，自动保存已暂停；本次修改尚未保存，请保留页面并检查浏览器存储空间或权限。");
        return false;
      }
    },
  };
}

export type ScenePersistence = ReturnType<typeof createScenePersistence>;
