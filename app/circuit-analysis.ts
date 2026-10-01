export type CircuitWire = { from: string; to: string; kind?: "main" | "control" | "earth" };

export type CircuitAnalysis = {
  energized: boolean;
  motorRunning: boolean;
  contactorEngaged: boolean;
  dangers: string[];
};

const phases = ["XT-L1", "XT-L2", "XT-L3"] as const;

const terminalBlockConductive: Array<[string, string]> = [
  ["XT-L1", "XT-L1-B"], ["XT-L2", "XT-L2-B"], ["XT-L3", "XT-L3-B"],
  ["XT-U", "XT-U-B"], ["XT-V", "XT-V-B"], ["XT-W", "XT-W-B"],
];

const alwaysConductive: Array<[string, string]> = [
  ...terminalBlockConductive,
  ["QF-L1", "QF-U11"], ["QF-L2", "QF-V11"], ["QF-L3", "QF-W11"],
  ["FU1-U11", "FU1-U21"], ["FU1-V11", "FU1-V21"], ["FU1-W11", "FU1-W21"],
  ["FU2-1", "FU2-2"],
  ["FR-U31", "FR-U"], ["FR-V31", "FR-V"], ["FR-W31", "FR-W"],
  ["FR-95", "FR-96"],
  ["SB1-11", "SB1-12"],
];

const contactorConductive: Array<[string, string]> = [
  ["KM-U21", "KM-U31"], ["KM-V21", "KM-V31"], ["KM-W21", "KM-W31"],
  ["KM-13", "KM-14"],
];

const bypassChecks: Array<{ from: string; to: string; label: string }> = [
  { from: "QF-L1", to: "QF-U11", label: "QF L1 极被短接" },
  { from: "QF-L2", to: "QF-V11", label: "QF L2 极被短接" },
  { from: "QF-L3", to: "QF-W11", label: "QF L3 极被短接" },
  { from: "FU1-U11", to: "FU1-U21", label: "FU1 U 相熔断器被短接" },
  { from: "FU1-V11", to: "FU1-V21", label: "FU1 V 相熔断器被短接" },
  { from: "FU1-W11", to: "FU1-W21", label: "FU1 W 相熔断器被短接" },
  { from: "FU2-1", to: "FU2-2", label: "FU2 控制熔断器被短接" },
  { from: "FR-U31", to: "FR-U", label: "FR U 相保护被短接" },
  { from: "FR-V31", to: "FR-V", label: "FR V 相保护被短接" },
  { from: "FR-W31", to: "FR-W", label: "FR W 相保护被短接" },
  { from: "FR-95", to: "FR-96", label: "FR 过载常闭触点被短接" },
  { from: "SB1-11", to: "SB1-12", label: "SB1 停止按钮被短接" },
  { from: "SB2-13", to: "SB2-14", label: "SB2 启动按钮被永久短接" },
  { from: "KM-A1", to: "KM-A2", label: "KM 线圈被短接" },
  { from: "KM-U21", to: "KM-U31", label: "KM U 相主触点被短接" },
  { from: "KM-V21", to: "KM-V31", label: "KM V 相主触点被短接" },
  { from: "KM-W21", to: "KM-W31", label: "KM W 相主触点被短接" },
];

class Connections {
  private parent = new Map<string, string>();

  private root(id: string): string {
    if (!this.parent.has(id)) this.parent.set(id, id);
    const parent = this.parent.get(id)!;
    if (parent === id) return id;
    const root = this.root(parent);
    this.parent.set(id, root);
    return root;
  }

  connect(a: string, b: string) {
    const rootA = this.root(a);
    const rootB = this.root(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }

  connected(a: string, b: string) {
    return this.root(a) === this.root(b);
  }
}

const buildConnections = (wires: CircuitWire[], internal: Array<[string, string]> = []) => {
  const graph = new Connections();
  wires.forEach(({ from, to }) => graph.connect(from, to));
  internal.forEach(([from, to]) => graph.connect(from, to));
  return graph;
};

const phaseName = (terminal: string) => terminal.replace("XT-", "");

const findSourceAt = (graph: Connections, terminal: string) =>
  phases.filter((phase) => graph.connected(terminal, phase));

const findElectricalDangers = (graph: Connections) => {
  const dangers: string[] = [];
  for (let index = 0; index < phases.length; index += 1) {
    for (let other = index + 1; other < phases.length; other += 1) {
      if (graph.connected(phases[index], phases[other])) {
        dangers.push(`${phaseName(phases[index])} 与 ${phaseName(phases[other])} 相间短路`);
      }
    }
    if (graph.connected(phases[index], "XT-PE") || graph.connected(phases[index], "M-PE")) {
      dangers.push(`${phaseName(phases[index])} 对保护地短路`);
    }
  }
  return dangers;
};

export function analyzeCircuit(wires: CircuitWire[]): CircuitAnalysis {
  const wireOnly = buildConnections(wires);
  const bypasses = bypassChecks
    .filter(({ from, to }) => wireOnly.connected(from, to))
    .map(({ label }) => label);

  // 上电检查包含一次“启动”动作，因此将 SB2 的瞬时闭合纳入控制回路判断。
  const beforeContactor = buildConnections(wires, [...alwaysConductive, ["SB2-13", "SB2-14"]]);
  const a1Sources = findSourceAt(beforeContactor, "KM-A1");
  const a2Sources = findSourceAt(beforeContactor, "KM-A2");
  const contactorEngaged = a1Sources.some((a1) => a2Sources.some((a2) => a1 !== a2));

  const activeInternal = contactorEngaged
    ? [...alwaysConductive, ["SB2-13", "SB2-14"] as [string, string], ...contactorConductive]
    : [...alwaysConductive, ["SB2-13", "SB2-14"] as [string, string]];
  const poweredCircuit = buildConnections(wires, activeInternal);
  const dangers = [...new Set([...findElectricalDangers(poweredCircuit), ...bypasses])];
  const motorSources = ["M-U", "M-V", "M-W"].map((terminal) => findSourceAt(poweredCircuit, terminal));
  const motorHasThreeDistinctPhases = motorSources.every((sources) => sources.length === 1)
    && new Set(motorSources.flat()).size === phases.length;

  return {
    energized: dangers.length === 0,
    contactorEngaged: dangers.length === 0 && contactorEngaged,
    motorRunning: dangers.length === 0 && contactorEngaged && motorHasThreeDistinctPhases,
    dangers,
  };
}

export type ContactPair = [string, string];

export type DolCircuitModel = {
  wires: CircuitWire[];
  fixedConnections: ContactPair[];
  additionalContacts?: ContactPair[];
  phaseSources: [string, string, string];
  protectiveEarthSource: string;
  powerEnabled: boolean;
  breaker: { closed: boolean; contacts: ContactPair[] };
  startButton: { pressed: boolean; contact: ContactPair };
  stopButton: { pressed: boolean; contact: ContactPair };
  overload: { tripped: boolean; ncContact: ContactPair; noContact: ContactPair };
  contactor: {
    previouslyEngaged: boolean;
    coil: ContactPair;
    mainContacts: ContactPair[];
    auxiliaryNO: ContactPair[];
  };
  motor: { phases: [string, string, string]; protectiveEarth: string };
  protectedContacts: Array<{ contact: ContactPair; label: string }>;
};

export type DolCircuitAnalysis = {
  powerAvailable: boolean;
  contactorEngaged: boolean;
  motorRunning: boolean;
  protectiveEarthConnected: boolean;
  phaseAtMotor: string[];
  dangers: string[];
  warnings: string[];
};

const phaseLabels = ["L1", "L2", "L3"] as const;

const buildDolConnections = (model: DolCircuitModel, contacts: ContactPair[] = []) => (
  buildConnections(model.wires, [...model.fixedConnections, ...contacts])
);

const sourcesAt = (graph: Connections, terminal: string, sources: [string, string, string]) => (
  sources.filter((source) => graph.connected(terminal, source))
);

const findDolSourceDangers = (model: DolCircuitModel, graph: Connections) => {
  const dangers: string[] = [];

  for (let index = 0; index < model.phaseSources.length; index += 1) {
    for (let other = index + 1; other < model.phaseSources.length; other += 1) {
      if (graph.connected(model.phaseSources[index], model.phaseSources[other])) {
        dangers.push(`${phaseLabels[index]} 与 ${phaseLabels[other]} 相间短路`);
      }
    }
    if (graph.connected(model.phaseSources[index], model.protectiveEarthSource)
      || graph.connected(model.phaseSources[index], model.motor.protectiveEarth)) {
      dangers.push(`${phaseLabels[index]} 对保护地短路`);
    }
  }

  return dangers;
};

export function analyzeDolCircuit(model: DolCircuitModel): DolCircuitAnalysis {
  const wiringOnly = buildDolConnections(model);
  // 旁路必须在排除器件正常内部触点后检查，避免把正常闭合误报为短接。
  const bypasses = model.protectedContacts
    .filter(({ contact }) => wiringOnly.connected(contact[0], contact[1]))
    .map(({ label }) => label);
  const controlContacts: ContactPair[] = [
    ...(model.additionalContacts ?? []),
    ...(model.breaker.closed ? model.breaker.contacts : []),
    ...(!model.stopButton.pressed ? [model.stopButton.contact] : []),
    ...(model.startButton.pressed ? [model.startButton.contact] : []),
    ...(!model.overload.tripped ? [model.overload.ncContact] : [model.overload.noContact]),
  ];
  const contactorContacts = [
    ...model.contactor.mainContacts,
    ...model.contactor.auxiliaryNO,
  ];
  const controlGraph = buildDolConnections(model, [
    ...controlContacts,
    ...(model.contactor.previouslyEngaged ? contactorContacts : []),
  ]);
  const coilA = sourcesAt(controlGraph, model.contactor.coil[0], model.phaseSources);
  const coilB = sourcesAt(controlGraph, model.contactor.coil[1], model.phaseSources);
  // 已确认的 380V 线圈必须跨两个独立相线；同相、悬空或短路不能吸合。
  const coilPowered = coilA.length === 1 && coilB.length === 1 && coilA[0] !== coilB[0];
  const wouldEngage = model.powerEnabled && model.breaker.closed && !model.overload.tripped && coilPowered;
  const powerGraph = buildDolConnections(model, [
    ...controlContacts,
    ...(wouldEngage ? contactorContacts : []),
  ]);
  // 合闸、按下按钮和吸合都会引入新的通路，不能只检查裸导线。
  const dangers = [...new Set([
    ...bypasses,
    ...findDolSourceDangers(model, wiringOnly),
    ...findDolSourceDangers(model, controlGraph),
    ...findDolSourceDangers(model, powerGraph),
  ])];
  const powerAvailable = model.powerEnabled && dangers.length === 0;
  const contactorEngaged = powerAvailable && wouldEngage;
  const motorSources = model.motor.phases.map((terminal) => sourcesAt(powerGraph, terminal, model.phaseSources));
  const phaseAtMotor = motorSources.map((found) => powerAvailable && found.length === 1
    ? phaseLabels[model.phaseSources.indexOf(found[0])]
    : "-");
  const motorHasThreeDistinctPhases = motorSources.every((found) => found.length === 1)
    && new Set(motorSources.flat()).size === model.phaseSources.length;
  const protectiveEarthConnected = powerGraph.connected(
    model.motor.protectiveEarth,
    model.protectiveEarthSource,
  );
  const warnings: string[] = [];
  if (!protectiveEarthConnected) warnings.push("M1 保护接地未接通");
  if (model.overload.tripped) warnings.push("FR1 已动作：95-96 断开，复位前禁止再次启动");
  if (model.powerEnabled && !model.breaker.closed) warnings.push("供电已允许，但 QF1 尚未合闸");
  if (powerAvailable && model.breaker.closed && model.startButton.pressed && !coilPowered) {
    warnings.push("KM1 线圈未获得两相 380V：检查停止、过载保护、启动支路与 A1/A2 接线");
  }
  if (contactorEngaged && !motorHasThreeDistinctPhases) {
    warnings.push("M1 未获得完整三相电源：检查 QF1、KM1/FR1 与 X2 的主回路接线");
  }

  return {
    powerAvailable,
    contactorEngaged,
    motorRunning: powerAvailable && contactorEngaged && motorHasThreeDistinctPhases,
    protectiveEarthConnected,
    phaseAtMotor,
    dangers,
    warnings,
  };
}

export type DolStandardConnection = CircuitWire & { kind: "main" | "control" | "earth" };

export const DOL_STANDARD_CONNECTIONS: DolStandardConnection[] = [
  { from: "X1-L1B", to: "QF1-1", kind: "main" },
  { from: "X1-L2B", to: "QF1-3", kind: "main" },
  { from: "X1-L3B", to: "QF1-5", kind: "main" },
  { from: "QF1-2", to: "KM1-1", kind: "main" },
  { from: "QF1-4", to: "KM1-3", kind: "main" },
  { from: "QF1-6", to: "KM1-5", kind: "main" },
  { from: "KM1-T1", to: "X2-L1A", kind: "main" },
  { from: "KM1-T2", to: "X2-L2A", kind: "main" },
  { from: "KM1-T3", to: "X2-L3A", kind: "main" },
  { from: "QF1-2", to: "SB1-11", kind: "control" },
  { from: "SB1-12", to: "KM1-95", kind: "control" },
  { from: "KM1-96", to: "SB2-13", kind: "control" },
  { from: "SB2-14", to: "KM1-A1", kind: "control" },
  { from: "KM1-A2", to: "QF1-4", kind: "control" },
  { from: "KM1-13", to: "SB2-13", kind: "control" },
  { from: "KM1-14", to: "SB2-14", kind: "control" },
];

export type DolWiringAssessment = {
  correct: boolean;
  completed: number;
  total: number;
  missing: DolStandardConnection[];
  unexpected: CircuitWire[];
  wrongKinds: CircuitWire[];
};

const connectionKey = ({ from, to }: CircuitWire) => [from, to].sort().join("<->");

export function evaluateDolStandardAnswer(wires: CircuitWire[]): DolWiringAssessment {
  const standard = new Map(DOL_STANDARD_CONNECTIONS.map((wire) => [connectionKey(wire), wire]));
  const submitted = new Map(wires.map((wire) => [connectionKey(wire), wire]));
  const missing = DOL_STANDARD_CONNECTIONS.filter((wire) => !submitted.has(connectionKey(wire)));
  const unexpected = wires.filter((wire) => !standard.has(connectionKey(wire)));
  const wrongKinds = wires.filter((wire) => {
    const expected = standard.get(connectionKey(wire));
    return expected !== undefined && wire.kind !== expected.kind;
  });
  const completed = DOL_STANDARD_CONNECTIONS.length - missing.length - wrongKinds.length;
  return {
    correct: missing.length === 0 && unexpected.length === 0 && wrongKinds.length === 0,
    completed,
    total: DOL_STANDARD_CONNECTIONS.length,
    missing,
    unexpected,
    wrongKinds,
  };
}
