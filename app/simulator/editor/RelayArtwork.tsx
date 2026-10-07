import { getDefinition } from "../core/catalog";
import type { ComponentRuntime, ComponentType } from "../core/types";

export function timerDisplay(ms: number) {
  const seconds=Math.ceil(Math.max(0,ms)/1000);
  return `${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
}
export default function RelayArtwork({type,active=false,result,delayMs=3000,running=false}:{type:ComponentType;active?:boolean;result?:ComponentRuntime;delayMs?:number;running?:boolean}) {
  const definition=getDefinition(type),timer=type!=="relay380-jzc1-22";
  const remaining=running&&result?.active?result.remainingMs??delayMs:delayMs;
  if(!timer)return <svg className="sim-device-artwork" viewBox="0 0 151.5 191.5" role="img" aria-label={definition.name}>
    <rect x="1" y="1" width="149.5" height="189.5" rx="6" fill="#303538" stroke="#111" strokeWidth="2"/>
    <rect x="5" y="64" width="141.5" height="87" fill="#e9ecef" stroke="#1f252a"/>
    <path d="M8 94H143" stroke="#148dc7" strokeWidth="3"/>
    <text x="75.75" y="84" textAnchor="middle" fontSize="13" fill="#303538">中间继电器 KA</text>
    <rect x="17" y="111" width="17" height="20" rx="2" fill={active?"#d83333":"#181d21"}/>
    <text x="87" y="123" textAnchor="middle" fontSize="11">JZC1-22 风格</text>
    <text x="86" y="140" textAnchor="middle" fontSize="9">380V · 教学示意</text>
    {definition.terminals.map(t=><g key={t.id}><circle cx={t.x} cy={t.y} r="7" fill="#16191c" stroke={t.electrical==="coil"?"#e75b5b":t.label.includes("NC")?"#e8bf38":"#53be78"} strokeWidth="3"/><text x={t.x} y={t.y===14?29:t.y<100?60:187} textAnchor="middle" fill="#f5f5f5" fontSize="8">{t.label}</text></g>)}
  </svg>;
  return <svg className="sim-device-artwork" viewBox="0 0 201.5 201.5" role="img" aria-label={definition.name}>
    <rect x="1" y="1" width="199.5" height="199.5" rx="9" fill="#d9dbda" stroke="#303536" strokeWidth="2"/>
    <rect x="27" y="53" width="147.5" height="68" rx="5" fill="#414141" stroke="#111" strokeWidth="3"/>
    <text data-timer-display="true" x="100.75" y="101" textAnchor="middle" fontFamily="monospace" fontSize="40" fill="#ff2929">{timerDisplay(remaining)}</text>
    <text data-timer-seconds="true" x="100.75" y="115" textAnchor="middle" fontSize="9" fill="#ffaaaa">{(Math.max(0,remaining)/1000).toFixed(3)} s</text>
    <circle data-timer-indicator="UP" data-lit={running&&result?.state==="done"} cx="13" cy="76" r="5" fill={running&&result?.state==="done"?"#33ce6a":"#343e37"}/>
    <text x="13" y="91" textAnchor="middle" fontSize="8">UP</text>
    <circle data-timer-indicator="ON" data-lit={running&&!!result?.active} cx="188.5" cy="76" r="5" fill={running&&result?.active?"#ed9c2e":"#403a2c"}/>
    <text x="188.5" y="91" textAnchor="middle" fontSize="8">ON</text>
    <text x="100.75" y="138" textAnchor="middle" fontSize="12">通电延时时间继电器</text>
    {definition.terminals.map(t=><g key={t.id}><circle cx={t.x} cy={t.y} r="7" fill="#232628" stroke={t.electrical==="coil"?"#e75b5b":t.label.includes("COM")?"#efa259":t.label.includes("NC")?"#edc846":"#65c889"} strokeWidth="3"/><text data-timer-terminal={t.id} x={t.x} y={t.y<100?28:175} textAnchor="middle" fontSize="10" fontWeight="600">{t.label}</text></g>)}
  </svg>;
}
