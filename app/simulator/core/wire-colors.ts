import { getDefinition } from "./catalog";
import { terminalKey } from "./types";
import type { CircuitDocument, TerminalRef } from "./types";

export const SOURCE_WIRE_COLORS: Readonly<Record<string, string>> = { L1: "#e7b000", L2: "#20b963", L3: "#f04452", N: "#3478f6", PE: "#659f2f" };
const normalizeColor = (color: string) => {
  const value = color.toLowerCase();
  return /^#[\da-f]{3}$/.test(value) ? `#${[...value.slice(1)].map(character => character + character).join("")}` : value;
};
const unique = (values: string[]) => [...new Set(values)].sort();

export type WireColorGroup = {
  id: string;
  terminalIds: string[];
  wireIds: string[];
  colors: string[];
  sourcePotentials: string[];
  sourceColors: string[];
};

/** Only conductors and permanent internal bridges share a color. A closed
 * switch, coil or winding never becomes a color bridge. No runtime is read. */
export function getWireColorGroups(document: CircuitDocument): WireColorGroup[] {
  const parent = new Map<string, string>();
  const add = (id: string) => { if (!parent.has(id)) parent.set(id, id); };
  const root = (id: string): string => {
    add(id);
    let value = id;
    while (parent.get(value) !== value) value = parent.get(value)!;
    let current = id;
    while (parent.get(current) !== current) { const next = parent.get(current)!; parent.set(current, value); current = next; }
    return value;
  };
  const join = (a: string, b: string) => { const first = root(a), second = root(b); if (first !== second) parent.set(second, first); };
  const sources = new Map<string, string>();
  for (const component of document.components) {
    const definition = getDefinition(component.type);
    for (const terminal of definition.terminals) {
      const id = terminalKey({ componentId: component.id, terminalId: terminal.id });
      add(id);
      if (component.type === "supply" && SOURCE_WIRE_COLORS[terminal.id]) sources.set(id, terminal.id);
    }
    for (const [a, b] of definition.fixedConnections ?? []) join(`${component.id}::${a}`, `${component.id}::${b}`);
  }
  for (const wire of document.wires) join(terminalKey(wire.from), terminalKey(wire.to));
  const groups = new Map<string, WireColorGroup>();
  for (const id of parent.keys()) {
    const key = root(id);
    let group = groups.get(key);
    if (!group) { group = { id: key, terminalIds: [], wireIds: [], colors: [], sourcePotentials: [], sourceColors: [] }; groups.set(key, group); }
    group.terminalIds.push(id);
    const potential = sources.get(id);
    if (potential) { group.sourcePotentials.push(potential); group.sourceColors.push(SOURCE_WIRE_COLORS[potential]); }
  }
  for (const wire of document.wires) { const group = groups.get(root(terminalKey(wire.from)))!; group.wireIds.push(wire.id); group.colors.push(normalizeColor(wire.color)); }
  return [...groups.values()].map(group => ({ ...group, id: group.terminalIds.sort()[0], wireIds: group.wireIds.sort(), colors: unique(group.colors), sourcePotentials: unique(group.sourcePotentials), sourceColors: unique(group.sourceColors) })).sort((a, b) => a.id.localeCompare(b.id));
}

export type ConnectionColor = { color: string; conflict: boolean; sourceConflict: boolean };
export function resolveConnectionColor(document: CircuitDocument, from: TerminalRef, to?: TerminalRef, fallback = "#56616f"): ConnectionColor {
  const keys = [terminalKey(from), ...(to ? [terminalKey(to)] : [])];
  const groups = getWireColorGroups(document).filter(group => keys.some(key => group.terminalIds.includes(key)));
  const colors = unique(groups.flatMap(group => group.colors));
  const sourceColors = unique(groups.flatMap(group => group.sourceColors));
  return { color: colors.length === 1 ? colors[0] : !colors.length && sourceColors.length === 1 ? sourceColors[0] : normalizeColor(fallback), conflict: colors.length > 1, sourceConflict: sourceColors.length > 1 };
}

/** A conflicted group keeps its saved wire colors; its terminal stays neutral. */
export function getConnectedTerminalColor(document: CircuitDocument, ref: TerminalRef, fallback = "#56616f"): string {
  const result = resolveConnectionColor(document, ref, undefined, fallback);
  return result.conflict || result.sourceConflict ? fallback : result.color;
}

/** The caller commits this single document change as one undoable action. */
export function setWireGroupColor(document: CircuitDocument, wireIds: readonly string[], color: string): CircuitDocument {
  if (!/^#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?$/i.test(color)) throw new Error("导线颜色须为十六进制颜色");
  const selected = new Set(wireIds);
  const affected = new Set(getWireColorGroups(document).filter(group => group.wireIds.some(id => selected.has(id))).flatMap(group => group.wireIds));
  const nextColor = normalizeColor(color);
  if (!document.wires.some(wire => affected.has(wire.id) && wire.color !== nextColor)) return document;
  return { ...document, wires: document.wires.map(wire => affected.has(wire.id) ? { ...wire, color: nextColor } : wire) };
}

/** Applied only while creating new demonstrations, never while loading a saved
 * document. Stable IDs make the fallback independent of component/wire order. */
export function normalizeDemonstrationWireColors(document: CircuitDocument): CircuitDocument {
  const wires = new Map(document.wires.map(wire => [wire.id, wire]));
  const colors = new Map<string, string>();
  for (const group of getWireColorGroups(document)) {
    if (!group.wireIds.length || group.sourceColors.length > 1) continue;
    const first = [...group.wireIds].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))[0];
    const color = group.sourceColors[0] ?? normalizeColor(wires.get(first)!.color);
    for (const id of group.wireIds) colors.set(id, color);
  }
  return { ...document, wires: document.wires.map(wire => ({ ...wire, color: colors.get(wire.id) ?? wire.color })) };
}
