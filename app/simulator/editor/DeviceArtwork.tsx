import type { ComponentType } from "../core/types";
import { getDefinition } from "../core/catalog";
import { terminalColor } from "./geometry";
import SwitchMotionArtwork from "./SwitchMotionArtwork";
import MotorMotionArtwork from "./MotorMotionArtwork";
import KnifeSwitchArtwork from "./KnifeSwitchArtwork";

export default function DeviceArtwork({ type, active = false, pressed = false, closed = false, direction, speed, className = "" }: { type: ComponentType; active?: boolean; pressed?: boolean; closed?: boolean; direction?: "forward" | "reverse"; speed?: "low" | "high"; className?: string }) {
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
  // This viewport crops the actual NO pole of the reference contactor, without drawing a substitute device.
  if (type === "auxiliary-no") return <svg className={`sim-device-artwork ${className}`} viewBox="112 31 39.5 137" role="img" aria-label="接触器常开辅助触点区域"><image href={`${import.meta.env.BASE_URL ?? "/"}sim-assets/contactor380.svg`} width="151.5" height="191.5" /></svg>;
  const asset = type === "relay380" ? "relay220" : type;
  return <img
    className={`sim-device-artwork ${active ? "is-active" : ""} ${className}`}
    src={`${import.meta.env.BASE_URL ?? "/"}sim-assets/${asset}.svg`}
    alt={getDefinition(type).name}
    draggable={false}
  />;
}
