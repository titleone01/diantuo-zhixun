"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import "./pdf-drawing.css";

type Props = { src: string; title?: string };

/** Render locally with PDF.js; no browser PDF extension or native iframe is required. */
export default function PdfDrawing({ src, title = "PDF 接线图" }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [state, setState] = useState<"loading" | "rendering" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(1, Math.floor(element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    setPdf(null); setPageNumber(1); setState("loading"); setError("");
    void (async () => {
      try {
        // Kept inside the browser effect so SSR never evaluates PDF.js DOM APIs.
        const pdfjs = await import("pdfjs-dist");
        if (!active) return;
        const base = import.meta.env.BASE_URL ?? "/";
        const assets = `${base.endsWith("/") ? base : `${base}/`}sim-assets/pdfjs/`;
        pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.mjs?v=${pdfjs.version}`;
        loadingTask = pdfjs.getDocument({
          url: src,
          withCredentials: true,
          cMapUrl: `${assets}cmaps/`, cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/`,
        });
        const loaded = await loadingTask.promise;
        if (active) setPdf(loaded);
      } catch (reason) {
        if (!active) return;
        const detail = reason instanceof Error ? reason.message : "文件无法读取";
        setError(`PDF 加载失败：${detail}`); setState("error");
      }
    })();
    return () => { active = false; void loadingTask?.destroy().catch(() => {}); };
  }, [src, retry]);

  useEffect(() => {
    if (!pdf || !width) return;
    let active = true;
    let task: RenderTask | undefined;
    setState("rendering"); setError("");
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (!active) return;
        const original = page.getViewport({ scale: 1 });
        const displayScale = width / original.width;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: displayScale * pixelRatio });
        // Each render owns a canvas, so rapid page/size changes never render concurrently into one canvas.
        const buffer = document.createElement("canvas");
        buffer.width = Math.max(1, Math.ceil(viewport.width));
        buffer.height = Math.max(1, Math.ceil(viewport.height));
        task = page.render({ canvas: buffer, viewport });
        await task.promise;
        if (!active || !canvas.current) return;
        const target = canvas.current;
        target.width = buffer.width; target.height = buffer.height;
        const context = target.getContext("2d");
        if (!context) throw new Error("浏览器不支持二维画布");
        context.drawImage(buffer, 0, 0);
        setState("ready");
      } catch (reason) {
        if (!active) return;
        setError(`PDF 页面显示失败：${reason instanceof Error ? reason.message : "无法渲染"}`);
        setState("error");
      }
    })();
    return () => { active = false; task?.cancel(); };
  }, [pdf, pageNumber, width]);

  return <div className="dt-pdf-drawing" ref={container} data-pdf-state={state} data-pdf-page={pageNumber} data-pdf-pages={pdf?.numPages ?? 0}>
    <div className="dt-pdf-pagination"><button type="button" aria-label="PDF 上一页" disabled={!pdf || pageNumber <= 1} onClick={() => setPageNumber(page => Math.max(1, page - 1))}>上一页</button><span aria-live="polite">{pdf ? `${pageNumber} / ${pdf.numPages} 页` : "PDF 图纸"}</span><button type="button" aria-label="PDF 下一页" disabled={!pdf || pageNumber >= pdf.numPages} onClick={() => setPageNumber(page => Math.min(pdf?.numPages ?? 1, page + 1))}>下一页</button></div>
    <div className="dt-pdf-stage" aria-busy={state === "loading" || state === "rendering"}>
      <canvas ref={canvas} role="img" aria-label={`${title}，第 ${pageNumber} 页`} />
      {state === "error" ? <div className="dt-pdf-message" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新加载 PDF</button></div> : state !== "ready" && <p className="dt-pdf-message" role="status">{state === "loading" ? "正在加载 PDF…" : "正在绘制图纸…"}</p>}
    </div>
    <a className="dt-pdf-original" href={src} target="_blank" rel="noreferrer">查看 PDF 原文件</a>
  </div>;
}
