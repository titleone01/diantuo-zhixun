import { knifeSwitchShape } from './knife-switch-shape';

// Exact original q artwork transforms from the public source component. These
// illustration units are not physical millimetres or a mechanical simulation.
export const knifeSwitchMotionCss = `
.sim-knife-motion.is-closed .sim-knife-back{display:none}
.sim-knife-motion.is-closed .sim-knife-handle{transform:translateY(-40px)}
.sim-knife-motion.is-closed .sim-knife-blade-1{transform-origin:center;transform:rotate(15deg) translate(17px,18px)}
.sim-knife-motion.is-closed .sim-knife-blade-2{transform-origin:center;transform:rotate(15deg) translate(15px,0)}
.sim-knife-motion.is-closed .sim-knife-blade-3{transform-origin:center;transform:rotate(15deg) translate(12.5px,-18px)}
`;

export default function KnifeSwitchArtwork({ closed = false, className = '' }: { closed?: boolean; className?: string }) {
  return <svg className={`sim-device-artwork sim-knife-motion ${closed ? 'is-closed' : ''} ${className}`} viewBox={`0 0 ${knifeSwitchShape.width} ${knifeSwitchShape.height}`} role="img" aria-label={`三极刀开关（QS） · ${closed ? '已合闸' : '已分闸'}`} data-mechanism-state={closed ? 'closed' : 'open'}>
    <style>{knifeSwitchMotionCss}</style>
    <g dangerouslySetInnerHTML={{ __html: knifeSwitchShape.body }} />
  </svg>;
}
