"use client";

import { create } from "zustand";
import { getAsset, initialDeviceInstances, resolveTerminal } from "./catalog";
import { clampToBoardAndRail, findAvailablePlacement } from "./layout";
import type { DeviceInstance, SceneWire, WireKind } from "./types";

const HISTORY_LIMIT = 60;

export type SceneSnapshot = {
  instances: DeviceInstance[];
  wires: SceneWire[];
};

export type PersistedWiringScene = SceneSnapshot & {
  version: 2;
  wireKind: WireKind;
  past: SceneSnapshot[];
  future: SceneSnapshot[];
};

const cloneInstances = (instances = initialDeviceInstances) => instances.map((item) => ({
  ...item,
  position: [...item.position] as [number, number, number],
}));
const cloneWires = (wires: SceneWire[]) => wires.map((wire) => ({ ...wire }));
const cloneSnapshot = (value: SceneSnapshot): SceneSnapshot => ({
  instances: cloneInstances(value.instances),
  wires: cloneWires(value.wires),
});
const snapshot = (state: Pick<WiringSceneState, "instances" | "wires">): SceneSnapshot => cloneSnapshot(state);
const appendPast = (state: WiringSceneState) => [...state.past, snapshot(state)].slice(-HISTORY_LIMIT);

type WiringSceneState = {
  instances: DeviceInstance[];
  wires: SceneWire[];
  wireKind: WireKind;
  pendingTerminal: string | null;
  selectedWireId: string | null;
  movingInstanceId: string | null;
  movingOrigin: SceneSnapshot | null;
  past: SceneSnapshot[];
  future: SceneSnapshot[];
  message: string;
  beginTerminal: (terminal: string) => void;
  finishTerminal: (terminal: string) => void;
  cancelConnection: () => void;
  setWireKind: (kind: WireKind) => void;
  selectWire: (wireId: string | null) => void;
  deleteSelectedWire: () => void;
  clearWires: () => void;
  resetBoard: () => void;
  addInstance: (assetId: string, x?: number, z?: number) => void;
  beginMoveInstance: (instanceId: string) => void;
  moveInstance: (instanceId: string, x: number, z: number) => void;
  finishMoveInstance: (instanceId: string) => void;
  undo: () => void;
  redo: () => void;
  hydrateScene: (scene: PersistedWiringScene) => void;
};

const uniqueReference = (instances: DeviceInstance[], assetId: string) => {
  const prefix = getAsset(assetId).referencePrefix;
  const used = new Set(instances.filter((item) => item.assetId === assetId).map((item) => item.reference));
  let number = 1;
  while (used.has(`${prefix}${number}`)) number += 1;
  return `${prefix}${number}`;
};

export const useWiringSceneStore = create<WiringSceneState>((set) => ({
  instances: cloneInstances(),
  wires: [],
  wireKind: "main",
  pendingTerminal: null,
  selectedWireId: null,
  movingInstanceId: null,
  movingOrigin: null,
  past: [],
  future: [],
  message: "拖动器件调整位置；从一个螺丝拖到另一个螺丝完成接线。",

  beginTerminal: (terminal) => set((state) => {
    const resolved = resolveTerminal(state.instances, terminal);
    return {
      pendingTerminal: terminal,
      selectedWireId: null,
      message: `已夹住 ${resolved.electricalId}，拖到目标螺丝后松开`,
    };
  }),
  finishTerminal: (terminal) => set((state) => {
    const from = state.pendingTerminal;
    if (!from) return {};
    if (from === terminal) return { pendingTerminal: null, message: "请选择另一个螺丝端子" };
    const duplicate = state.wires.some((wire) => (
      (wire.from === from && wire.to === terminal) || (wire.from === terminal && wire.to === from)
    ));
    if (duplicate) return { pendingTerminal: null, message: "这两个螺丝端子已经连接" };
    const source = resolveTerminal(state.instances, from);
    const target = resolveTerminal(state.instances, terminal);
    const wire: SceneWire = {
      id: `wire-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      from,
      to: terminal,
      kind: state.wireKind,
    };
    return {
      past: appendPast(state),
      future: [],
      wires: [...state.wires, wire],
      pendingTerminal: null,
      selectedWireId: null,
      message: `${source.electricalId} → ${target.electricalId} 已接入螺丝：两端就近入槽，长距离仅在线槽内走线`,
    };
  }),

  cancelConnection: () => set((state) => state.pendingTerminal
    ? { pendingTerminal: null, message: "已取消本次接线" }
    : {}),
  setWireKind: (wireKind) => set({ wireKind }),
  selectWire: (selectedWireId) => set((state) => {
    if (!selectedWireId) return { selectedWireId: null };
    const wire = state.wires.find((item) => item.id === selectedWireId);
    if (!wire) return { selectedWireId: null };
    const from = resolveTerminal(state.instances, wire.from);
    const to = resolveTerminal(state.instances, wire.to);
    return {
      selectedWireId,
      message: `已选择 ${from.electricalId} → ${to.electricalId}；可点击“拆除所选”`,
    };
  }),
  deleteSelectedWire: () => set((state) => state.selectedWireId ? {
    past: appendPast(state),
    future: [],
    wires: state.wires.filter((wire) => wire.id !== state.selectedWireId),
    selectedWireId: null,
    message: "所选导线已拆除，可用撤回恢复",
  } : {}),
  clearWires: () => set((state) => state.wires.length ? {
    past: appendPast(state),
    future: [],
    wires: [],
    selectedWireId: null,
    pendingTerminal: null,
    message: "接线已清空，可用撤回恢复",
  } : {}),
  resetBoard: () => set((state) => ({
    past: appendPast(state),
    future: [],
    instances: cloneInstances(),
    wires: [],
    selectedWireId: null,
    pendingTerminal: null,
    movingInstanceId: null,
    movingOrigin: null,
    message: "已恢复模板起始布局；所有器件仍可自由拖动",
  })),

  addInstance: (assetId, droppedX, droppedZ) => set((state) => {
    const asset = getAsset(assetId);
    const automatic = droppedX === undefined || droppedZ === undefined;
    const [x, rail] = findAvailablePlacement(
      assetId,
      automatic ? 0 : droppedX,
      automatic ? -4.7 : droppedZ,
      state.instances,
      { tryOtherRails: automatic },
    );
    const positionY = asset.geometry.kind === "gltf" ? 0.75 : 0.35;
    const reference = uniqueReference(state.instances, assetId);
    const instance: DeviceInstance = {
      id: `instance-${reference.toLowerCase()}-${Date.now()}`,
      assetId,
      reference,
      position: [x, positionY, rail],
      rotationY: 0,
    };
    return {
      past: appendPast(state),
      future: [],
      instances: [...state.instances, instance],
      message: automatic
        ? `${reference} 已放到最近空位，可继续拖动调整`
        : `${reference} ${asset.name} 已按落点吸附到 35 mm DIN 导轨`,
    };
  }),

  beginMoveInstance: (instanceId) => set((state) => {
    if (state.movingInstanceId) return {};
    const instance = state.instances.find((item) => item.id === instanceId);
    if (!instance) return {};
    return {
      movingInstanceId: instanceId,
      movingOrigin: snapshot(state),
      selectedWireId: null,
      pendingTerminal: null,
      message: `正在移动 ${instance.reference}；松开后吸附导轨，相关导线会实时跟随`,
    };
  }),
  moveInstance: (instanceId, x, z) => set((state) => {
    if (state.movingInstanceId !== instanceId) return {};
    const instance = state.instances.find((item) => item.id === instanceId);
    if (!instance) return {};
    const [nextX, nextZ] = clampToBoardAndRail(instance.assetId, x, z);
    return {
      instances: state.instances.map((item) => item.id === instanceId
        ? { ...item, position: [nextX, item.position[1], nextZ] }
        : item),
    };
  }),
  finishMoveInstance: (instanceId) => set((state) => {
    if (state.movingInstanceId !== instanceId || !state.movingOrigin) return {};
    const instance = state.instances.find((item) => item.id === instanceId);
    if (!instance) return { movingInstanceId: null, movingOrigin: null };
    const [x, z] = findAvailablePlacement(
      instance.assetId,
      instance.position[0],
      instance.position[2],
      state.instances,
      { ignoredInstanceId: instanceId },
    );
    const instances = state.instances.map((item) => item.id === instanceId
      ? { ...item, position: [x, item.position[1], z] as [number, number, number] }
      : item);
    const original = state.movingOrigin.instances.find((item) => item.id === instanceId);
    const moved = !original || original.position[0] !== x || original.position[2] !== z;
    return {
      instances,
      past: moved ? [...state.past, cloneSnapshot(state.movingOrigin)].slice(-HISTORY_LIMIT) : state.past,
      future: moved ? [] : state.future,
      movingInstanceId: null,
      movingOrigin: null,
      message: moved
        ? `${instance.reference} 已放置，导线端点已同步；可撤回本次移动`
        : `${instance.reference} 位置未改变`,
    };
  }),

  undo: () => set((state) => {
    const previous = state.past.at(-1);
    if (!previous) return { message: "没有可撤回的操作" };
    return {
      ...cloneSnapshot(previous),
      past: state.past.slice(0, -1),
      future: [...state.future, snapshot(state)].slice(-HISTORY_LIMIT),
      pendingTerminal: null,
      selectedWireId: null,
      movingInstanceId: null,
      movingOrigin: null,
      message: "已撤回上一步操作",
    };
  }),
  redo: () => set((state) => {
    const next = state.future.at(-1);
    if (!next) return { message: "没有可重做的操作" };
    return {
      ...cloneSnapshot(next),
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: state.future.slice(0, -1),
      pendingTerminal: null,
      selectedWireId: null,
      movingInstanceId: null,
      movingOrigin: null,
      message: "已重做下一步操作",
    };
  }),
  hydrateScene: (scene) => set({
    instances: cloneInstances(scene.instances),
    wires: cloneWires(scene.wires),
    wireKind: scene.wireKind,
    past: scene.past.map(cloneSnapshot).slice(-HISTORY_LIMIT),
    future: scene.future.map(cloneSnapshot).slice(-HISTORY_LIMIT),
    pendingTerminal: null,
    selectedWireId: null,
    movingInstanceId: null,
    movingOrigin: null,
    message: "已恢复上次保存的接线现场",
  }),
}));
