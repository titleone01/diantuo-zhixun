import { componentSize, getDefinition, isWireDuct } from "./catalog";
import type { CircuitComponent, CircuitDocument } from "./types";

type LayoutReference = { file: string; rows: string[][]; buttons: string[]; limits?: string[] };
const power = ["qf", "fu1", "fu2", "fu2a", "fu2b"];
/** Read from the user's ten layout PNGs, not generated from device count. */
export const TRAINING_LAYOUT_REFERENCES: Record<string, LayoutReference> = {
  "motor-course-01": { file: "电动机点动控制电路布局图.png", rows: [power, ["km"], []], buttons: ["sb"] },
  "motor-course-02": { file: "电动机连续运行控制电路布局图.png", rows: [power, ["km"], ["fr"]], buttons: ["sb1", "sb2"] },
  "motor-course-03": { file: "点动与连续运行电路布局图.png", rows: [power, ["km"], ["fr"]], buttons: ["sb1", "sb2", "sb3"] },
  "motor-course-04": { file: "接触器互锁正反转电路布局图.png", rows: [power, ["km1", "km2"], ["fr"]], buttons: ["sb1", "sb2", "sb3"] },
  "motor-course-05": { file: "双重联锁正反转控制电路布局图.png", rows: [power, ["km1", "km2"], ["fr"]], buttons: ["sb1", "sb2", "sb3"] },
  "motor-course-06": { file: "自动往返控制电路布局图.png", rows: [power, ["km1", "km2"], ["fr"]], buttons: ["sb1", "sb2", "sb3"], limits: ["sq1", "sq2", "sq3", "sq4"] },
  "motor-course-07": { file: "顺序控制电路布局图.png", rows: [power, ["km1", "km1_aux", "km2", "km2_aux"], ["fr1", "fr2"]], buttons: ["sb1", "sb2", "sb3", "sb4"] },
  "motor-course-08": { file: "延时起动控制电路布局图.png", rows: [power, ["ka", "km", "kt"], ["fr"]], buttons: ["sb1", "sb2"] },
  "motor-course-09": { file: "Y-△降压起动控制电路布局图.png", rows: [power, ["km", "kmd", "kmy"], ["fr", "kt"]], buttons: ["sb1", "sb2"] },
  "motor-course-10": { file: "双速电机运行控制电路布局图.png", rows: [power, ["km1", "km2", "km3"], ["fr"]], buttons: ["sb1", "sb2", "sb3"] },
};
const buttonTypes = new Set(["push-no", "push-nc", "push-latching-red", "push-latching-green", "switch1", "switch2"]);
const loadTypes = new Set(["motor", "motor-star-delta", "motor-dahlander", "lamp"]);

/** Missing placement drawings borrow the existing continuous-run board's six-duct pattern. */
function referenceFor(document: CircuitDocument): LayoutReference {
  const own = document.lessonId && TRAINING_LAYOUT_REFERENCES[document.lessonId];
  if (own) return own;
  const ids = (types: string[]) => document.components.filter(component => types.includes(component.type)).map(component => component.id);
  const rows = [ids(["breaker3", "breaker1", "knife-switch3", "fuse3", "fuse2", "fuse"]), ids(["contactor220", "contactor380", "relay380", "timer380", "auxiliary-no"]), ids(["overload", "terminal"])];
  return { file: TRAINING_LAYOUT_REFERENCES["motor-course-02"].file, rows, buttons: document.components.filter(component => buttonTypes.has(component.type)).map(component => component.id), limits: ids(["limit-switch"]) };
}
export const trainingLayoutReference = (document: CircuitDocument) => referenceFor(document).file;

const DUCT_WIDTH = 32;
const CLEARANCE = 40;
const SEPARATION = 76;
const rowWidth = (row: CircuitComponent[]) => row.reduce((sum, component, index) => sum + componentSize(component).width + (index ? component.id === "fu2b" ? 16 : SEPARATION : 0), 0);

/** Transcribe the six reference channels. Do not add per-device or external control ducts. */
export function arrangeTrainingDucts(document: CircuitDocument): CircuitDocument {
  if (document.components.some(component => isWireDuct(component.type)) || !document.components.length) return document;
  const reference = referenceFor(document);
  const byId = new Map(document.components.map(component => [component.id, component]));
  const resolve = (ids: string[]) => ids.map(id => byId.get(document.roles?.[id] ?? id)).filter((component): component is CircuitComponent => !!component);
  const rows = reference.rows.map(resolve);
  const buttons = resolve(reference.buttons), limits = resolve(reference.limits ?? []);
  const sources = document.components.filter(component => component.type === "supply");
  const loads = document.components.filter(component => loadTypes.has(component.type));
  const earths = document.components.filter(component => component.type === "pe-terminal");
  const placed = new Set([...rows.flat(), ...buttons, ...limits, ...sources, ...loads, ...earths].map(component => component.id));
  // Custom intermediary terminals use the XT area in the existing reference.
  const terminals = document.components.filter(component => !placed.has(component.id));
  const width = Math.max(880, ...rows.map(row => rowWidth(row) + CLEARANCE * 2 + DUCT_WIDTH));
  const positions = new Map<string, { x: number; y: number }>();
  const channels: number[] = [0];
  let y = 0;
  for (const [index, row] of rows.entries()) {
    const height = Math.max(index === 2 ? getDefinition("overload").height : getDefinition("contactor380").height, ...row.map(component => componentSize(component).height));
    let x = DUCT_WIDTH / 2 + CLEARANCE;
    for (const [column, component] of row.entries()) {
      if (column) x += component.id === "fu2b" ? 16 : SEPARATION;
      positions.set(component.id, { x, y: y + DUCT_WIDTH / 2 + CLEARANCE });
      x += componentSize(component).width;
    }
    y += DUCT_WIDTH + CLEARANCE * 2 + height;
    channels.push(y);
  }
  const bottom = y, sideX = width + 95;
  // The reference button box is outside the right duct, in the lower board area.
  let buttonY = Math.max(56, bottom - buttons.reduce((sum, component) => sum + componentSize(component).height + 28, -28));
  for (const component of buttons) { positions.set(component.id, { x: sideX, y: buttonY }); buttonY += componentSize(component).height + 28; }
  let limitX = sideX;
  for (const component of limits) { positions.set(component.id, { x: limitX, y: DUCT_WIDTH / 2 + CLEARANCE }); limitX += componentSize(component).width + 44; }
  let sourceX = 56;
  for (const component of sources) { positions.set(component.id, { x: sourceX, y: -componentSize(component).height - 65 }); sourceX += componentSize(component).width + 30; }
  let externalX = 56;
  for (const component of [...earths, ...terminals]) {
    positions.set(component.id, { x: externalX, y: bottom + 75 });
    externalX += componentSize(component).width + SEPARATION;
  }
  let loadX = 56;
  const loadY = bottom + 75 + Math.max(0, ...[...earths, ...terminals].map(component => componentSize(component).height)) + 80;
  for (const component of loads) { positions.set(component.id, { x: loadX, y: loadY }); loadX += componentSize(component).width + SEPARATION; }
  const ducts: CircuitComponent[] = [];
  const used = new Set(document.components.map(component => component.id));
  const add = (vertical: boolean, x: number, y: number, length: number) => {
    let id = `training-duct-${ducts.length + 1}`;
    while (used.has(id)) id += "-d";
    used.add(id);
    ducts.push({ id, type: vertical ? "wire-duct-vertical" : "wire-duct", label: `WD${ducts.length + 1}`, position: { x: vertical ? x - DUCT_WIDTH / 2 : x, y: vertical ? y : y - DUCT_WIDTH / 2 }, size: { width: vertical ? DUCT_WIDTH : length, height: vertical ? length : DUCT_WIDTH } });
  };
  for (const center of channels) add(false, -DUCT_WIDTH / 2, center, width + DUCT_WIDTH);
  add(true, 0, -DUCT_WIDTH / 2, bottom + DUCT_WIDTH);
  add(true, width, -DUCT_WIDTH / 2, bottom + DUCT_WIDTH);
  if (width + DUCT_WIDTH > 4000 || bottom + DUCT_WIDTH > 4000 || document.components.length + ducts.length > 200) throw new Error("元件过多或布局过大，请按参考图分组调整布局。");
  return { ...document, components: [...document.components.map(component => ({ ...component, position: positions.get(component.id) ?? component.position })), ...ducts] };
}

export function putWiresInDucts(document: CircuitDocument): CircuitDocument {
  return { ...document, wires: document.wires.map(wire => ({ ...wire, style: "duct" })) };
}
