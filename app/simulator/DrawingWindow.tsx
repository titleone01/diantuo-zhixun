"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DrawingViewer from "./DrawingViewer";
import type { DrawingPreview } from "./drawing-preview";
import "./drawing-window.css";

type Target = { window: Window; container: HTMLDivElement; scope: string; pinned: DrawingPreview | null };

/** One owned, same-origin popup lives with the app, including page navigation.
 * Its private media continue to use the normal authenticated URLs. */
export function useDrawingWindow(preview: DrawingPreview | null, scope: string, onNotice: (message: string) => void) {
  const [target, setTarget] = useState<Target | null>(null);
  const owned = useRef<Window | null>(null);
  const shown = target?.pinned ?? preview;
  const child = target?.window, targetScope = target?.scope;
  const close = useCallback(() => {
    const child = owned.current; owned.current = null;
    child?.close(); setTarget(null);
  }, []);
  useLayoutEffect(() => () => {
    owned.current?.close(); owned.current = null;
  }, [scope]);
  const open = useCallback(() => {
    if (!preview) { onNotice("当前没有可打开的图纸，请先选择或上传图纸。"); return; }
    if (owned.current && !owned.current.closed && target?.scope === scope) { owned.current.focus(); return; }
    const child = window.open("", `diantuo-drawing-${crypto.randomUUID()}`, "popup,width=900,height=760,resizable=yes,scrollbars=yes");
    if (!child) { onNotice("浏览器未允许打开独立图纸窗口，仍可使用页内图纸；允许弹窗后再次点击。"); return; }
    try {
      const doc = child.document;
      doc.title = preview.title;
      const base = doc.createElement("base"); base.href = document.baseURI; doc.head.appendChild(base);
      for (const source of document.head.querySelectorAll('link[rel="stylesheet"],style')) {
        const copy = source.cloneNode(true) as HTMLElement;
        if (source instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = source.href;
        doc.head.appendChild(copy);
      }
      doc.body.style.margin = "0";
      const container = doc.createElement("div"); doc.body.appendChild(container);
      owned.current = child;
      setTarget({ window: child, container, scope, pinned: null }); child.focus();
    } catch {
      child.close(); onNotice("独立窗口初始化失败，页内图纸已保留。");
    }
  }, [preview, scope, target?.scope, onNotice]);
  useEffect(() => {
    if (!child || targetScope !== scope) return;
    const left = () => { if (owned.current === child) owned.current = null; setTarget(current => current?.window === child ? null : current); };
    const parentLeft = () => child.close();
    child.addEventListener("pagehide", left);
    window.addEventListener("pagehide", parentLeft);
    return () => { child.removeEventListener("pagehide", left); window.removeEventListener("pagehide", parentLeft); };
  }, [child, targetScope, scope]); // pinning does not recreate or close the window
  useEffect(() => {
    if (targetScope === scope && shown && owned.current && !owned.current.closed) owned.current.document.title = shown.title;
  }, [targetScope, scope, shown]);
  const drawingWindow = target && target.scope === scope && !target.window.closed ? createPortal(
    <main className="dt-drawing-window" aria-label="独立图纸窗口">
      <header><strong>{shown?.title ?? "当前没有图纸"}</strong><button type="button" disabled={!shown} aria-pressed={!!target.pinned} onClick={() => setTarget(current => current ? { ...current, pinned: current.pinned ? null : shown } : current)}>{target.pinned ? "恢复跟随" : "锁定当前图纸"}</button><button type="button" onClick={close}>关闭窗口</button></header>
      <p className="dt-drawing-window-state" role="status">{target.pinned ? "已锁定当前图纸" : "跟随主页面当前图纸"} · 在此窗口缩放不改变主页面</p>
      {shown ? <DrawingViewer key={shown.key} src={shown.src} type={shown.type} title={shown.title} contentKey={shown.key}>{shown.content}</DrawingViewer> : <p>当前没有图纸，请在主页面选择图纸。</p>}
    </main>, target.container) : null;
  return { openDrawingWindow: open, drawingWindow };
}
