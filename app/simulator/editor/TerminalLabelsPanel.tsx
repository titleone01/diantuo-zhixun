import { useLayoutEffect, useRef } from "react";
import { terminalStripCapacity } from "../core/catalog";
import type { CircuitComponent } from "../core/types";

export default function TerminalLabelsPanel({ component, disabled, onLabel, onClear, onClose }: { component: CircuitComponent; disabled: boolean; onLabel: (position: number, label: string) => void; onClear: () => void; onClose: () => void }) {
  const panel = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { const scroller = panel.current?.closest(".sim-library-scroller"); if (scroller) scroller.scrollTop = 0; }, [component.id]);
  return <section ref={panel} className="sim-terminal-labels-panel" aria-label="端子标注">
    <header><strong>{component.label} · 端子标注</strong><button type="button" aria-label="关闭端子标注" onClick={onClose}>×</button></header>
    <p>逐位填写，上下端共用标记；空白表示未标注。</p>
    <div className="sim-terminal-labels-grid">{Array.from({ length: terminalStripCapacity(component.type) }, (_, index) => index + 1).map(position => <label key={position}><span>第{position}位{component.pePositions?.includes(position) ? " · PE" : ""}</span><input aria-label={`${component.label} 第${position}位标注`} value={component.terminalLabels?.[position] ?? ""} maxLength={48} disabled={disabled} onChange={event => onLabel(position, event.target.value)} /></label>)}</div>
    <button type="button" className="sim-button" disabled={disabled || !Object.keys(component.terminalLabels ?? {}).length} onClick={onClear}>清空全部标注</button>
  </section>;
}
