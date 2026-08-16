export type CircuitWire = { from: string; to: string };

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
