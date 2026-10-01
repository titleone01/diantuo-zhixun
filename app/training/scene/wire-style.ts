import type { ComponentTerminal, SceneWire, WireStyle } from "./types";

export const DEFAULT_WIRE_STYLE: WireStyle = "curve";

export const WIRE_COLOR_PRESETS = [
  { value: "#e0a400", label: "黄色" },
  { value: "#16984b", label: "绿色" },
  { value: "#dc352d", label: "红色" },
  { value: "#2580d8", label: "蓝色" },
  { value: "#4c9a2a", label: "保护地标记色" },
  { value: "#373f47", label: "黑色" },
  { value: "#8b52c7", label: "紫色" },
] as const;

const terminalColors = {
  phase1: "#e0a400",
  phase2: "#16984b",
  phase3: "#dc352d",
  neutral: "#2580d8",
  earth: "#4c9a2a",
  control: "#dc352d",
} as const;

// These are teaching markers for the catalog's named terminals, not a claim
// about the color of the manufacturer's screw, or electrical connectivity.
const colorByTerminalKey: Record<string, string> = {};
for (const key of ["L1", "L1A", "L1B", "L1-B", "T1", "U", "U-B", "U11"]) colorByTerminalKey[key] = terminalColors.phase1;
for (const key of ["L2", "L2A", "L2B", "L2-B", "T2", "V", "V-B", "V11"]) colorByTerminalKey[key] = terminalColors.phase2;
for (const key of ["L3", "L3A", "L3B", "L3-B", "T3", "W", "W-B", "W11"]) colorByTerminalKey[key] = terminalColors.phase3;
for (const key of ["N", "NA", "NB", "N-B"]) colorByTerminalKey[key] = terminalColors.neutral;
for (const key of ["PE", "PEA", "PEB", "PE-B"]) colorByTerminalKey[key] = terminalColors.earth;

export function getTerminalColor(terminal: Pick<ComponentTerminal, "key" | "label" | "internalGroup">): string {
  const knownKey = colorByTerminalKey[terminal.key.toUpperCase()];
  if (knownKey) return knownKey;
  const knownGroup = terminal.internalGroup && colorByTerminalKey[terminal.internalGroup.toUpperCase()];
  if (knownGroup) return knownGroup;

  // A numbered terminal such as 1 or 3 is only a phase terminal when its
  // catalog label explicitly supplies L1/L2/L3 or T1/T2/T3.
  const phaseLabel = terminal.label.toUpperCase().match(/(?:^|[\s/])([LT][123])(?=$|[\s/])/);
  return (phaseLabel && colorByTerminalKey[phaseLabel[1]]) || terminalColors.control;
}

export function normalizeWireColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

export function normalizeWireStyle(value: unknown): WireStyle | undefined {
  return value === "straight" || value === "curve" ? value : undefined;
}

export function getWireColor(wire: Pick<SceneWire, "color">, sourceTerminal: ComponentTerminal): string {
  return normalizeWireColor(wire.color) ?? getTerminalColor(sourceTerminal);
}
