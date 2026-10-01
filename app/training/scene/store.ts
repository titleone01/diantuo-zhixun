"use client";

import { create } from "zustand";
import type { DolCircuitAnalysis, DolWiringAssessment } from "../../circuit-analysis";
import { getAsset, initialDeviceInstances, resolveTerminal } from "./catalog";
import { analyzeSceneDol, assessSceneDolWiring } from "./electrical";
import { clampToBoardAndRail, findAvailablePlacement } from "./layout";
import type { DeviceInstance, SceneWire, WireKind, WireStyle } from "./types";
import { DEFAULT_WIRE_STYLE, getTerminalColor, normalizeWireColor } from "./wire-style";

const HISTORY_LIMIT = 60;

export type SceneSnapshot = {
  instances: DeviceInstance[];
  wires: SceneWire[];
};

export type PersistedWiringScene = SceneSnapshot & {
  version: 2;
  wireKind: WireKind;
  wireStyle?: WireStyle;
  past: SceneSnapshot[];
  future: SceneSnapshot[];
};

const cloneInstances = (instances = initialDeviceInstances) => instances.map((item) => ({
  ...item,
  position: [...item.position] as [number, number, number],
  operatingState: item.operatingState ?? getAsset(item.assetId).interaction?.defaultState,
}));
const cloneWires = (wires: SceneWire[]) => wires.map((wire) => ({ ...wire }));
const cloneSnapshot = (value: SceneSnapshot): SceneSnapshot => ({
  instances: cloneInstances(value.instances),
  wires: cloneWires(value.wires),
});
const snapshot = (state: Pick<WiringSceneState, "instances" | "wires">): SceneSnapshot => cloneSnapshot(state);
const appendPast = (state: WiringSceneState) => [...state.past, snapshot(state)].slice(-HISTORY_LIMIT);

export type PowerState = "off" | "energized" | "tripped";

type WiringSceneState = {
  instances: DeviceInstance[];
  wires: SceneWire[];
  wireKind: WireKind;
  wireStyle: WireStyle;
  pendingTerminal: string | null;
  selectedWireId: string | null;
  movingInstanceId: string | null;
  movingOrigin: SceneSnapshot | null;
  past: SceneSnapshot[];
  future: SceneSnapshot[];
  message: string;
  powerState: PowerState;
  contactorEngaged: boolean;
  motorRunning: boolean;
  overloadTripped: boolean;
  protectiveEarthConnected: boolean;
  phaseAtMotor: string[];
  dangers: string[];
  warnings: string[];
  wiringAssessment: DolWiringAssessment;
  assessmentVisible: boolean;
  beginTerminal: (terminal: string) => void;
  finishTerminal: (terminal: string) => void;
  cancelConnection: () => void;
  setWireKind: (kind: WireKind) => void;
  setWireStyle: (style: WireStyle) => void;
  updateSelectedWire: (changes: { color?: string; style?: WireStyle }) => void;
  selectWire: (wireId: string | null) => void;
  deleteSelectedWire: () => void;
  clearWires: () => void;
  resetBoard: () => void;
  addInstance: (assetId: string, x?: number, z?: number) => void;
  beginMoveInstance: (instanceId: string) => void;
  moveInstance: (instanceId: string, x: number, z: number) => void;
  finishMoveInstance: (instanceId: string) => void;
  toggleBreaker: (instanceId: string) => void;
  pressPushbutton: (instanceId: string) => void;
  releasePushbutton: (instanceId: string) => void;
  confirmPowerOn: () => void;
  switchPowerOff: () => void;
  resetProtection: () => void;
  tripOverload: () => void;
  resetOverload: () => void;
  checkWiring: () => void;
  syncRuntime: () => void;
  undo: () => void;
  redo: () => void;
  hydrateScene: (scene: PersistedWiringScene) => void;
};

const runtimeResult = (
  state: Pick<WiringSceneState, "instances" | "wires" | "powerState" | "overloadTripped" | "contactorEngaged">,
  overrides: Partial<{ powerEnabled: boolean; overloadTripped: boolean; contactorEngaged: boolean }> = {},
) => analyzeSceneDol(state.instances, state.wires, {
  powerEnabled: overrides.powerEnabled ?? state.powerState === "energized",
  overloadTripped: overrides.overloadTripped ?? state.overloadTripped,
  contactorEngaged: overrides.contactorEngaged ?? state.contactorEngaged,
});

const analysisPatch = (analysis: DolCircuitAnalysis) => ({
  contactorEngaged: analysis.contactorEngaged,
  motorRunning: analysis.motorRunning,
  protectiveEarthConnected: analysis.protectiveEarthConnected,
  phaseAtMotor: analysis.phaseAtMotor,
  dangers: analysis.dangers,
  warnings: analysis.warnings,
});

const initialAnalysis = analyzeSceneDol(initialDeviceInstances, [], {
  powerEnabled: false,
  overloadTripped: false,
  contactorEngaged: false,
});

const uniqueReference = (instances: DeviceInstance[], assetId: string) => {
  const prefix = getAsset(assetId).referencePrefix;
  const used = new Set(instances.map((item) => item.reference));
  let number = 1;
  while (used.has(`${prefix}${number}`)) number += 1;
  return `${prefix}${number}`;
};

export const useWiringSceneStore = create<WiringSceneState>((set) => ({
  instances: cloneInstances(),
  wires: [],
  wireKind: "main",
  wireStyle: DEFAULT_WIRE_STYLE,
  pendingTerminal: null,
  selectedWireId: null,
  movingInstanceId: null,
  movingOrigin: null,
  past: [],
  future: [],
  message: "拖动器件调整位置；从一个螺丝拖到另一个螺丝完成接线。",
  powerState: "off",
  contactorEngaged: false,
  motorRunning: false,
  overloadTripped: false,
  protectiveEarthConnected: initialAnalysis.protectiveEarthConnected,
  phaseAtMotor: initialAnalysis.phaseAtMotor,
  dangers: initialAnalysis.dangers,
  warnings: initialAnalysis.warnings,
  wiringAssessment: assessSceneDolWiring(initialDeviceInstances, []),
  assessmentVisible: false,

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
      color: getTerminalColor(source.terminal),
      style: state.wireStyle,
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
  setWireStyle: (wireStyle) => set({ wireStyle }),
  updateSelectedWire: (changes) => set((state) => {
    const wire = state.wires.find((item) => item.id === state.selectedWireId);
    if (!wire) return {};
    const color = changes.color === undefined ? wire.color : normalizeWireColor(changes.color);
    const style = changes.style ?? wire.style;
    if ((changes.color !== undefined && !color) || (style !== undefined && !["straight", "curve"].includes(style))) return {};
    if (color === wire.color && style === wire.style) return {};
    return {
      past: appendPast(state),
      future: [],
      wires: state.wires.map((item) => item.id === wire.id ? { ...item, color, style } : item),
      message: "所选导线外观已更新，端子连接关系保持不变；可撤回本次修改",
    };
  }),
  selectWire: (selectedWireId) => set((state) => {
    if (!selectedWireId) return { selectedWireId: null };
    const wire = state.wires.find((item) => item.id === selectedWireId);
    if (!wire) return { selectedWireId: null };
    const from = resolveTerminal(state.instances, wire.from);
    const to = resolveTerminal(state.instances, wire.to);
    return {
      selectedWireId,
      message: `已选择 ${from.electricalId} → ${to.electricalId}；可修改线色、线形或拆除`,
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
    powerState: "off",
    contactorEngaged: false,
    motorRunning: false,
    overloadTripped: false,
    dangers: [],
    warnings: initialAnalysis.warnings,
    phaseAtMotor: initialAnalysis.phaseAtMotor,
    protectiveEarthConnected: initialAnalysis.protectiveEarthConnected,
    wiringAssessment: assessSceneDolWiring(initialDeviceInstances, []),
    assessmentVisible: false,
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
    const positionY = 0.2;
    const reference = uniqueReference(state.instances, assetId);
    const instance: DeviceInstance = {
      id: `instance-${reference.toLowerCase()}-${Date.now()}`,
      assetId,
      reference,
      position: [x, positionY, rail],
      rotationY: 0,
      operatingState: asset.interaction?.defaultState,
    };
    return {
      past: appendPast(state),
      future: [],
      instances: [...state.instances, instance],
      message: automatic
        ? `${reference} 已放到最近空位，可继续拖动调整`
        : asset.mounting.type === "din-rail"
          ? `${reference} ${asset.name} 已按落点吸附到 35 mm DIN 导轨`
          : `${reference} ${asset.name} 已按螺钉安装方式放到安装板`,
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

  toggleBreaker: (instanceId) => set((state) => {
    const instance = state.instances.find((item) => item.id === instanceId);
    if (!instance) return {};
    const asset = getAsset(instance.assetId);
    if (asset.interaction?.kind !== "breaker-toggle") return {};
    const current = instance.operatingState ?? asset.interaction.defaultState;
    const operatingState = current === "closed" ? "open" : "closed";
    return {
      past: appendPast(state),
      future: [],
      instances: state.instances.map((item) => item.id === instanceId ? { ...item, operatingState } : item),
      message: operatingState === "closed"
        ? `${instance.reference} 已闭合（ON）；再次单击可断开`
        : `${instance.reference} 已断开（OFF）；再次单击可闭合`,
    };
  }),

  pressPushbutton: (instanceId) => set((state) => {
    const instance = state.instances.find((item) => item.id === instanceId);
    if (!instance) return {};
    const asset = getAsset(instance.assetId);
    if (asset.interaction?.kind !== "momentary-pushbutton") return {};
    const operatingState = asset.interaction.action === "start" ? "start-pressed" : "stop-pressed";
    return {
      instances: state.instances.map((item) => item.id === instanceId ? { ...item, operatingState } : item),
      message: `${instance.reference} ${asset.interaction.action === "start" ? "启动" : "停止"}按钮已按下`,
    };
  }),

  releasePushbutton: (instanceId) => set((state) => {
    const instance = state.instances.find((item) => item.id === instanceId);
    if (!instance) return {};
    const asset = getAsset(instance.assetId);
    if (asset.interaction?.kind !== "momentary-pushbutton") return {};
    return {
      instances: state.instances.map((item) => item.id === instanceId ? { ...item, operatingState: "idle" } : item),
      message: `${instance.reference} ${asset.interaction.action === "start" ? "启动" : "停止"}按钮已释放`,
    };
  }),

  confirmPowerOn: () => set((state) => {
    if (state.powerState === "tripped") return { message: "保护尚未复位；请排除故障并点击“复位保护”后再开始仿真" };
    const analysis = runtimeResult(state, { powerEnabled: true });
    if (analysis.dangers.length) {
      return {
        ...analysisPatch(analysis),
        powerState: "tripped",
        contactorEngaged: false,
        motorRunning: false,
        message: `保护跳闸：${analysis.dangers.join("；")}`,
      };
    }
    return {
      ...analysisPatch(analysis),
      powerState: "energized",
      message: analysis.warnings[0] ?? "供电已允许；可操作 QF1、SB2 和 SB1 验证直接启动回路",
    };
  }),
  switchPowerOff: () => set({
    powerState: "off",
    contactorEngaged: false,
    motorRunning: false,
    message: "训练电源已切断；接线仍可继续修改",
  }),
  resetProtection: () => set((state) => {
    const analysis = runtimeResult(state, { powerEnabled: false, contactorEngaged: false });
    if (analysis.dangers.length) {
      return {
        ...analysisPatch(analysis),
        powerState: "tripped",
        contactorEngaged: false,
        motorRunning: false,
        message: `危险接线尚未排除，不能复位：${analysis.dangers.join("；")}`,
      };
    }
    return {
      ...analysisPatch(analysis),
      powerState: "off",
      contactorEngaged: false,
      motorRunning: false,
      message: "保护已复位，训练电源保持断开；重新申请上电后继续",
    };
  }),
  tripOverload: () => set((state) => {
    const analysis = runtimeResult(state, { overloadTripped: true, contactorEngaged: false });
    return {
      ...analysisPatch(analysis),
      overloadTripped: true,
      contactorEngaged: false,
      motorRunning: false,
      message: "FR1 教学过载测试已动作：95-96 断开、97-98 闭合，KM1 与 M1 已停止",
    };
  }),
  resetOverload: () => set((state) => {
    const analysis = runtimeResult(state, { overloadTripped: false, contactorEngaged: false });
    return {
      ...analysisPatch(analysis),
      dangers: state.powerState === "tripped" ? [...new Set([...state.dangers, ...analysis.dangers])] : analysis.dangers,
      overloadTripped: false,
      contactorEngaged: false,
      motorRunning: false,
      message: "FR1 已执行 RESET：95-96 恢复闭合，需重新按下 SB2 才能启动",
    };
  }),
  checkWiring: () => set((state) => {
    const wiringAssessment = assessSceneDolWiring(state.instances, state.wires);
    return {
      wiringAssessment,
      assessmentVisible: true,
      message: wiringAssessment.correct
        ? "标准答案检查通过：主回路、控制回路和自锁支路均正确"
        : `标准答案进度 ${wiringAssessment.completed}/${wiringAssessment.total}；这不影响安全接线申请上电`,
    };
  }),
  syncRuntime: () => set((state) => {
    const analysis = runtimeResult(state);
    const dangerousWhilePowered = state.powerState === "energized" && analysis.dangers.length > 0;
    let message = state.message;
    if (dangerousWhilePowered) message = `保护立即跳闸：${analysis.dangers.join("；")}`;
    else if (!state.motorRunning && analysis.motorRunning) message = "KM1 已吸合，M1 三相电机运行；松开 SB2 验证自锁";
    else if (state.motorRunning && !analysis.motorRunning) message = "KM1 已释放，M1 三相电机停止";
    else if (!state.contactorEngaged && analysis.contactorEngaged) message = "KM1 线圈已得电，主触点与 13-14 辅助触点闭合";
    const wiringAssessment = state.assessmentVisible
      ? assessSceneDolWiring(state.instances, state.wires)
      : state.wiringAssessment;
    return {
      ...analysisPatch(analysis),
      powerState: dangerousWhilePowered ? "tripped" : state.powerState,
      dangers: state.powerState === "tripped" ? [...new Set([...state.dangers, ...analysis.dangers])] : analysis.dangers,
      contactorEngaged: dangerousWhilePowered ? false : analysis.contactorEngaged,
      motorRunning: dangerousWhilePowered ? false : analysis.motorRunning,
      wiringAssessment,
      message,
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
    wireStyle: scene.wireStyle === "straight" ? "straight" : DEFAULT_WIRE_STYLE,
    past: scene.past.map(cloneSnapshot).slice(-HISTORY_LIMIT),
    future: scene.future.map(cloneSnapshot).slice(-HISTORY_LIMIT),
    pendingTerminal: null,
    selectedWireId: null,
    movingInstanceId: null,
    movingOrigin: null,
    powerState: "off",
    contactorEngaged: false,
    motorRunning: false,
    overloadTripped: false,
    dangers: [],
    warnings: initialAnalysis.warnings,
    phaseAtMotor: initialAnalysis.phaseAtMotor,
    protectiveEarthConnected: initialAnalysis.protectiveEarthConnected,
    wiringAssessment: assessSceneDolWiring(scene.instances, scene.wires),
    assessmentVisible: false,
    message: "已恢复上次保存的接线现场",
  }),
}));
