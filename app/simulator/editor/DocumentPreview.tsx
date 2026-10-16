import { componentSize, isLayoutObject, resolveTerminal } from "../core/catalog";
import { getWiringNets } from "../core/wire-nets";
import type { CircuitDocument } from "../core/types";
import DeviceArtwork from "./DeviceArtwork";
import { curveControlPoints, wirePath, wireRoute } from "./geometry";

/** A read-only rendering of the published wiring snapshot, not its lesson answer. */
export default function DocumentPreview({ document, className = "" }: { document: CircuitDocument; className?: string }) {
  const boxes = document.components.map(component => ({ component, definition: componentSize(component) }));
  const numbers = getWiringNets(document).filter(net => net.numbers.length).flatMap(net => net.terminalIds.map(key => {
    const [componentId, terminalId] = key.split("::");
    const { terminal, world } = resolveTerminal(document, { componentId, terminalId });
    const x = world.x + (terminal.side === "left" ? -12 : terminal.side === "right" ? 12 : 9);
    const y = world.y + (terminal.side === "top" ? -15 : terminal.side === "bottom" ? 24 : -8);
    return { key, x, y, text: net.numbers.join(" / ") };
  }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const { component, definition } of boxes) {
    include(component.position.x, component.position.y);
    include(component.position.x + definition.width, component.position.y + definition.height);
  }
  // Valid documents can contain over 500,000 routed points. Accumulate bounds
  // without passing that collection as function arguments or retaining it all.
  for (const wire of document.wires) for (const point of wire.style === "curve" && wire.routing !== "duct" ? curveControlPoints(document, wire) : wireRoute(document, wire)) include(point.x, point.y);
  for (const label of numbers) { include(label.x - 12, label.y - 14); include(label.x + Math.min(180, label.text.length * 7), label.y + 5); }
  const x = boxes.length ? minX - 28 : 0;
  const y = boxes.length ? minY - 28 : 0;
  const right = boxes.length ? maxX + 28 : 500;
  const bottom = boxes.length ? maxY + 43 : 300;
  const device = ({ component, definition }: typeof boxes[number]) => <g key={component.id}>
    <foreignObject x={component.position.x} y={component.position.y} width={definition.width} height={definition.height}><div className="sim-preview-device" style={{ width: definition.width, height: definition.height }}><DeviceArtwork type={component.type} rotation={component.rotation} mirrored={component.mirrored} pePositions={component.pePositions} terminalLabels={component.terminalLabels} delayMs={component.settings?.delayMs} /></div></foreignObject>
    <text x={component.position.x + definition.width / 2} y={component.position.y + definition.height + 16} textAnchor="middle" fill="#536579" fontSize="10">{component.label}</text>
  </g>;
  return <svg className={`sim-document-preview ${className}`} viewBox={`${x} ${y} ${Math.max(100, right - x)} ${Math.max(100, bottom - y)}`} role="img" aria-label={`${document.title}的实际接线快照`}>
    {boxes.filter(({ component }) => isLayoutObject(component.type)).map(device)}
    {document.wires.map(wire => <path key={wire.id} d={wirePath(document, wire)} fill="none" stroke={wire.color} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />)}
    {boxes.filter(({ component }) => !isLayoutObject(component.type)).map(device)}
    {boxes.filter(({ component }) => !isLayoutObject(component.type)).map(({component, definition}) => <g key={`leads-${component.id}`}>
      <defs><clipPath id={`preview-leads-${component.id}`}><rect x={component.position.x} y={component.position.y} width={definition.width} height={definition.height}/></clipPath></defs>
      <g clipPath={`url(#preview-leads-${component.id})`}>{document.wires.filter(wire => wire.from.componentId === component.id || wire.to.componentId === component.id).map(wire => <path key={wire.id} d={wirePath(document,wire)} fill="none" stroke={wire.color} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"/>)}</g>
    </g>)}
    {numbers.map(label => <text key={label.key} data-terminal-key={label.key} data-wire-number={label.text} x={label.x} y={label.y} fill="#153e72" stroke="#edf5ff" strokeWidth={3} paintOrder="stroke" fontSize={11} fontWeight={600}>{label.text}</text>)}
    {!boxes.length && <text x="250" y="150" textAnchor="middle" fill="#8f9caf" fontSize="15">空白接线画布</text>}
  </svg>;
}
