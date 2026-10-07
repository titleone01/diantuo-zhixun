import { componentSize, getDefinition, isLayoutObject, isWireDuct } from "./catalog";
import type { CircuitComponent, CircuitDocument } from "./types";

type LayoutReference = { file: string; rows: string[][]; buttons: string[]; limits?: string[] };
const power = ["qf", "fu1", "fu2"];
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
  const rows = [ids(["breaker3", "breaker1", "knife-switch3", "fuse3", "fuse", "fuse2"]), ids(["contactor220", "contactor380", "relay380", "timer380", "relay380-jzc1-22", "timer380-8pin", "auxiliary-no"]), ids(["overload", "terminal"])];
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
  const resolve = (ids: string[]) => ids.flatMap(id => {
    const component = byId.get(document.roles?.[id] ?? id);
    // New practices combine the two channels; legacy documents keep their original IDs.
    if (id === "fu2" && !component) return ["fu2a", "fu2b"].map(key => byId.get(document.roles?.[key] ?? key)).filter((value): value is CircuitComponent => !!value);
    return component ? [component] : [];
  });
  const rows = reference.rows.map(resolve);
  const buttons = resolve(reference.buttons), limits = resolve(reference.limits ?? []);
  const xt2 = document.roles?.xt2 && byId.get(document.roles.xt2);
  const terminalPractice = !!document.roles?.xt16;
  // New practices leave room for separate wire lanes. Existing documents keep their saved sizes.
  const practiceWidth = document.lessonId === "motor-course-10" ? 128 : document.lessonId === "motor-course-09" ? 96 : 80;
  const ductWidth = terminalPractice ? practiceWidth : DUCT_WIDTH;
  const sources = document.components.filter(component => component.type === "supply");
  const loads = document.components.filter(component => loadTypes.has(component.type));
  const earths = document.components.filter(component => component.type === "pe-terminal");
  const placed = new Set([...rows.flat(), ...buttons, ...limits, ...sources, ...loads, ...earths, ...(xt2 ? [xt2] : [])].map(component => component.id));
  // Custom intermediary terminals use the XT area in the existing reference.
  const terminals = document.components.filter(component => !placed.has(component.id) && !isLayoutObject(component.type));
  const width = Math.max(880, ...rows.map(row => rowWidth(row) + CLEARANCE * 2 + ductWidth));
  const limitsHeight = limits.reduce((sum,c,index)=>sum+componentSize(c).height+(index?40:0),0);
  const buttonsHeight = buttons.reduce((sum,c,index)=>sum+componentSize(c).height+(index?28:0),0);
  const baseHeight = rows.reduce((sum,row,index)=>sum+ductWidth+CLEARANCE*2+Math.max(index===2?getDefinition("overload").height:getDefinition("contactor380").height,...row.map(c=>componentSize(c).height)),0);
  const extraRowHeight = xt2 ? Math.max(0, limitsHeight + buttonsHeight + 140 - baseHeight) / rows.length : 0;
  const positions = new Map<string, { x: number; y: number }>();
  const channels: number[] = [0];
  const rails: CircuitComponent[] = [];
  let y = 0;
  for (const [index, row] of rows.entries()) {
    const height = Math.max(index === 2 ? getDefinition("overload").height : getDefinition("contactor380").height, ...row.map(component => componentSize(component).height));
    let x = ductWidth / 2 + CLEARANCE;
    for (const [column, component] of row.entries()) {
      if (column) x += component.id === "fu2b" ? 16 : SEPARATION;
      positions.set(component.id, { x, y: y + ductWidth / 2 + CLEARANCE });
      x += componentSize(component).width;
    }
    if(row.length && !document.components.some(c=>c.type==="din-rail"))rails.push({id:`training-rail-${index+1}`,type:"din-rail",label:`导轨${index+1}`,position:{x:ductWidth/2,y:y+ductWidth/2+CLEARANCE+height/2-12},size:{width:width-ductWidth,height:24}});
    y += ductWidth + CLEARANCE * 2 + height + extraRowHeight;
    channels.push(y);
  }
  const bottom = y, sideX = width + ductWidth / 2 + 80;
  // The reference button box is outside the right duct, in the lower board area.
  let buttonY = xt2 ? ductWidth/2+CLEARANCE+limitsHeight+60 : Math.max(56, bottom - buttonsHeight);
  const controlsX = xt2 ? sideX + componentSize(xt2).width + 80 : sideX;
  for (const component of buttons) { positions.set(component.id, { x: controlsX, y: buttonY }); buttonY += componentSize(component).height + 28; }
  let limitX = sideX;
  let limitY = ductWidth/2+CLEARANCE;
  for (const component of limits) { positions.set(component.id, { x: xt2 ? controlsX : limitX, y: limitY }); if(xt2)limitY+=componentSize(component).height+40;else limitX += componentSize(component).width + 44; }
  if(xt2)positions.set(xt2.id,{x:sideX,y:ductWidth/2+CLEARANCE+(limitsHeight-componentSize(xt2).height)/2});
  let sourceX = 56;
  if(!terminalPractice)for (const component of sources) { positions.set(component.id, { x: sourceX, y: -componentSize(component).height - 65 }); sourceX += componentSize(component).width + 30; }
  const terminalRow = [...earths, ...terminals], terminalY = bottom + 75;
  let externalX = 56;
  for (const component of terminalRow) {
    positions.set(component.id, { x: externalX, y: terminalY });
    externalX += componentSize(component).width + SEPARATION;
  }
  // The board's outgoing XT/PE row precedes its external motors; keep space for bottom terminal leads.
  const loadY = terminalY + (terminalRow.length ? Math.max(...terminalRow.map(component => componentSize(component).height)) + SEPARATION : 0);
  externalX = 56;
  for (const component of [...(terminalPractice?sources:[]),...loads]) {
    positions.set(component.id, { x: externalX, y: loadY });
    externalX += componentSize(component).width + SEPARATION;
  }
  const ducts: CircuitComponent[] = [];
  const used = new Set(document.components.map(component => component.id));
  const add = (vertical: boolean, x: number, y: number, length: number) => {
    let id = `training-duct-${ducts.length + 1}`;
    while (used.has(id)) id += "-d";
    used.add(id);
    ducts.push({ id, type: vertical ? "wire-duct-vertical" : "wire-duct", label: `WD${ducts.length + 1}`, position: { x: vertical ? x - ductWidth / 2 : x, y: vertical ? y : y - ductWidth / 2 }, size: { width: vertical ? ductWidth : length, height: vertical ? length : ductWidth } });
  };
  for (const center of channels) add(false, -ductWidth / 2, center, width + ductWidth);
  add(true, 0, -ductWidth / 2, bottom + ductWidth);
  add(true, width, -ductWidth / 2, bottom + ductWidth);
  if (width + ductWidth > 4000 || bottom + ductWidth > 4000 || document.components.length + ducts.length + rails.length > 200) throw new Error("元件过多或布局过大，请按参考图分组调整布局。");
  return { ...document, components: [...document.components.map(component => ({ ...component, position: positions.get(component.id) ?? component.position })), ...ducts,...rails] };
}

export function putWiresInDucts(document: CircuitDocument): CircuitDocument {
  return { ...document, wires: document.wires.map(wire => ({ ...wire, style: "orthogonal", routing: "duct" })) };
}
