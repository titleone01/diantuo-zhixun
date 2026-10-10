import RelayArtwork from "./RelayArtwork";
import type { ComponentType, ComponentRuntime } from "../core/types";
import { getDefinition, isTerminalStrip, terminalStripCapacity } from "../core/catalog";
import { terminalColor } from "./geometry";
import SwitchMotionArtwork from "./SwitchMotionArtwork";
import MotorMotionArtwork from "./MotorMotionArtwork";
import KnifeSwitchArtwork from "./KnifeSwitchArtwork";
import ContactorStateArtwork from "./ContactorStateArtwork";

export default function DeviceArtwork({ type, active = false, pressed = false, closed = false, direction, speed, className = "", rotation = 0, mirrored = false, pePositions = [], result, delayMs, running = false }: { type: ComponentType; active?: boolean; pressed?: boolean; closed?: boolean; direction?: "forward" | "reverse"; speed?: "low" | "high"; className?: string; rotation?: number; mirrored?: boolean; pePositions?: number[]; result?: ComponentRuntime; delayMs?: number; running?: boolean }) {
  if(rotation){const d=getDefinition(type);const translate=rotation===90?`${d.height}px, 0px`:rotation===180?`${d.width}px, ${d.height}px`:`0px, ${d.width}px`;return <div className="sim-rotated-artwork" style={{position:"absolute",left:0,top:0,width:d.width,height:d.height,transformOrigin:"0 0",transform:`translate(${translate}) rotate(${rotation}deg)`}}><DeviceArtwork type={type} active={active} pressed={pressed} closed={closed} direction={direction} speed={speed} mirrored={mirrored} pePositions={pePositions} result={result} delayMs={delayMs} running={running}/></div>;}
  if(type === "din-rail")return <div className="sim-device-artwork sim-rail-artwork" role="img" aria-label="安装导轨"/>;
  if(type === "relay380-jzc1-22" || type === "timer380" || type === "timer380-8pin")return <RelayArtwork type={type} active={active} result={result} delayMs={delayMs} running={running}/>;
  if (type === "contactor220" || type === "contactor380") return <ContactorStateArtwork type={type} active={active} className={className} />;
  if (type === "push-no" || type === "push-nc" || type === "breaker1" || type === "breaker3") return <SwitchMotionArtwork type={type} pressed={pressed} closed={closed} className={className} />;
  if (type === "push-latching-red" || type === "push-latching-green") return <SwitchMotionArtwork type={type} pressed={closed} className={className} />;
  if (type === "knife-switch3") return <KnifeSwitchArtwork closed={closed} className={className} />;
  if (type === "motor" || type === "motor-star-delta" || type === "motor-dahlander") return <MotorMotionArtwork type={type} active={active} direction={direction} speed={speed} className={className} />;
  if (type === "wire-duct" || type === "wire-duct-vertical") return <div className={`sim-device-artwork sim-duct-artwork ${type === "wire-duct-vertical" ? "is-vertical" : ""} ${className}`} role="img" aria-label={getDefinition(type).name}><span>线槽</span></div>;
  if (type === "supply") return <div className={`sim-device-artwork sim-supply-artwork ${className}`}>
    <span className="sim-supply-name" style={mirrored ? {top:"62%"} : undefined}>三相五线电源 · 380 / 220 V</span>
    <div className="sim-supply-ports">{getDefinition(type).terminals.map(terminal => <span key={terminal.id} style={{ left: `${terminal.x / getDefinition(type).width * 100}%`, top: `${(mirrored ? getDefinition(type).height-terminal.y : terminal.y) / getDefinition(type).height * 100}%` }}><b style={mirrored ? {bottom:"auto",top:9} : undefined}>{terminal.label}</b><i style={{ borderColor: terminalColor(terminal) }} /></span>)}</div>
  </div>;
  if (isTerminalStrip(type)) return <span className={`sim-device-artwork ${className}`} style={{position:"relative",display:"block",width:"100%",height:"100%"}}>
    <img src={`${import.meta.env.BASE_URL ?? "/"}sim-assets/${type}.svg`} alt={getDefinition(type).name} draggable={false} style={{display:"block",width:"100%",height:"100%"}} />
    {pePositions.map(position => <span key={position} aria-label={`第${position}位 PE`} style={{position:"absolute",left:`${(position-1)/terminalStripCapacity(type)*100}%`,top:0,width:`${100/terminalStripCapacity(type)}%`,height:"100%",boxShadow:"inset 0 0 0 3px #e3c530",background:"linear-gradient(135deg,transparent 40%,#219b6544 40%,#219b6544 60%,transparent 60%)",pointerEvents:"none"}}><b style={{position:"absolute",left:0,right:0,top:"42%",textAlign:"center",fontSize:8,color:"#fff2a0"}}>PE</b></span>)}
  </span>;
  if (type === "pe-terminal") return <span className={`sim-device-artwork sim-pe-artwork ${className}`}><img src={`${import.meta.env.BASE_URL ?? "/"}sim-assets/terminal.svg`} alt="保护接地端子" draggable={false} /></span>;
  const asset = type === "relay380" ? "relay220" : type;
  return <img
    className={`sim-device-artwork ${active ? "is-active" : ""} ${className}`}
    src={`${import.meta.env.BASE_URL ?? "/"}sim-assets/${asset}.svg`}
    alt={getDefinition(type).name}
    draggable={false}
  />;
}
