import { componentSize, isLayoutObject } from "../core/catalog";
import type { CircuitDocument } from "../core/types";
import DeviceArtwork from "./DeviceArtwork";
import { curveControlPoints, wirePath, wireRoute } from "./geometry";

/** A read-only rendering of the published wiring snapshot, not its lesson answer. */
export default function DocumentPreview({ document, className = "" }: { document: CircuitDocument; className?: string }) {
  const boxes = document.components.map(component => ({ component, definition: componentSize(component) }));
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
  const x = boxes.length ? minX - 28 : 0;
  const y = boxes.length ? minY - 28 : 0;
  const right = boxes.length ? maxX + 28 : 500;
  const bottom = boxes.length ? maxY + 43 : 300;
  const device = ({ component, definition }: typeof boxes[number]) => <g key={component.id}>
    <foreignObject x={component.position.x} y={component.position.y} width={definition.width} height={definition.height}><div className="sim-preview-device" style={{ width: definition.width, height: definition.height }}><DeviceArtwork type={component.type} rotation={component.rotation} delayMs={component.settings?.delayMs} /></div></foreignObject>
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
    {!boxes.length && <text x="250" y="150" textAnchor="middle" fill="#8f9caf" fontSize="15">空白接线画布</text>}
  </svg>;
}
