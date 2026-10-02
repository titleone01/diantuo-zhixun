"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { BookOpen, GripHorizontal, Maximize2, Minimize2, Minus, Plus, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import ReferenceVideoPlayer from "../reference-video/ReferenceVideoPlayer";
import type { ReferenceVideo } from "../reference-video/catalog";

type Props = { panelRef: RefObject<HTMLDivElement | null>; boardRef: RefObject<HTMLDivElement | null>; children: ReactNode; documentKey?: string; video?: ReferenceVideo; onChooseDrawing?: () => void; selectionDisabled?: boolean; zoom?: number; onZoomChange?: (zoom: number) => void };
const DEFAULT_FRAME = { width: 560, height: 600 };
const EDGES = { n: '上边', s: '下边', w: '左边', e: '右边', nw: '左上角', ne: '右上角', sw: '左下角', se: '右下角' };

/** Window coordinates are presentation only; they never enter the circuit document. */
export default function FloatingSchematic({ panelRef, boardRef, children, documentKey, video, onChooseDrawing, selectionDisabled, zoom: controlledZoom, onZoomChange }: Props) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"schematic" | "video" | "guide">("schematic");
  const [ownZoom, setOwnZoom] = useState(1);
  const zoom = controlledZoom ?? ownZoom;
  const setZoom = (value: number) => { if (onZoomChange) onZoomChange(value); else setOwnZoom(value); };
  const [frame, setFrame] = useState(DEFAULT_FRAME);
  const [fullscreen, setFullscreen] = useState(false);
  const resizing = useRef<{ id: number; edge: string; x: number; y: number; width: number; height: number; offset: { x: number; y: number } } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const constrain = useCallback((point: { x: number; y: number }, size?: { width: number; height: number }) => {
    const board = boardRef.current, panel = panelRef.current;
    if (!board || !panel || fullscreen) return point;
    const width = size?.width ?? panel.offsetWidth, height = size?.height ?? panel.offsetHeight;
    const left = board.clientWidth - 20 - width, top = board.clientHeight - 70 - height;
    // Reserve the upper draft actions and the lower circuit-check action.
    return { x: Math.max(8 - left, Math.min(Math.max(8, board.clientWidth - width - 8) - left, point.x)), y: Math.max(58 - top, Math.min(Math.max(58, board.clientHeight - height - 70) - top, point.y)) };
  }, [boardRef, panelRef, fullscreen]);
  useEffect(() => {
    const clamp = () => setOffset(previous => { const next = constrain(previous); return next.x === previous.x && next.y === previous.y ? previous : next; });
    clamp(); const observer = new ResizeObserver(clamp);
    if (boardRef.current) observer.observe(boardRef.current);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [constrain, boardRef, panelRef, open]);
  useEffect(() => { setOpen(true); setTab("schematic"); }, [documentKey]);
  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [fullscreen]);
  function reset() { setZoom(1); setFrame(DEFAULT_FRAME); setOffset({ x: 0, y: 0 }); setFullscreen(false); }
  function endResize(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const start = resizing.current;
    if (!start || start.id !== event.pointerId) return;
    if (cancel) { setFrame({ width: start.width, height: start.height }); setOffset(start.offset); }
    resizing.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div ref={panelRef} className={`sim-diagram ${open ? "" : "is-collapsed"} ${dragging ? "is-dragging" : ""} ${fullscreen ? "is-fullscreen" : ""}`} data-window-scale="1.0" data-drawing-zoom={zoom} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? '图纸大图查看' : undefined} style={fullscreen ? { transform: 'none' } : { transform: `translate(${offset.x}px, ${offset.y}px)`, width: frame.width, height: open ? frame.height : undefined, maxWidth: 'calc(100% - 16px)', maxHeight: 'calc(100% - 132px)' }} onKeyDown={event => {
    if (fullscreen && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setFullscreen(false); }
    if (fullscreen && event.key === 'Tab') {
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(item => item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="sim-diagram-header" onDoubleClick={reset} onPointerDown={event => {
      if (fullscreen || event.button !== 0 || (event.target as Element).closest("button:not(.sim-diagram-drag)")) return;
      event.preventDefault(); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: offset.x, startY: offset.y };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    }} onPointerMove={event => { const start = drag.current; if (start?.id === event.pointerId) setOffset(constrain({ x: start.startX + event.clientX - start.x, y: start.startY + event.clientY - start.y })); }}
    onPointerUp={event => { if (drag.current?.id === event.pointerId) { drag.current = null; setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); } }}
    onPointerCancel={() => { drag.current = null; setDragging(false); }} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      <button className={tab === "schematic" ? "active" : ""} onClick={() => { setTab("schematic"); setOpen(true); }}>接线图</button>
      <button className={tab === "video" ? "active" : ""} onClick={() => { setTab("video"); setOpen(true); }}>教学视频</button>
      <button className="sim-diagram-drag" aria-label="拖动图纸窗口" title="拖动窗口；方向键移动，双击标题复位" onKeyDown={event => { const steps: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }; const step = steps[event.key]; if (step) { event.preventDefault(); event.stopPropagation(); setOffset(value => constrain({ x: value.x + step[0], y: value.y + step[1] })); } }}><GripHorizontal size={18}/></button>
      <button className="sim-diagram-reset" aria-label="复位图纸窗口" title="复位位置和大小" onClick={reset}><RotateCcw size={15}/></button>
      <button className="sim-diagram-fullscreen" aria-label={fullscreen ? "退出图纸大图" : "全屏查看图纸"} title={fullscreen ? "退出大图 · Esc" : "全屏查看图纸"} onClick={() => { setFullscreen(!fullscreen); setOpen(true); setTab('schematic'); }}>{fullscreen ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>
      <button className="sim-diagram-collapse" aria-label={open ? "收起图纸" : "展开图纸"} onClick={() => { setFullscreen(false); setOpen(!open); }}>{open ? <Minus size={19}/> : <Plus size={19}/>}</button>
    </div>
    {open && <><div className="sim-diagram-content"><div hidden={tab !== "schematic"} style={{ height: "100%" }}>{children}</div>{tab === "video" ? <ReferenceVideoPlayer video={video}/> : tab === "guide" ? <div className="sim-guide"><h3>从接线到运行</h3><ol><li>把元件拖入画布，拖动圆形端子连接导线。</li><li>同一端子可连接多根线；交叉导线不会自动连通。</li><li>选中导线后双击添加折点，拖动折点调整走线。</li><li>开始仿真后合闸，操作按钮观察元件联动。</li><li>点击「检查接线」，分别查看安全和课程判定。</li></ol><p>运行期间暂停接线编辑。高亮表示导线带电；离散教学模型不计算真实电流大小。</p></div> : null}</div>
    <div className="sim-diagram-tools"><button className="sim-diagram-guide" aria-label="选择图纸" title="选择图纸" disabled={selectionDisabled || !onChooseDrawing} onClick={onChooseDrawing}><BookOpen size={20}/></button><button className="sim-diagram-help" aria-label="操作说明" title="操作说明" onClick={() => setTab("guide")}>?</button><button className="sim-diagram-fit" aria-label="适应图纸" disabled={tab !== 'schematic'} title="适应窗口" onClick={() => { if (tab === 'schematic') setZoom(1); }}><Maximize2 size={16}/></button><output aria-label="图纸缩放比例">{Math.round(zoom * 100)}%</output><button aria-label="缩小图纸" disabled={tab !== 'schematic' || zoom <= 0.5} onClick={() => { if (tab === 'schematic') setZoom(Math.max(0.5, zoom - 0.25)); }}><ZoomOut size={20}/></button><button aria-label="放大图纸" disabled={tab !== 'schematic' || zoom >= 4} onClick={() => { if (tab === 'schematic') setZoom(Math.min(4, zoom + 0.25)); }}><ZoomIn size={20}/></button></div></>}
    {open && !fullscreen && Object.entries(EDGES).map(([edge, label]) => <button key={edge} className={`sim-diagram-resize sim-diagram-resize-${edge}`} aria-label={`调整图纸窗口${label}`} onPointerDown={event => {
      if (event.button !== 0 || !panelRef.current) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
      resizing.current = { id: event.pointerId, edge, x: event.clientX, y: event.clientY, width: panelRef.current.offsetWidth, height: panelRef.current.offsetHeight, offset };
      setDragging(true);
    }} onPointerMove={event => {
      const start = resizing.current, board = boardRef.current;
      if (!start || start.id !== event.pointerId || !board) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      const maxWidth = Math.max(180, board.clientWidth - 16), maxHeight = Math.max(160, board.clientHeight - 132);
      const width = Math.min(maxWidth, Math.max(Math.min(320, maxWidth), start.width + (edge.includes('w') ? -dx : edge.includes('e') ? dx : 0)));
      const height = Math.min(maxHeight, Math.max(Math.min(260, maxHeight), start.height + (edge.includes('n') ? -dy : edge.includes('s') ? dy : 0)));
      setFrame({ width, height });
      setOffset(constrain({ x: start.offset.x + (edge.includes('e') ? width - start.width : 0), y: start.offset.y + (edge.includes('s') ? height - start.height : 0) }, { width, height }));
    }} onPointerUp={event => endResize(event)} onPointerCancel={event => endResize(event, true)} onLostPointerCapture={() => { resizing.current = null; setDragging(false); }} />)}
  </div>;
}
