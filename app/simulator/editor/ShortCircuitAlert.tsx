import { AlertTriangle, LocateFixed } from 'lucide-react';
import type { Diagnostic } from '../core/types';
import Modal from '../Modal';

export default function ShortCircuitAlert({ diagnostic, onClose, onLocate }: { diagnostic: Diagnostic; onClose: () => void; onLocate: () => void }) {
  return <Modal role="alertdialog" title="短路警告" onClose={onClose} backdropClass="sim-short-backdrop" className="sim-short-dialog">
    <AlertTriangle size={58} aria-hidden="true"/><h2 id="sim-short-title">短路警告</h2>
    <p id="sim-short-description">{diagnostic.message}</p><p className="sim-short-note">教学电源已中止。确认后可查看故障通路，结束仿真后修改接线。</p>
    <footer><button type="button" onClick={onLocate}><LocateFixed size={17}/>定位故障</button><button type="button" onClick={onClose}>确定</button></footer>
  </Modal>;
}
