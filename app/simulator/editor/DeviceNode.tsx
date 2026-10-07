import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { TIMER_MIN_MS, TIMER_MAX_MS, TIMER_DEFAULT_MS, componentSize, DUCT_MAX_SIZE, DUCT_MIN_SIZE, getDefinition, isLayoutObject, isTimer, transformedTerminal } from "../core/catalog";
import { terminalKey } from "../core/types";
import type { CircuitComponent, CircuitDocument, ComponentRuntime, ComponentSize, Diagnostic, Point, Runtime, SimulationAction, TerminalState } from "../core/types";
import DeviceArtwork from "./DeviceArtwork";
import { terminalColor, wirePath } from "./geometry";
import { runtimeSummary } from "./labels";

export type DeviceNodeData = {
  component: CircuitComponent;
  running: boolean;
  runtime: Runtime;
  result?: ComponentRuntime;
  terminalStates: Record<string, TerminalState>;
  terminalColors?: Record<string,string>;
  diagnostics: Diagnostic[];
  action: (action: SimulationAction) => void;
  readOnly: boolean;
  linkedComponents: { id: string; label: string }[];
  configure: (id: string, patch: Pick<CircuitComponent, "linkedTo" | "settings">) => void;
  document?: CircuitDocument;
  beginResize?: (id: string) => void;
  resize?: (id: string, bounds: Point & ComponentSize, finish?: boolean) => void;
  cancelResize?: () => void;
  selectedWireIds?: string[];
};
export type ElectricalNode = Node<DeviceNodeData, "electrical">;

const sidePosition = { top: Position.Top, bottom: Position.Bottom, left: Position.Left, right: Position.Right };

export default function DeviceNode({ data, selected }: NodeProps<ElectricalNode>) {
  const { component, running, runtime, result, action } = data;
  const definition = getDefinition(component.type);
  const size = componentSize(component);
  const duct = isLayoutObject(component.type);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const timerInput=useRef<HTMLInputElement | null>(null);
  useLayoutEffect(()=>{if(settingsOpen)timerInput.current?.focus();},[settingsOpen]);
  const rail = component.type === "din-rail";
  const timer = isTimer(component.type);
  const contactor = component.type === "contactor220" || component.type === "contactor380";
  const resizeActions = useRef(data);
  useLayoutEffect(()=>{resizeActions.current=data;},[data]);
  // XYFlow installs a drag listener per callback identity. Keep these stable
  // throughout a gesture even when document updates render the node again.
  const onResizeStart = useCallback(() => resizeActions.current.beginResize?.(component.id), [component.id]);
  const onResize = useCallback((_event: unknown, bounds: Point & ComponentSize) => resizeActions.current.resize?.(component.id, bounds), [component.id]);
  const onResizeEnd = useCallback((_event: unknown, bounds: Point & ComponentSize) => resizeActions.current.resize?.(component.id, bounds, true), [component.id]);
  const leads = data.document?.wires.flatMap(wire => [wire.from, wire.to].filter(ref => ref.componentId === component.id).map(ref => ({ wire, terminal: definition.terminals.find(terminal => terminal.id === ref.terminalId)! }))) ?? [];
  const faulty = data.diagnostics.some(d => d.componentIds.includes(component.id) && d.severity !== "info");
  const momentary = component.type === "push-no" || component.type === "push-nc" || component.type === "limit-switch";
  const latching = component.type === "push-latching-red" || component.type === "push-latching-green";
  const knife = component.type === "knife-switch3";
  const breaker = component.type === "breaker1" || component.type === "breaker3";
  const toggle = breaker || knife || latching || component.type === "switch1" || component.type === "switch2";
  const closed = !!runtime.switches[component.id];
  const pressed = !!runtime.pressed[component.id];
  const dispatch = (type: "press" | "release" | "toggle" | "trip-overload" | "reset-overload") => action({ type, componentId: component.id });

  return <div
    className={`sim-device-node ${selected ? "is-selected" : ""} ${faulty ? "has-diagnostic" : ""} ${pressed ? "is-pressed" : ""} ${result?.active ? "is-active" : ""} ${definition.load?.kind === "motor" && result?.active ? "sim-motor-running" : ""}`}
    style={{ width: size.width, height: size.height }}
    onPointerCancel={duct ? data.cancelResize : undefined}
    data-device-id={component.id}
    data-component-type={component.type}
    data-world-x={component.position.x}
    data-world-y={component.position.y}
    data-runtime-state={result?.state ?? "editing"}
    data-runtime-direction={result?.direction}
    data-runtime-connection={result?.connection}
    data-runtime-speed={result?.speed}
  >
    {duct && <NodeResizer isVisible={!!selected && !running && !data.readOnly} minWidth={DUCT_MIN_SIZE} minHeight={rail ? 24 : DUCT_MIN_SIZE} maxWidth={DUCT_MAX_SIZE} maxHeight={rail ? 24 : DUCT_MAX_SIZE} keepAspectRatio={false} handleClassName="sim-duct-resize-handle" lineClassName="sim-duct-resize-line" onResizeStart={onResizeStart} onResize={onResize} onResizeEnd={onResizeEnd} />}
    <DeviceArtwork rotation={component.rotation} result={result} delayMs={component.settings?.delayMs} running={running} type={component.type} active={!!result?.active} pressed={pressed} closed={!!runtime.switches[component.id]} direction={result?.direction} speed={result?.speed} />
    {data.document && !!leads.length && <svg className="sim-terminal-leads" width={size.width} height={size.height} aria-hidden="true">
      {leads.map(({ wire, terminal }) => { const clip = `lead-${component.id}-${wire.id}-${terminal.id}`; return <g key={clip}><defs><clipPath id={clip}><rect x="0" y="0" width={size.width} height={size.height} /></clipPath></defs><g clipPath={`url(#${clip})`}>{data.selectedWireIds?.includes(wire.id) && <path d={wirePath(data.document!, wire)} transform={`translate(${-component.position.x} ${-component.position.y})`} fill="none" stroke="#3478f6" strokeOpacity={0.65} strokeWidth={9} vectorEffect="non-scaling-stroke" strokeLinecap="round"/>}<path d={wirePath(data.document!, wire)} transform={`translate(${-component.position.x} ${-component.position.y})`} fill="none" stroke={wire.color} strokeWidth={data.selectedWireIds?.includes(wire.id) ? 4 : 3} vectorEffect="non-scaling-stroke" strokeLinecap="round" /></g></g>; })}
    </svg>}
    <div className="sim-device-caption"><b>{component.label}</b><span>{definition.name}</span>{timer && <span>教学双延时 · {(component.settings?.delayMs ?? 3000) / 1000} s</span>}{component.type === "auxiliary-no" && <span>{data.linkedComponents.find(item => item.id === component.linkedTo)?.label ?? "未关联"}</span>}</div>
    {faulty && definition.load?.kind === "motor" && <span className="sim-motor-diagnostic" role="status" title={data.diagnostics.filter(d => d.componentIds.includes(component.id)).map(d => d.message).join("；")}>诊断</span>}
    {definition.terminals.map(original => {
      const terminal = transformedTerminal(component,original);
      const key = terminalKey({ componentId: component.id, terminalId: terminal.id });
      const state = data.terminalStates[key];
      const isFaulty = data.diagnostics.some(d => d.terminalIds.includes(key));
      const color = data.terminalColors?.[key] ?? terminalColor(terminal);
      return <Handle
        key={terminal.id}
        id={terminal.id}
        type="source"
        position={sidePosition[terminal.side]}
        isConnectable={!running && !data.readOnly}
        className={`sim-terminal sim-terminal-${terminal.side} ${state?.energized ? "is-energized" : ""} ${isFaulty ? "has-diagnostic" : ""}`}
        style={{ left: terminal.x, top: terminal.y, right: "auto", bottom: "auto", transform: "translate(-50%, -50%)", borderColor: color }}
        title={`${component.label} · ${terminal.label}${state ? ` · ${state.potential}` : ""}`}
        aria-label={`${component.label} 端子 ${terminal.label}`}
        data-terminal-key={key}
        data-terminal-energized={running && !!state?.energized}
        data-world-x={component.position.x + terminal.x}
        data-world-y={component.position.y + terminal.y}
      ><i className="sim-terminal-indicator" aria-hidden="true" />{!contactor && !timer && component.type !== "relay380-jzc1-22" && <span className="sim-terminal-label">{terminal.label}</span>}</Handle>;
    })}
    {running && momentary && <button
      className={`sim-actuator sim-push-actuator nodrag nopan ${component.type !== "limit-switch" ? "sim-mechanism-hit sim-button-cap-hit" : ""} ${pressed ? "is-pressed" : ""}`}
      aria-pressed={pressed}
      title="按住操作，松开复位"
      aria-label={`${component.label} ${component.type === "limit-switch" ? "限位开关" : definition.name}`}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); dispatch("press"); }}
      onPointerUp={event => { event.preventDefault(); dispatch("release"); }}
      onPointerCancel={() => dispatch("release")}
      onLostPointerCapture={() => { if (pressed) dispatch("release"); }}
      onKeyDown={event => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); dispatch("press"); } }}
      onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); dispatch("release"); } }}
      onBlur={() => dispatch("release")}
    >{component.type === "limit-switch" ? pressed ? "已按下" : "按住" : null}</button>}
    {!running && timer && <div className="sim-timer-controls nodrag nopan"><button disabled={data.readOnly} aria-label={`${component.label} 减少延时`} onClick={()=>data.configure(component.id,{settings:{delayMs:Math.max(TIMER_MIN_MS,Math.min(TIMER_MAX_MS,(component.settings?.delayMs??TIMER_DEFAULT_MS)-1000))}})}>−</button><button disabled={data.readOnly} aria-label={`${component.label} 设置时间`} aria-expanded={settingsOpen} onClick={()=>setSettingsOpen(open=>!open)}>设置</button><button disabled={data.readOnly} aria-label={`${component.label} 增加延时`} onClick={()=>data.configure(component.id,{settings:{delayMs:Math.min(TIMER_MAX_MS,(component.settings?.delayMs??TIMER_DEFAULT_MS)+1000)}})}>+</button></div>}
    {timer && (component.settings?.delayMs??3000)>300000 && <span className="sim-legacy-timer-warning">历史设置超过5分钟；原值保留，请调整后升级</span>}
    {!running && settingsOpen && timer && <div className="sim-device-setting sim-timer-setting nodrag nopan" role="group" aria-label={`${component.label} 时间设置`}><label>延时<input ref={timerInput} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setSettingsOpen(false); } }} aria-label={`${component.label} 延时秒数`} type="number" min={TIMER_MIN_MS/1000} max={TIMER_MAX_MS/1000} step="0.001" value={(component.settings?.delayMs ?? 3000) / 1000} disabled={data.readOnly} onChange={event => { const seconds = event.currentTarget.valueAsNumber; if (Number.isFinite(seconds) && seconds >= TIMER_MIN_MS/1000 && seconds <= TIMER_MAX_MS/1000) data.configure(component.id, { settings: { delayMs: Math.round(seconds * 1000) } }); }} />秒</label><button type="button" aria-label={`${component.label} 关闭时间设置`} onClick={()=>setSettingsOpen(false)}>×</button></div>}
    {!running && selected && component.type === "auxiliary-no" && <label className="sim-device-setting sim-link-setting nodrag nopan">关联线圈<select aria-label={`${component.label} 关联线圈`} value={component.linkedTo ?? ""} disabled={data.readOnly} onChange={event => data.configure(component.id, { linkedTo: event.target.value || undefined })}><option value="">请选择 KM / KA</option>{data.linkedComponents.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
    {running && toggle && <button className={`sim-actuator sim-toggle-actuator nodrag nopan ${breaker ? "sim-mechanism-hit sim-breaker-handle-hit" : latching ? "sim-mechanism-hit sim-button-cap-hit" : knife ? "sim-mechanism-hit sim-knife-handle-hit" : ""}`} style={knife ? { left: 17.499, top: 39.999, width: 178, height: 107, transform: "none" } : undefined} onClick={() => dispatch("toggle")} aria-pressed={closed} title={latching ? closed ? "已按下 · 点击弹起" : "已弹起 · 点击按下" : closed ? "已合闸 · 点击分闸" : "已分闸 · 点击合闸"} aria-label={`${component.label} ${latching ? closed ? "弹起" : "按下" : closed ? "分闸" : "合闸"}`}>
      {breaker || knife || latching ? null : component.type === "switch2" ? "切换" : closed ? "分闸" : "合闸"}
    </button>}
    {running && component.type === "overload" && <div className="sim-overload-actions nodrag nopan"><button onClick={() => dispatch("trip-overload")} aria-label={`${component.label} 过载 TEST`}>TEST</button><button onClick={() => dispatch("reset-overload")} aria-label={`${component.label} 过载 RESET`}>RESET</button></div>}
    {running && !contactor && (latching || result?.active || definition.load || component.type === "overload" || component.type === "auxiliary-no") && <span className={`sim-node-runtime ${result?.active ? "is-active" : ""}`}>{latching ? closed ? "已按下" : "已弹起" : runtimeSummary(result)}{timer && result?.remainingMs !== undefined && ` · ${(result.remainingMs / 1000).toFixed(1)} s`}</span>}
  </div>;
}
