import { getDefinition } from "./catalog";
import { createMotorCourseDocument } from "./motor-courses";
import { terminalKey } from "./types";
import type { CircuitComponent, CircuitDocument, CircuitWire, TerminalRef } from "./types";
import { SOURCE_WIRE_COLORS } from "./wire-colors";

export type CourseTerminalAssignment = { stripRole: "xt16"; position: number; componentRole: string; terminalId: string; label: string; used: boolean; requiresInternal: boolean };
const externalTypes = new Set(["supply", "motor", "motor-star-delta", "motor-dahlander", "push-no", "push-nc", "limit-switch"]);
const plans = new Map<string, CourseTerminalAssignment[]>();

/** Each distinct external conductor network gets one position. Only wires and
 * the old PE bridge are merged: contacts, coils and windings never are. */
export function getCourseTerminalAssignments(lessonId?: string): CourseTerminalAssignment[] {
  if (!lessonId || !/^motor-course-(?:0[1-9]|10)$/.test(lessonId)) return [];
  const cached = plans.get(lessonId);
  if (cached) return cached.map(item => ({ ...item }));
  const reference = createMotorCourseDocument(lessonId, { wired: true });
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    if (!parent.has(key)) parent.set(key, key);
    const next = parent.get(key)!;
    if (next === key) return key;
    const result = root(next); parent.set(key, result); return result;
  };
  const join = (a: string, b: string) => parent.set(root(b), root(a));
  for (const wire of reference.wires) join(terminalKey(wire.from), terminalKey(wire.to));
  join("pe::A", "pe::B");
  const external = reference.components.filter(component => externalTypes.has(component.type));
  const externalIds = new Set(external.map(component => component.id));
  const assignments: CourseTerminalAssignment[] = [];
  const positions = new Map<string, number>();
  for (const component of external) {
    const terminals = component.type === "supply" ? ["L1", "L2", "L3", "N", "PE"] : getDefinition(component.type).terminals.map(terminal => terminal.id).filter(terminal => parent.has(`${component.id}::${terminal}`));
    for (const terminalId of terminals) {
      const group = root(`${component.id}::${terminalId}`);
      if (!positions.has(group)) positions.set(group, positions.size + 1);
      const requiresInternal = [...parent.keys()].some(key => root(key) === group && !externalIds.has(key.split("::")[0]) && !key.startsWith("pe::"));
      assignments.push({ stripRole: "xt16", position: positions.get(group)!, componentRole: component.id, terminalId, label: `${component.type === "supply" ? "电源" : component.label} ${terminalId}`, used: true, requiresInternal });
    }
  }
  if (positions.size > 20) throw new Error(`课程外接独立节点需要 ${positions.size} 位，超过20位端子排容量`);
  plans.set(lessonId, assignments);
  return assignments.map(item => ({ ...item }));
}

export function getCourseTerminalCount(lessonId?: string): 16 | 20 {
  return Math.max(0, ...getCourseTerminalAssignments(lessonId).map(item => item.position)) > 16 ? 20 : 16;
}

/** Pure transformation for NEW templates only. Existing member documents are
 * never sent through this function on load or save. */
export function terminalizeMotorCourse(document: CircuitDocument): CircuitDocument {
  const assignments = getCourseTerminalAssignments(document.lessonId);
  if (!assignments.length) return document;
  if (document.components.some(component => component.id === "xt16" || component.id === "xt2")) throw new Error("新课程模板已包含端子排，不能重复转换");
  const count = getCourseTerminalCount(document.lessonId);
  const earthId = document.roles?.pe ?? "pe";
  const roles: Record<string, string> = { ...document.roles, xt16: "xt16" }; delete roles.pe;
  const components: CircuitComponent[] = [...document.components.filter(component => component.id !== earthId).map(component => component.type === "supply" ? { ...component, mirrored: true } : component), { id: "xt16", type: count === 20 ? "terminal-strip20" : "terminal-strip16", label: `XT1（${count}位，5为PE）`, pePositions: [5], position: { x: 0, y: 0 } }];
  const resolve = (assignment: CourseTerminalAssignment): TerminalRef => ({ componentId: document.roles?.[assignment.componentRole] ?? assignment.componentRole, terminalId: assignment.terminalId });
  const mapping = new Map(assignments.map(assignment => [terminalKey(resolve(assignment)), assignment]));
  const remap = (ref: TerminalRef): TerminalRef => {
    const assignment = mapping.get(terminalKey(ref));
    return assignment ? { componentId: assignment.stripRole, terminalId: `T${assignment.position}` } : { ...ref };
  };
  // The single PE position carries every external PE lead. Same-net external
  // links collapse onto that position; they must not become self-wires.
  const seenConnections = new Set<string>();
  const wires: CircuitWire[] = document.wires.filter(wire => ![wire.from, wire.to].some(ref => ref.componentId === earthId)).map(wire => ({ ...wire, from: remap(wire.from), to: remap(wire.to) })).filter(wire => {
    const ends = [terminalKey(wire.from), terminalKey(wire.to)].sort(), connection = ends.join("|");
    if (ends[0] === ends[1] || seenConnections.has(connection)) return false;
    seenConnections.add(connection); return true;
  });
  if (document.wires.length) for (const assignment of assignments) {
    const external = resolve(assignment);
    const component = document.components.find(item => item.id === external.componentId);
    if (!component || !getDefinition(component.type).terminals.some(terminal => terminal.id === external.terminalId)) throw new Error(`课程外部端子不存在：${assignment.label}`);
    const original = document.wires.find(wire => [wire.from, wire.to].some(ref => terminalKey(ref) === terminalKey(external)));
    if (!original && !(assignment.componentRole === "source" && assignment.terminalId === "N")) throw new Error(`课程外部端子缺少示范接线：${assignment.label}`);
    wires.push({ id: `terminal-${assignment.componentRole}-${assignment.terminalId}`, from: { componentId: assignment.stripRole, terminalId: `B${assignment.position}` }, to: external, color: assignment.componentRole === "source" ? SOURCE_WIRE_COLORS[assignment.terminalId] : original!.color, style: "orthogonal", routing: "duct" });
  }
  return { ...document, components, roles, wires };
}
