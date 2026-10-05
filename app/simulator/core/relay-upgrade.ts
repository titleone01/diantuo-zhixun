import type { CircuitDocument } from "./types";
import { TIMER_MAX_MS, TIMER_DEFAULT_MS } from "./catalog";
import { validateDocument } from "./validation";

export const TIMER_PORT_UPGRADE: Record<string,string> = {A1:"2",A2:"7","15":"1","16":"4","25":"8","28":"6"};
/** Explicit copy only; callers never replace a publication or mutate the input. */
export function upgradeRelays(document: CircuitDocument): CircuitDocument {
  if(document.components.some(c=>c.type==="timer380"&&(c.settings?.delayMs??TIMER_DEFAULT_MS)>TIMER_MAX_MS))throw new Error("旧 KT 设置超过5分钟，请先明确调整延时再升级；原文档已保留。");
  const timerIds=new Set(document.components.filter(c=>c.type==="timer380").map(c=>c.id));
  const next: CircuitDocument={...document,components:document.components.map(c=>({...c,type:c.type==="relay380"?"relay380-jzc1-22":c.type==="timer380"?"timer380-8pin":c.type})),wires:document.wires.map(w=>({...w,from:timerIds.has(w.from.componentId)?{...w.from,terminalId:TIMER_PORT_UPGRADE[w.from.terminalId]??w.from.terminalId}:{...w.from},to:timerIds.has(w.to.componentId)?{...w.to,terminalId:TIMER_PORT_UPGRADE[w.to.terminalId]??w.to.terminalId}:{...w.to}}))};
  const checked=validateDocument(next);if(!checked.valid)throw new Error(checked.errors.join("；"));
  return next;
}
