import { useState } from "react";
import type { CircuitDocument } from "../core/types";
import type { WiringNet, WireNumberNotice } from "../core/wire-nets";
import { terminalDisplayLabel } from "../core/terminal-labels";
import { getDefinition } from "../core/catalog";

type Props = { document: CircuitDocument; net: WiringNet; selectedCount: number; frozen: boolean; mode: "single" | "net"; notices: WireNumberNotice[]; onNumber: (number: string) => void; onLocate: (componentId: string) => void; onClose: () => void };

export default function WireTracePanel({ document, net, selectedCount, frozen, mode, notices, onNumber, onLocate, onClose }: Props) {
  const [number, setNumber] = useState(net.numbers.length === 1 ? net.numbers[0] : "");
  return <section className="sim-wire-trace-panel" aria-label="巡线与线号">
    <header><strong>{mode === "net" ? "等电位巡线" : "单根选线"}</strong><button type="button" aria-label="关闭巡线" onClick={onClose}>×</button></header>
    <p>{selectedCount} 根实际选中 · 此节点 {net.wireIds.length} 根导线 / {net.terminalIds.length} 个端子</p>
    <form onSubmit={event => { event.preventDefault(); onNumber(number); }}>
      <label>组内线号<input aria-label="组内线号" value={number} disabled={frozen} onChange={event => setNumber(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }} placeholder={net.numbers.length > 1 ? "多个线号，填写以统一" : "如 1、4、U1"} /></label>
      <button type="submit" disabled={frozen}>设置整组线号</button><button type="button" disabled={frozen || !net.numbers.length} onClick={() => { setNumber(""); onNumber(""); }}>清除线号</button>
    </form>
    {notices.map(notice => <p className="sim-wire-number-warning" role="status" key={notice.message}>{notice.message}</p>)}
    <p className="sim-wire-trace-note">按导线与端子桥接分组，跨器件分段。线号由你核对原图填写。</p>
    <ul aria-label="接线节点端子清单">{net.terminalIds.map(key => {
      const [id, terminalId] = key.split("::");
      const component = document.components.find(item => item.id === id);
      const terminal = component && getDefinition(component.type).terminals.find(item => item.id === terminalId);
      return <li key={key}><button type="button" onClick={() => onLocate(id)} title="定位此端子所在器件">{net.numbers.length ? <b>{net.numbers.join(" / ")} · </b> : null}{component?.label ?? id} · {component && terminal ? terminalDisplayLabel(component, terminal) : terminalId}</button></li>;
    })}</ul>
  </section>;
}
