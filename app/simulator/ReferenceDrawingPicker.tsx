'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { getReferenceDrawing, REFERENCE_DRAWINGS, referenceDrawingImageUrl } from './core/reference-drawings';
import './reference-drawing-picker.css';

type Props = {
  open: boolean;
  selectedId?: number;
  onSelect: (drawingId: number) => void;
  onClose: () => void;
  disabled?: boolean;
};
const PAGE_SIZE = 9;

export default function ReferenceDrawingPicker(props: Props) {
  return props.open ? <ReferenceDrawingPickerContent key={props.selectedId ?? 'none'} {...props}/> : null;
}
function ReferenceDrawingPickerContent({ open, selectedId, onSelect, onClose, disabled = false }: Props) {
  const [candidate, setCandidate] = useState<number | null>(() => selectedId !== undefined && getReferenceDrawing(selectedId) ? selectedId : null);
  const [query, setQuery] = useState('');
  const [keyword, setKeyword] = useState('');
  const [composing, setComposing] = useState(false);
  const [page, setPage] = useState(1);
  const searchInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeAction = useRef(onClose);
  useLayoutEffect(() => { closeAction.current = onClose; }, [onClose]);
  const id = useId();

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const trigger = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    const keyboard = (event: KeyboardEvent) => {
      // Stop portal keys before they reach the editor's wiring shortcuts.
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeAction.current(); return; }
      if (event.key !== 'Tab' || !element) return;
      const controls = Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); element.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (dialog.current && event.target && !dialog.current.contains(event.target as Node)) searchInput.current?.focus();
    };
    document.addEventListener('focusin', keepFocusInside);
    element?.addEventListener('keydown', keyboard);
    searchInput.current?.focus();
    return () => {
      document.removeEventListener('focusin', keepFocusInside);
      element?.removeEventListener('keydown', keyboard);
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open || composing) return;
    const timer = setTimeout(() => { setKeyword(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [query, composing, open]);

  if (!open || typeof document === 'undefined') return null;
  const found = REFERENCE_DRAWINGS.filter(drawing => drawing.title.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  function confirm() {
    if (disabled || candidate === null || !getReferenceDrawing(candidate)) return;
    onSelect(candidate); onClose();
  }

  return createPortal(<div className="dt-reference-picker-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) event.preventDefault(); }}>
    <div ref={dialog} className="dt-reference-picker" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={`${id}-title`}>
      <header><h2 id={`${id}-title`}>图纸选择</h2><label className="dt-reference-picker-search"><Search size={18}/><input ref={searchInput} aria-label="搜索参考图纸" placeholder="请输入图纸名称" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={event => { setQuery(event.currentTarget.value); setComposing(false); }}/></label><button type="button" className="dt-reference-picker-close" aria-label="关闭图纸选择" onClick={onClose}><X size={20}/></button></header>
      <div className="dt-reference-picker-content"><div className="dt-reference-picker-grid" role="radiogroup" aria-label="选择参考图纸">{found.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(drawing => <label className={`dt-reference-picker-card ${candidate === drawing.id ? 'selected' : ''}`} key={drawing.id}>
        <input type="radio" name={`${id}-drawing`} value={drawing.id} checked={candidate === drawing.id} disabled={disabled} onChange={() => { if (!disabled) setCandidate(drawing.id); }}/><img src={referenceDrawingImageUrl(drawing.id, import.meta.env.BASE_URL || '/')} alt="" loading="lazy"/><span>{drawing.title}</span>
      </label>)}</div>{!found.length && <p className="dt-reference-picker-empty" role="status">没有找到匹配图纸</p>}</div>
      <footer><nav className="dt-reference-picker-pages" aria-label="参考图纸分页"><button type="button" disabled={currentPage === 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft size={16}/>上一页</button>{Array.from({ length: pages }, (_, index) => <button type="button" key={index} aria-current={currentPage === index + 1 ? 'page' : undefined} onClick={() => setPage(index + 1)}>{index + 1}</button>)}<button type="button" disabled={currentPage === pages} onClick={() => setPage(value => Math.min(pages, value + 1))}>下一页<ChevronRight size={16}/></button><span>共 {found.length} 张</span></nav><div className="dt-reference-picker-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="dt-reference-picker-confirm" disabled={disabled || candidate === null} onClick={confirm}>确认</button></div></footer>
    </div>
  </div>, document.body);
}
