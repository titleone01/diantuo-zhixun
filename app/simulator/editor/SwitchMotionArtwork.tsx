import { switchMotionShapes } from './switch-motion-shapes';
import { getDefinition } from '../core/catalog';

type SwitchType = keyof typeof switchMotionShapes;

export default function SwitchMotionArtwork({ type, pressed = false, closed = false, className = '' }: { type: SwitchType; pressed?: boolean; closed?: boolean; className?: string }) {
  const shape = switchMotionShapes[type];
  const breaker = type === 'breaker1' || type === 'breaker3';
  return <svg className={`sim-device-artwork sim-switch-motion ${pressed ? 'is-depressed' : ''} ${closed ? 'is-closed' : ''} ${className}`} viewBox={`0 0 ${shape.width} ${shape.height}`} role="img" aria-label={`${getDefinition(type).name} · ${breaker ? closed ? '合闸，手柄在上' : '分闸，手柄在下' : pressed ? '已按下' : '已弹起'}`} data-mechanism-state={breaker ? closed ? 'closed' : 'open' : pressed ? 'pressed' : 'released'}>
    <g dangerouslySetInnerHTML={{ __html: shape.body }} />
    {breaker && <text className="sim-breaker-position" x={shape.width / 2} y={closed ? 98 : 124} textAnchor="middle" fill="white" fontSize="19" fontWeight="700" aria-hidden="true">{closed ? 'I' : 'O'}</text>}
  </svg>;
}
