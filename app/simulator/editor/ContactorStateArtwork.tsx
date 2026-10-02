import { contactorStateShapes } from './contactor-state-shapes';

/** Teaching status uses the original four windows; terminals and body do not move. */
export default function ContactorStateArtwork({ type, active, className = '' }: { type: 'contactor220' | 'contactor380'; active: boolean; className?: string }) {
  return <svg className={`sim-device-artwork sim-contactor-artwork ${active ? 'is-engaged' : ''} ${className}`} viewBox="0 0 151.5 191.5" role="img" aria-label={`交流接触器 · ${active ? '吸合' : '释放'}`} data-contactor-engaged={active}>
    <g dangerouslySetInnerHTML={{ __html: contactorStateShapes[type] }} />
    {active && <g className="sim-contactor-state-text" aria-hidden="true"><text x="57.5" y="98" textAnchor="middle">吸</text><text x="94.5" y="98" textAnchor="middle">合</text></g>}
  </svg>;
}
