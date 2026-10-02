import { useEffect, useRef } from 'react';
import { AlertTriangle, LocateFixed } from 'lucide-react';
import type { Diagnostic } from '../core/types';

export default function ShortCircuitAlert({ diagnostic, onClose, onLocate }: { diagnostic: Diagnostic; onClose: () => void; onLocate: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <div className="sim-short-backdrop"><div ref={dialog} className="sim-short-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sim-short-title" aria-describedby="sim-short-description" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault(); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
    }
  }}>
    <AlertTriangle size={58} aria-hidden="true"/><h2 id="sim-short-title">短路警告</h2>
    <p id="sim-short-description">{diagnostic.message}</p><p className="sim-short-note">教学电源已中止。确认后可查看故障通路，结束仿真后修改接线。</p>
    <footer><button type="button" onClick={onLocate}><LocateFixed size={17}/>定位故障</button><button type="button" autoFocus onClick={onClose}>确定</button></footer>
  </div></div>;
}
