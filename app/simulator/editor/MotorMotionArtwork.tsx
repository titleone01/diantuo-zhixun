import "./motor-motion.css";

export type MotorMotionArtworkProps = {
  type: "motor" | "motor-star-delta" | "motor-dahlander";
  active: boolean;
  direction?: "forward" | "reverse";
  speed?: "low" | "high";
  className?: string;
};

/** Only the three original blade paths move; electrical geometry and the original hub remain fixed. */
export default function MotorMotionArtwork({ type, active, direction, speed, className = "" }: MotorMotionArtworkProps) {
  const asset = type === "motor" ? "motor" : "motor6";
  const height = type === "motor" ? 191.5 : 211.5;
  const centerX = type === "motor" ? 48.499 : 48.498;
  const base = `${import.meta.env.BASE_URL ?? "/"}sim-assets/motion/${asset}`;
  const name = type === "motor" ? "三相异步电机" : type === "motor-star-delta" ? "六端子电机" : "双速电机";
  const directionText = direction === "reverse" ? "反转" : direction === "forward" ? "正转" : "运行";
  const stateText = active ? `${directionText}${speed === "high" ? " · 高速" : speed === "low" ? " · 低速" : ""}` : "停止";

  return <svg
    className={`sim-device-artwork sim-motor-motion-artwork ${active ? "is-active" : ""} ${className}`}
    viewBox={`0 0 280.5 ${height}`}
    preserveAspectRatio="xMidYMid meet"
    role="img"
    aria-label={`${name} · ${stateText}`}
    data-motor-active={active}
    data-motor-direction={direction}
    data-motor-speed={speed}
  >
    <title>{name} · {stateText}</title>
    <image href={`${base}-body.svg`} width="280.5" height={height} />
    <g className="sim-motor-motion-rotor" style={{
      transformOrigin: `${centerX}px 115.499px`,
      animationDirection: direction === "reverse" ? "reverse" : "normal",
      // These rates distinguish state visually; they are not mechanical RPM values.
      animationDuration: speed === "high" ? "0.4s" : speed === "low" ? "0.8s" : "0.6s",
    }}>
      <image href={`${base}-blades.svg`} width="280.5" height={height} />
    </g>
    <image href={`${base}-hub.svg`} width="280.5" height={height} />
    <text className="sim-motor-motion-static" x={centerX} y="180" textAnchor="middle">{stateText}</text>
  </svg>;
}
