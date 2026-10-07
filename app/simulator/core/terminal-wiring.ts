import { getDefinition } from "./catalog";
import { terminalKey } from "./types";
import type { CircuitDocument, CircuitWire, TerminalRef } from "./types";
import { SOURCE_WIRE_COLORS } from "./wire-colors";

export type CourseTerminalAssignment = { stripRole: "xt16" | "xt2"; position: number; componentRole: string; terminalId: string; label: string; used: boolean };

/** New ten-course board boundary. PE remains on the dedicated earth terminal. */
export function getCourseTerminalAssignments(lessonId?: string): CourseTerminalAssignment[] {
  if (!lessonId || !/^motor-course-(?:0[1-9]|10)$/.test(lessonId)) return [];
  const number = Number(lessonId.slice(-2));
  const assignments: CourseTerminalAssignment[] = [];
  const add = (stripRole: CourseTerminalAssignment["stripRole"], position: number, componentRole: string, terminalId: string, used = true) => assignments.push({ stripRole, position, componentRole, terminalId, label: `${componentRole === "source" ? "电源" : componentRole.toUpperCase()} ${terminalId}`, used });
  ["L1", "L2", "L3"].forEach((terminal, i) => add("xt16", i + 1, "source", terminal));
  (number >= 9 ? ["U1", "V1", "W1"] : ["U", "V", "W"]).forEach((terminal, i) => add("xt16", i + 4, number === 7 ? "m1" : "m", terminal));
  if (number === 7) ["U", "V", "W"].forEach((terminal, i) => add("xt16", i + 7, "m2", terminal));
  if (number >= 9) ["U2", "V2", "W2"].forEach((terminal, i) => add("xt16", i + 7, "m", terminal));
  // Rotation 270 places T on the cabinet side (left), B toward the switches.
  // Stable slot IDs consequently read 16 to 1 from top to bottom.
  if (number === 6) for (let sq = 1; sq <= 4; sq++) ["11", "12", "23", "24"].forEach((terminal, i) => add("xt2", 20 - sq * 4 - i, `sq${sq}`, terminal, sq <= 2 || i < 2));
  return assignments;
}

/** Pure transformation for NEW templates only. Existing member documents are
 * never sent through this function on load or save. */
export function terminalizeMotorCourse(document: CircuitDocument): CircuitDocument {
  const assignments = getCourseTerminalAssignments(document.lessonId);
  if (!assignments.length) return document;
  if (document.components.some(component => component.id === "xt16" || component.id === "xt2")) throw new Error("新课程模板已包含端子排，不能重复转换");
  const roles = { ...document.roles, xt16: "xt16", ...(document.lessonId === "motor-course-06" ? { xt2: "xt2" } : {}) };
  const components = [...document.components, { id: "xt16", type: "terminal-strip16" as const, label: "XT1（16位）", position: { x: 0, y: 0 } }, ...(document.lessonId === "motor-course-06" ? [{ id: "xt2", type: "terminal-strip16" as const, label: "XT2（限位）", rotation: 270 as const, position: { x: 0, y: 0 } }] : [])];
  const resolve = (assignment: CourseTerminalAssignment): TerminalRef => ({ componentId: document.roles?.[assignment.componentRole] ?? assignment.componentRole, terminalId: assignment.terminalId });
  const mapping = new Map(assignments.filter(assignment => assignment.used).map(assignment => [terminalKey(resolve(assignment)), assignment]));
  const remap = (ref: TerminalRef): TerminalRef => {
    const assignment = mapping.get(terminalKey(ref));
    return assignment ? { componentId: assignment.stripRole, terminalId: `T${assignment.position}` } : { ...ref };
  };
  const wires: CircuitWire[] = document.wires.map(wire => ({ ...wire, from: remap(wire.from), to: remap(wire.to) }));
  // Empty practice documents retain zero wires. Every USED external endpoint
  // gets exactly one tail; every former branch ends on the internal T side.
  if (document.wires.length) for (const assignment of assignments.filter(item => item.used)) {
    const external = resolve(assignment);
    const component = document.components.find(item => item.id === external.componentId);
    if (!component || !getDefinition(component.type).terminals.some(terminal => terminal.id === external.terminalId)) throw new Error(`课程外部端子不存在：${assignment.label}`);
    const original = document.wires.find(wire => [wire.from, wire.to].some(ref => terminalKey(ref) === terminalKey(external)));
    if (!original) throw new Error(`课程外部端子缺少示范接线：${assignment.label}`);
    wires.push({ id: `terminal-${assignment.stripRole}-${assignment.position}`, from: { componentId: assignment.stripRole, terminalId: `B${assignment.position}` }, to: external, color: assignment.componentRole === "source" ? SOURCE_WIRE_COLORS[assignment.terminalId] : original.color, style: "orthogonal", routing: "duct" });
  }
  return { ...document, components, roles, wires };
}
