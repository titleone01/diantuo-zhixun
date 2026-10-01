"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ExternalLink, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import PdfDrawing from "./PdfDrawing";
import "./drawing-viewer.css";

type Props = { src: string; title: string; type?: string };

/** A read-only viewer: private media keep their original authenticated URL. */
export default function DrawingViewer({ src, title, type }: Props) {
  const isPdf = type === "application/pdf";
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    setZoom(1); setRatio(null); setImageState("loading"); drag.current = null; setDragging(false);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  }, [src]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = content.current;
    if (!isPdf || !element) return;
    // PdfDrawing renders each page locally. Its actual canvas dimensions let
    // fitting follow page orientation without loading a second PDF document.
    const measure = () => {
      const canvas = element.querySelector("canvas");
      if (!canvas?.width || !canvas.height) return;
      const next = canvas.width / canvas.height;
      setRatio(previous => previous === null || Math.abs(previous - next) > 0.005 ? next : previous);
    };
    measure(); const observer = new MutationObserver(measure);
    observer.observe(element, { subtree: true, attributes: true, attributeFilter: ["width", "height"], childList: true });
    return () => observer.disconnect();
  }, [src, isPdf]);

  const availableWidth = Math.max(1, bounds.width - 24);
  const availableHeight = Math.max(1, bounds.height - 24 - (isPdf ? 76 : 0));
  const fittedWidth = ratio ? Math.min(availableWidth, availableHeight * ratio) : availableWidth;
  function fit() { setZoom(1); viewport.current?.scrollTo({ left: 0, top: 0 }); }
  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.pointerType === "touch" || (event.target as Element).closest("button,a,input,select,textarea")) return;
    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight) return;
    event.preventDefault(); element.focus({ preventScroll: true });
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    element.setPointerCapture(event.pointerId); setDragging(true);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = start.left - (event.clientX - start.x);
    event.currentTarget.scrollTop = start.top - (event.clientY - start.y);
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <section className="dt-drawing-viewer" aria-label={`${title}大图查看`} style={{ "--drawing-viewport-width": `${availableWidth}px` } as CSSProperties}>
    <div className="dt-drawing-viewer-toolbar">
      <button type="button" aria-label="缩小原图" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.25))}><ZoomOut size={17}/></button>
      <output aria-live="polite" aria-label="图纸缩放比例">{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label="放大原图" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))}><ZoomIn size={17}/></button>
      <button type="button" onClick={fit}><Maximize2 size={15}/>适应窗口</button>
      <a href={src} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>查看原图</a>
    </div>
    <div ref={viewport} className={`dt-drawing-viewer-viewport${dragging ? " is-dragging" : ""}`} role="region" aria-label="可滚动和拖动的图纸" tabIndex={0}
      onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      <div ref={content} className="dt-drawing-viewer-content" style={{ width: bounds.width ? fittedWidth * zoom : "100%" }}>
        {isPdf ? <PdfDrawing src={src} title={title}/> : <img key={src} src={src} alt={title} draggable={false}
          onLoad={event => { const image = event.currentTarget; setRatio(image.naturalWidth / Math.max(1, image.naturalHeight)); setImageState("ready"); }}
          onError={() => setImageState("error")}/>}
      </div>
      {!isPdf && imageState !== "ready" && <p className="dt-drawing-viewer-message" role={imageState === "error" ? "alert" : "status"}>{imageState === "error" ? "图纸未能加载，请检查登录状态或重新打开。" : "正在加载原图…"}</p>}
    </div>
    <p className="dt-drawing-viewer-hint">100% 为适应窗口 · 放大后可按住鼠标拖看，也可滚动查看</p>
  </section>;
}
