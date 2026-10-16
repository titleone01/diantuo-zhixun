import { isTerminalStrip, terminalStripCapacity } from "./catalog";
import type { CircuitComponent, CircuitDocument, Terminal } from "./types";
import { validWireNumber } from "./wire-nets";

/** Display labels never replace the stable Tn/Bn electrical identities. */
export function setTerminalLabel(document: CircuitDocument, componentId: string, position: number, input: string): CircuitDocument {
  const component = document.components.find(item => item.id === componentId);
  if (!component || !isTerminalStrip(component.type) || !Number.isInteger(position) || position < 1 || position > terminalStripCapacity(component.type)) throw new Error("请选择端子排内的有效位置。");
  const label = input.trim();
  if (label && !validWireNumber(label)) throw new Error("端子标注须为 1–24 个可打印字符。");
  if ((component.terminalLabels?.[position] ?? "") === label) return document;
  const terminalLabels = { ...component.terminalLabels };
  if (label) terminalLabels[position] = label; else delete terminalLabels[position];
  const next = { ...component };
  if (Object.keys(terminalLabels).length) next.terminalLabels = terminalLabels; else delete next.terminalLabels;
  return { ...document, components: document.components.map(item => item.id === componentId ? next : item) };
}

export function terminalDisplayLabel(component: CircuitComponent, terminal: Terminal): string {
  if (!isTerminalStrip(component.type)) return terminal.label;
  const position = Number(terminal.id.slice(1));
  const label = component.terminalLabels?.[position];
  return label ? `${label}（第${position}位${terminal.id.startsWith("T") ? "上" : "下"}）` : terminal.label;
}
