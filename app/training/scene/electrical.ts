import {
  analyzeDolCircuit,
  evaluateDolStandardAnswer,
  type ContactPair,
  type DolCircuitAnalysis,
  type DolCircuitModel,
  type DolWiringAssessment,
} from "../../circuit-analysis";
import { getAsset, resolveTerminal } from "./catalog";
import type { DeviceInstance, SceneWire } from "./types";

type DolSceneRuntime = {
  powerEnabled: boolean;
  overloadTripped: boolean;
  contactorEngaged: boolean;
};

const findInstance = (instances: DeviceInstance[], reference: string) => {
  const instance = instances.find((item) => item.reference === reference);
  if (!instance) throw new Error(`DOL 模板缺少器件 ${reference}`);
  return instance;
};

const electricalTerminal = (instances: DeviceInstance[], reference: string, terminalKey: string) => {
  const instance = findInstance(instances, reference);
  return resolveTerminal(instances, `${instance.id}::${terminalKey}`).electricalId;
};

const electricalPair = (
  instances: DeviceInstance[],
  reference: string,
  pair: [string, string],
): ContactPair => [
  electricalTerminal(instances, reference, pair[0]),
  electricalTerminal(instances, reference, pair[1]),
];

const fixedConnections = (instances: DeviceInstance[]) => instances.flatMap((instance) => {
  const groups = new Map<string, string[]>();
  for (const terminal of getAsset(instance.assetId).terminals) {
    if (!terminal.internalGroup) continue;
    const members = groups.get(terminal.internalGroup) ?? [];
    members.push(`${instance.reference}-${terminal.key}`);
    groups.set(terminal.internalGroup, members);
  }
  return [...groups.values()].flatMap((members) => members.slice(1).map<ContactPair>((member) => [members[0], member]));
});

export const projectSceneWires = (instances: DeviceInstance[], wires: SceneWire[]) => wires.map((wire) => ({
  from: resolveTerminal(instances, wire.from).electricalId,
  to: resolveTerminal(instances, wire.to).electricalId,
  kind: wire.kind,
}));

export function createDolCircuitModel(
  instances: DeviceInstance[],
  wires: SceneWire[],
  runtime: DolSceneRuntime,
): DolCircuitModel {
  const breaker = findInstance(instances, "QF1");
  const breakerAsset = getAsset(breaker.assetId);
  if (breakerAsset.interaction?.kind !== "breaker-toggle") throw new Error("QF1 不是可操作的三极断路器");

  const startButton = findInstance(instances, "SB2");
  const startAsset = getAsset(startButton.assetId);
  if (startAsset.interaction?.kind !== "momentary-pushbutton" || startAsset.interaction.action !== "start") {
    throw new Error("SB2 不是常开启动按钮");
  }

  const stopButton = findInstance(instances, "SB1");
  const stopAsset = getAsset(stopButton.assetId);
  if (stopAsset.interaction?.kind !== "momentary-pushbutton" || stopAsset.interaction.action !== "stop") {
    throw new Error("SB1 不是常闭停止按钮");
  }

  const starter = findInstance(instances, "KM1");
  const starterAsset = getAsset(starter.assetId);
  if (!starterAsset.electrical) throw new Error("KM1/FR1 缺少电气触点契约");
  const starterElectrical = starterAsset.electrical;
  if (starterElectrical.coil.ratedVoltageV !== 380) {
    throw new Error("当前 DOL 控制回路要求 KM1 使用已确认的 380V 线圈");
  }
  const breakerContacts = breakerAsset.interaction.contactPairs.map((pair) => electricalPair(instances, "QF1", pair));
  const mainContacts = starterElectrical.mainContacts.map((pair) => electricalPair(instances, "KM1", pair));
  const auxiliaryNO = starterElectrical.auxiliaryNO.map((pair) => electricalPair(instances, "KM1", pair));
  const stopContact = electricalPair(instances, "SB1", stopAsset.interaction.contactPair);
  const startContact = electricalPair(instances, "SB2", startAsset.interaction.contactPair);
  const overloadNC = electricalPair(instances, "KM1", starterElectrical.overload.ncPair);
  const overloadNO = electricalPair(instances, "KM1", starterElectrical.overload.noPair);
  const coil = electricalPair(instances, "KM1", starterElectrical.coil.pair);
  const additionalContacts: ContactPair[] = [];
  const additionalProtectedContacts: DolCircuitModel["protectedContacts"] = [];
  for (const instance of instances) {
    if (["QF1", "SB1", "SB2"].includes(instance.reference)) continue;
    const interaction = getAsset(instance.assetId).interaction;
    if (interaction?.kind === "breaker-toggle") {
      const contacts = interaction.contactPairs.map((pair) => electricalPair(instances, instance.reference, pair));
      if ((instance.operatingState ?? interaction.defaultState) === "closed") additionalContacts.push(...contacts);
      additionalProtectedContacts.push(...contacts.map((contact, index) => ({ contact, label: `${instance.reference} 第 ${index + 1} 极被短接` })));
    } else if (interaction?.kind === "momentary-pushbutton") {
      const contact = electricalPair(instances, instance.reference, interaction.contactPair);
      const pressed = instance.operatingState === (interaction.action === "start" ? "start-pressed" : "stop-pressed");
      if (interaction.contactType === "NO" ? pressed : !pressed) additionalContacts.push(contact);
      additionalProtectedContacts.push({ contact, label: `${instance.reference} 按钮触点被永久短接` });
    }
  }

  return {
    wires: projectSceneWires(instances, wires),
    fixedConnections: fixedConnections(instances),
    additionalContacts,
    phaseSources: [
      electricalTerminal(instances, "X1", "L1A"),
      electricalTerminal(instances, "X1", "L2A"),
      electricalTerminal(instances, "X1", "L3A"),
    ],
    // 当前仅投影 PE1 两侧的内部导通；尚无已标定的外部电源 PE / M1 PE 接线边界。
    protectiveEarthSource: electricalTerminal(instances, "PE1", "PEA"),
    powerEnabled: runtime.powerEnabled,
    breaker: {
      closed: breaker.operatingState === "closed",
      contacts: breakerContacts,
    },
    startButton: {
      pressed: startButton.operatingState === "start-pressed",
      contact: startContact,
    },
    stopButton: {
      pressed: stopButton.operatingState === "stop-pressed",
      contact: stopContact,
    },
    overload: {
      tripped: runtime.overloadTripped,
      ncContact: overloadNC,
      noContact: overloadNO,
    },
    contactor: {
      previouslyEngaged: runtime.contactorEngaged,
      coil,
      mainContacts,
      auxiliaryNO,
    },
    motor: {
      phases: [
        electricalTerminal(instances, "X2", "L1B"),
        electricalTerminal(instances, "X2", "L2B"),
        electricalTerminal(instances, "X2", "L3B"),
      ],
      protectiveEarth: electricalTerminal(instances, "PE1", "PEB"),
    },
    protectedContacts: [
      ...breakerContacts.map((contact, index) => ({ contact, label: `QF1 第 ${index + 1} 极被短接` })),
      { contact: stopContact, label: "SB1 停止按钮被短接" },
      { contact: startContact, label: "SB2 启动按钮被永久短接" },
      { contact: overloadNC, label: "FR1 过载保护触点 95-96 被短接" },
      ...mainContacts.map((contact, index) => ({ contact, label: `KM1 第 ${index + 1} 极主触点被短接` })),
      ...auxiliaryNO.map((contact) => ({ contact, label: "KM1 自锁辅助触点 13-14 被短接" })),
      { contact: coil, label: "KM1 线圈 A1-A2 被短接" },
      ...additionalProtectedContacts,
    ],
  };
}

export function analyzeSceneDol(
  instances: DeviceInstance[],
  wires: SceneWire[],
  runtime: DolSceneRuntime,
): DolCircuitAnalysis {
  const analysis = analyzeDolCircuit(createDolCircuitModel(instances, wires, runtime));
  const unsupportedStarters = instances.filter((instance) => instance.reference !== "KM1"
    && getAsset(instance.assetId).electrical
    && wires.some((wire) => wire.from.startsWith(`${instance.id}::`) || wire.to.startsWith(`${instance.id}::`)));
  const dangers = [...analysis.dangers, ...unsupportedStarters.map((instance) => (
    `${instance.reference} 已接入导线：当前仅支持 KM1 的接触器运行仿真，请先断开额外接触器接线`
  ))];
  return {
    ...analysis,
    dangers,
    powerAvailable: analysis.powerAvailable && dangers.length === 0,
    contactorEngaged: analysis.contactorEngaged && dangers.length === 0,
    motorRunning: analysis.motorRunning && dangers.length === 0,
    phaseAtMotor: dangers.length ? ["-", "-", "-"] : analysis.phaseAtMotor,
    warnings: [...analysis.warnings, "PE1 仅验证端子内部导通；外部电源与 M1 的保护接地路径尚未验证"],
  };
}

export function assessSceneDolWiring(instances: DeviceInstance[], wires: SceneWire[]): DolWiringAssessment {
  return evaluateDolStandardAnswer(projectSceneWires(instances, wires));
}
