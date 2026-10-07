import RelayArtwork from "./RelayArtwork";
import type { ComponentType, ComponentRuntime } from "../core/types";
import { getDefinition } from "../core/catalog";
import { terminalColor } from "./geometry";
import SwitchMotionArtwork from "./SwitchMotionArtwork";
import MotorMotionArtwork from "./MotorMotionArtwork";
import KnifeSwitchArtwork from "./KnifeSwitchArtwork";
import ContactorStateArtwork from "./ContactorStateArtwork";

export default function DeviceArtwork({ type, active = false, pressed = false, closed = false, direction, speed, className = "", rotation = 0, result, delayMs, running = false }: { type: ComponentType; active?: boolean; pressed?: boolean; closed?: boolean; direction?: "forward" | "reverse"; speed?: "low" | "high"; className?: string; rotation?: number; result?: ComponentRuntime; delayMs?: number; running?: boolean }) {
  if(rotation){const d=getDefinition(type);const translate=rotation===90?`${d.height}px, 0px`:rotation===180?`${d.width}px, ${d.height}px`:`0px, ${d.width}px`;return <div className="sim-rotated-artwork" style={{position:"absolute",left:0,top:0,width:d.width,height:d.height,transformOrigin:"0 0",transform:`translate(${translate}) rotate(${rotation}deg)`}}><DeviceArtwork type={type} active={active} pressed={pressed} closed={closed} direction={direction} speed={speed}/></div>;}
  if(type === "din-rail")return <div className="sim-device-artwork sim-rail-artwork" role="img" aria-label="安装导轨"/>;
  if(type === "relay380-jzc1-22" || type === "timer380" || type === "timer380-8pin")return <RelayArtwork type={type} active={active} result={result} delayMs={delayMs} running={running}/>;
  if (type === "contactor220" || type === "contactor380") return <ContactorStateArtwork type={type} active={active} className={className} />;
  if (type === "push-no" || type === "push-nc" || type === "breaker1" || type === "breaker3") return <SwitchMotionArtwork type={type} pressed={pressed} closed={closed} className={className} />;
  if (type === "push-latching-red" || type === "push-latching-green") return <SwitchMotionArtwork type={type} pressed={closed} className={className} />;
  if (type === "knife-switch3") return <KnifeSwitchArtwork closed={closed} className={className} />;
  if (type === "motor" || type === "motor-star-delta" || type === "motor-dahlander") return <MotorMotionArtwork type={type} active={active} direction={direction} speed={speed} className={className} />;
  if (type === "wire-duct" || type === "wire-duct-vertical") return <div className={`sim-device-artwork sim-duct-artwork ${type === "wire-duct-vertical" ? "is-vertical" : ""} ${className}`} role="img" aria-label={getDefinition(type).name}><span>线槽</span></div>;
  if (type === "supply") return <div className={`sim-device-artwork sim-supply-artwork ${className}`}>
    <span className="sim-supply-name">三相五线电源 · 380 / 220 V</span>
    <div className="sim-supply-ports">{getDefinition(type).terminals.map(terminal => <span key={terminal.id} style={{ left: `${terminal.x / getDefinition(type).width * 100}%`, top: `${terminal.y / getDefinition(type).height * 100}%` }}><b>{terminal.label}</b><i style={{ borderColor: terminalColor(terminal) }} /></span>)}</div>
  </div>;
  if (type === "pe-terminal") return <span className={`sim-device-artwork sim-pe-artwork ${className}`}><img src={`${import.meta.env.BASE_URL ?? "/"}sim-assets/terminal.svg`} alt="保护接地端子" draggable={false} /></span>;
  const asset = type === "relay380" ? "relay220" : type;
  return <img
    className={`sim-device-artwork ${active ? "is-active" : ""} ${className}`}
    src={`${import.meta.env.BASE_URL ?? "/"}sim-assets/${asset}.svg`}
    alt={getDefinition(type).name}
    draggable={false}
  />;
}
