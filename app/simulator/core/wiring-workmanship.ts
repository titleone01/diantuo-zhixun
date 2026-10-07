import { getDefinition } from "./catalog";
import { getCourseTerminalAssignments } from "./terminal-wiring";
import { terminalKey } from "./types";
import { validateDocument } from "./validation";
import { getWireColorGroups } from "./wire-colors";
import type { CircuitDocument, Diagnostic, LessonCheck, TerminalRef, WorkmanshipReport } from "./types";
export type { WorkmanshipReport } from "./types";

const same = (a: TerminalRef, b: TerminalRef) => terminalKey(a) === terminalKey(b);
const includes = (wire: CircuitDocument["wires"][number], ref: TerminalRef) => same(wire.from, ref) || same(wire.to, ref);

/** Independent installation practice feedback. It never changes the electrical
 * lesson status, engine, document, or historical assessment records. */
export function assessWiringWorkmanship(document: CircuitDocument, lessonId = document.lessonId): WorkmanshipReport {
  const assignments = getCourseTerminalAssignments(lessonId);
  if (!assignments.length) return { status: "unsupported", checks: [], diagnostics: [] };
  const validation = validateDocument(document);
  if (!validation.valid) return { status: "unsupported", checks: [], diagnostics: validation.errors.map(message => ({ code: "INVALID_DOCUMENT", message, severity: "warning", componentIds: [], terminalIds: [], wireIds: [] })) };
  const checks: LessonCheck[] = [], diagnostics: Diagnostic[] = [];
  const id = (role: string) => document.roles?.[role] ?? role;
  for (const assignment of assignments.filter(item => item.used)) {
    const strip = document.components.find(component => component.id === id(assignment.stripRole));
    const external: TerminalRef = { componentId: id(assignment.componentRole), terminalId: assignment.terminalId };
    const outside: TerminalRef = { componentId: id(assignment.stripRole), terminalId: `B${assignment.position}` };
    const inside: TerminalRef = { ...outside, terminalId: `T${assignment.position}` };
    const externalWires = document.wires.filter(wire => includes(wire, external));
    const outsideWires = document.wires.filter(wire => includes(wire, outside));
    const insideWires = document.wires.filter(wire => includes(wire, inside));
    const passed = strip?.type === "terminal-strip16" && externalWires.length === 1 && includes(externalWires[0], outside) && outsideWires.length === 1 && insideWires.length > 0;
    const stripLabel = assignment.stripRole === "xt16" ? "XT1" : "XT2";
    const label = `${assignment.label} 经 ${stripLabel} 第 ${assignment.position} 位上下中转，柜外端子无旁路线`;
    checks.push({ id: `${assignment.stripRole}-${assignment.position}`, label, passed });
    if (!passed) diagnostics.push({ code: strip?.type === "terminal-strip16" ? "TERMINAL_BOUNDARY_BYPASS" : "TERMINAL_STRIP_MISSING", message: label, severity: "warning", componentIds: [external.componentId, outside.componentId], terminalIds: [external, outside, inside].map(terminalKey), wireIds: [...new Set([...externalWires, ...outsideWires, ...insideWires].map(wire => wire.id))] });
  }
  const groups = getWireColorGroups(document);
  for (const group of groups.filter(item => item.wireIds.length && (item.colors.length > 1 || item.sourcePotentials.length > 1))) {
    if (group.colors.length > 1) diagnostics.push({ code: "WIRE_GROUP_COLOR_CONFLICT", message: "永久导通的同一组导线颜色不一致，请选择其中一根导线统一整组颜色。", severity: "warning", componentIds: [...new Set(group.terminalIds.map(key => key.split("::")[0]))], terminalIds: group.terminalIds, wireIds: group.wireIds });
    if (group.sourcePotentials.length > 1) diagnostics.push({ code: "WIRE_GROUP_SOURCE_CONFLICT", message: `同一永久导通组接入 ${group.sourcePotentials.join("、")}，统一颜色不能修复该接线冲突。`, severity: "error", componentIds: [...new Set(group.terminalIds.map(key => key.split("::")[0]))], terminalIds: group.terminalIds, wireIds: group.wireIds });
  }
  checks.push({ id: "permanent-group-colors", label: "永久导通组的上下端子及导线颜色一致", passed: !groups.some(group => group.wireIds.length && group.colors.length > 1) });
  checks.push({ id: "permanent-group-sources", label: "永久导通组没有合并不同电源导体", passed: !groups.some(group => group.sourcePotentials.length > 1) });
  const earth = document.components.find(component => component.id === id("pe") && component.type === "pe-terminal");
  const peKeys = ["source", ...new Set(assignments.filter(assignment => assignment.componentRole.startsWith("m")).map(assignment => assignment.componentRole))].map(role => `${id(role)}::PE`);
  const earthGroup = groups.find(group => group.terminalIds.includes(`${id("source")}::PE`));
  const ordinaryStripPE = earthGroup?.terminalIds.some(key => document.components.find(component => component.id === key.split("::")[0])?.type === "terminal-strip16") ?? false;
  const pePassed = !!earth && !!earthGroup && peKeys.every(key => earthGroup.terminalIds.includes(key)) && !ordinaryStripPE && peKeys.every(key => document.wires.some(wire => {
    const endpoints = [wire.from, wire.to];
    return endpoints.some(ref => terminalKey(ref) === key) && endpoints.some(ref => ref.componentId === earth.id && getDefinition(earth.type).terminals.some(terminal => terminal.id === ref.terminalId));
  }));
  checks.push({ id: "dedicated-pe", label: "电源和各电机 PE 使用独立保护接地端子，不占普通端子排位置", passed: pePassed });
  if (!pePassed) diagnostics.push({ code: "DEDICATED_PE_REQUIRED", message: "电源和各电机 PE 应直接接入独立 PE 端子，不能用普通 XT 位置替代。", severity: "warning", componentIds: [id("pe"), ...peKeys.map(key => key.split("::")[0])], terminalIds: peKeys, wireIds: earthGroup?.wireIds ?? [] });
  return { status: checks.every(check => check.passed) ? "passed" : "incomplete", checks, diagnostics };
}
