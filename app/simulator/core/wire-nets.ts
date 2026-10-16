import { getDefinition, isTerminalStrip } from "./catalog";
import { terminalKey } from "./types";
import type { CircuitDocument, TerminalRef } from "./types";

export type WiringNet = { id: string; terminalIds: string[]; wireIds: string[]; numbers: string[] };
export const validWireNumber = (value: unknown): value is string =>
  typeof value === "string" && value === value.trim() && [...value].length >= 1 && [...value].length <= 24 && !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value);

/** Physical wiring sections, independent of color and runtime conduction.
 * Fuse/overload channels separate wire numbers; duplicate coil terminals do not. */
export function getWiringNets(document: CircuitDocument): WiringNet[] {
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let result = id;
    while (parent.get(result) !== result) result = parent.get(result)!;
    let current = id;
    while (parent.get(current) !== current) { const next = parent.get(current)!; parent.set(current, result); current = next; }
    return result;
  };
  const join = (a: string, b: string) => { const first = root(a), second = root(b); if (first !== second) parent.set(second, first); };
  for (const component of document.components) {
    const definition = getDefinition(component.type);
    for (const terminal of definition.terminals) root(terminalKey({ componentId: component.id, terminalId: terminal.id }));
    if (component.type === "terminal" || component.type === "pe-terminal" || isTerminalStrip(component.type) || definition.load?.kind === "coil") {
      for (const [a, b] of definition.fixedConnections ?? []) join(`${component.id}::${a}`, `${component.id}::${b}`);
    }
  }
  for (const wire of document.wires) join(terminalKey(wire.from), terminalKey(wire.to));
  const groups = new Map<string, WiringNet>();
  for (const terminal of parent.keys()) {
    const id = root(terminal);
    if (!groups.has(id)) groups.set(id, { id, terminalIds: [], wireIds: [], numbers: [] });
    groups.get(id)!.terminalIds.push(terminal);
  }
  for (const wire of document.wires) {
    const group = groups.get(root(terminalKey(wire.from)))!;
    group.wireIds.push(wire.id);
    if (wire.wireNumber) group.numbers.push(wire.wireNumber);
  }
  return [...groups.values()].map(group => ({
    id: group.terminalIds.sort()[0], terminalIds: group.terminalIds,
    wireIds: group.wireIds.sort(), numbers: [...new Set(group.numbers)].sort(),
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export function connectionWireNumber(document: CircuitDocument, from: TerminalRef, to: TerminalRef) {
  const endpoints = new Set([terminalKey(from), terminalKey(to)]);
  const numbers = [...new Set(getWiringNets(document).filter(group => group.terminalIds.some(id => endpoints.has(id))).flatMap(group => group.numbers))];
  return { wireNumber: numbers.length === 1 ? numbers[0] : undefined, conflict: numbers.length > 1 };
}

/** The editor commits this change once, without adding the whole net to selection. */
export function setWiringNetNumber(document: CircuitDocument, wireId: string, input: string): CircuitDocument {
  const number = input.trim();
  if (number && !validWireNumber(number)) throw new Error("线号须为 1–24 个可打印字符，不得包含控制字符。");
  const group = getWiringNets(document).find(item => item.wireIds.includes(wireId));
  if (!group) return document;
  const ids = new Set(group.wireIds);
  if (!document.wires.some(wire => ids.has(wire.id) && wire.wireNumber !== (number || undefined))) return document;
  return { ...document, wires: document.wires.map(wire => {
    if (!ids.has(wire.id)) return wire;
    const rest = { ...wire }; delete rest.wireNumber;
    return number ? { ...rest, wireNumber: number } : rest;
  }) };
}

export type WireNumberNotice = { message: string; netIds: string[]; wireIds: string[] };
export function wireNumberNotices(nets: readonly WiringNet[]): WireNumberNotice[] {
  const notices: WireNumberNotice[] = [];
  const numbers = new Map<string, WiringNet[]>();
  for (const net of nets) {
    if (net.numbers.length > 1) notices.push({ message: `同一接线节点有多个线号：${net.numbers.join("、")}，请统一组内线号。`, netIds: [net.id], wireIds: net.wireIds });
    for (const number of net.numbers) numbers.set(number, [...(numbers.get(number) ?? []), net]);
  }
  for (const [number, groups] of numbers) if (groups.length > 1) notices.push({
    message: `线号 ${number} 用于 ${groups.length} 个不相连的接线节点，请核对。`,
    netIds: groups.map(group => group.id), wireIds: groups.flatMap(group => group.wireIds),
  });
  return notices;
}
