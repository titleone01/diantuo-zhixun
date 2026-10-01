"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { BookOpen, GripHorizontal, Maximize2, Minus, Plus, ZoomIn, ZoomOut } from "lucide-react";
import ReferenceVideoPlayer from "../reference-video/ReferenceVideoPlayer";
import type { ReferenceVideo } from "../reference-video/catalog";

type Props = { panelRef: RefObject<HTMLDivElement | null>; boardRef: RefObject<HTMLDivElement | null>; children: ReactNode; documentKey?: string; video?: ReferenceVideo; onChooseDrawing?: () => void; selectionDisabled?: boolean };

/** Window coordinates are presentation only; they never enter the circuit document. */
export default function FloatingSchematic({ panelRef, boardRef, children, documentKey, video, onChooseDrawing, selectionDisabled }: Props) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"schematic" | "video" | "guide">("schematic");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const constrain = useCallback((point: { x: number; y: number }) => {
    const board = boardRef.current, panel = panelRef.current;
    if (!board || !panel) return point;
    const width = panel.offsetWidth * scale, height = panel.offsetHeight * scale;
    const left = board.clientWidth - 20 - width, top = board.clientHeight - 70 - height;
    // Keep the header reachable even when the user enlarges beyond a small viewport.
    return { x: Math.max(8 - left, Math.min(Math.max(8, board.clientWidth - width - 8) - left, point.x)), y: Math.max(8 - top, Math.min(Math.max(8, board.clientHeight - height - 8) - top, point.y)) };
  }, [boardRef, panelRef, scale]);
  useEffect(() => {
    const clamp = () => setOffset(previous => { const next = constrain(previous); return next.x === previous.x && next.y === previous.y ? previous : next; });
    clamp(); const observer = new ResizeObserver(clamp);
    if (boardRef.current) observer.observe(boardRef.current);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [constrain, boardRef, panelRef, open]);
  useEffect(() => { setOpen(true); setTab("schematic"); }, [documentKey]);
  function reset() { setScale(1); setOffset({ x: 0, y: 0 }); }
  return <div ref={panelRef} className={`sim-diagram ${open ? "" : "is-collapsed"} ${dragging ? "is-dragging" : ""}`} data-window-scale={scale.toFixed(1)} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, maxHeight: `calc((100% - 16px) / ${scale})` }}>
    <div className="sim-diagram-header" onDoubleClick={reset} onPointerDown={event => {
      if (event.button !== 0 || (event.target as Element).closest("button:not(.sim-diagram-drag)")) return;
      event.preventDefault(); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: offset.x, startY: offset.y };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    }} onPointerMove={event => { const start = drag.current; if (start?.id === event.pointerId) setOffset(constrain({ x: start.startX + event.clientX - start.x, y: start.startY + event.clientY - start.y })); }}
    onPointerUp={event => { if (drag.current?.id === event.pointerId) { drag.current = null; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); } }}
    onPointerCancel={() => { drag.current = null; setDragging(false); }} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      <button className={tab === "schematic" ? "active" : ""} onClick={() => { setTab("schematic"); setOpen(true); }}>接线图</button>
      <button className={tab === "video" ? "active" : ""} onClick={() => { setTab("video"); setOpen(true); }}>教学视频</button>
      <button className="sim-diagram-drag" aria-label="拖动图纸窗口" title="拖动窗口；方向键移动，双击标题复位" onKeyDown={event => { const steps: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }; const step = steps[event.key]; if (step) { event.preventDefault(); event.stopPropagation(); setOffset(value => constrain({ x: value.x + step[0], y: value.y + step[1] })); } }}><GripHorizontal size={18}/></button>
      <button className="sim-diagram-reset" aria-label="复位图纸窗口" title="复位位置和大小" onClick={reset}><Maximize2 size={15}/></button>
      <button className="sim-diagram-collapse" aria-label={open ? "收起图纸" : "展开图纸"} onClick={() => setOpen(!open)}>{open ? <Minus size={19}/> : <Plus size={19}/>}</button>
    </div>
    {open && <><div className="sim-diagram-content"><div hidden={tab !== "schematic"} style={{ height: "100%" }}>{children}</div>{tab === "video" ? <ReferenceVideoPlayer video={video}/> : tab === "guide" ? <div className="sim-guide"><h3>从接线到运行</h3><ol><li>把元件拖入画布，拖动圆形端子连接导线。</li><li>同一端子可连接多根线；交叉导线不会自动连通。</li><li>选中导线后双击添加折点，拖动折点调整走线。</li><li>开始仿真后合闸，操作按钮观察元件联动。</li><li>点击「检查接线」，分别查看安全和课程判定。</li></ol><p>运行期间暂停接线编辑。高亮表示导线带电；离散教学模型不计算真实电流大小。</p></div> : null}</div>
    <div className="sim-diagram-tools"><button className="sim-diagram-guide" aria-label="选择图纸" title="选择图纸" disabled={selectionDisabled || !onChooseDrawing} onClick={onChooseDrawing}><BookOpen size={20}/></button><button className="sim-diagram-help" aria-label="操作说明" title="操作说明" onClick={() => setTab("guide")}>?</button><output aria-label="图纸窗口缩放比例">{Math.round(scale * 100)}%</output><button aria-label="缩小图纸" disabled={scale <= 0.5} onClick={() => setScale(value => Math.max(0.5, Math.round((value - 0.1) * 10) / 10))}><ZoomOut size={20}/></button><button aria-label="放大图纸" disabled={scale >= 2} onClick={() => setScale(value => Math.min(2, Math.round((value + 0.1) * 10) / 10))}><ZoomIn size={20}/></button></div></>}
  </div>;
}
