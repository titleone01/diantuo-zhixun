import type { CircuitComponent, CircuitDocument, CircuitWire } from "../core/types";
import { validateDocument } from "../core/validation";

export type SelectionClipboard = { components: CircuitComponent[]; wires: CircuitWire[] };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const prefixes: Record<string,string> = {supply:"电源",terminal:"XT","terminal-strip16":"XT","pe-terminal":"PE","wire-duct":"WD","wire-duct-vertical":"WD","auxiliary-no":"NO"};
const prefix = (component: CircuitComponent) => component.label.match(/^([A-Z]+)\d+/)?.[1] ?? prefixes[component.type] ?? component.label.slice(0,50);

export function copySelection(document: CircuitDocument, selected: string[]): SelectionClipboard {
  const ids = new Set(selected);
  return clone({ components:document.components.filter(c=>ids.has(c.id)), wires:document.wires.filter(w=>ids.has(w.from.componentId)&&ids.has(w.to.componentId)) });
}

/** Copies instance data only. Course roles and runtime never enter the clipboard. */
export function pasteSelection(document: CircuitDocument, clipboard: SelectionClipboard, offset=32, makeId=()=>crypto.randomUUID()) {
  if (!clipboard.components.length) throw new Error("请先选择器件或线槽");
  const ids=new Map(clipboard.components.map(c=>[c.id,`copy-${makeId()}`]));
  const labels=new Set(document.components.map(c=>c.label));
  let clearedLinks=0;
  const components=clipboard.components.map(original=>{
    const component=clone(original), stem=prefix(component);
    let index=1;
    while([...labels].some(label=>label.startsWith(stem)&&Number(label.slice(stem.length).match(/^\d+/)?.[0])===index))index++;
    component.id=ids.get(original.id)!; component.label=`${stem}${index}`;labels.add(component.label);
    component.position={x:component.position.x+offset,y:component.position.y+offset};
    if(component.linkedTo){const mapped=ids.get(component.linkedTo);if(!mapped)clearedLinks++;component.linkedTo=mapped;}
    return component;
  });
  const wires=clipboard.wires.map(original=>({...clone(original),id:`wire-${makeId()}`,from:{...original.from,componentId:ids.get(original.from.componentId)!},to:{...original.to,componentId:ids.get(original.to.componentId)!},waypoints:original.waypoints?.map(p=>({x:p.x+offset,y:p.y+offset}))}));
  const next={...document,components:[...document.components,...components],wires:[...document.wires,...wires]};
  const checked=validateDocument(next);
  if(!checked.valid)throw new Error(checked.errors.join("；"));
  return {document:next,componentIds:components.map(c=>c.id),wireIds:wires.map(w=>w.id),clearedLinks};
}
