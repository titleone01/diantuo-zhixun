import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './modal.css';

type Props = { children: ReactNode; title: string; onClose: () => void; backdropClass?: string; className?: string; role?: 'dialog' | 'alertdialog' };

/** Keep keyboard focus inside a modal and restore it to its trigger when closed. */
export default function Modal({ children, title, onClose, backdropClass = 'dt-modal-backdrop', className = 'dt-modal', role = 'dialog' }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = element.current;
    const controls = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? [])].filter(item => item.getClientRects().length);
    (controls()[0] ?? dialog)?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    // Native listener avoids forwarding modal keys to the React Flow/editor tree.
    dialog?.addEventListener('keydown', keys);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { dialog?.removeEventListener('keydown', keys); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(<div className={backdropClass}><button type="button" className="dt-modal-dismiss-layer" tabIndex={-1} aria-label={`关闭${title}`} onClick={onClose}/><div ref={element} className={`${className} dt-modal-focus-root`} role={role} aria-modal="true" aria-label={title} tabIndex={-1}>{children}</div></div>, document.body);
}
