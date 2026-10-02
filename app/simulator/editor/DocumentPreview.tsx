import { componentSize } from "../core/catalog";
import type { CircuitDocument } from "../core/types";
import DeviceArtwork from "./DeviceArtwork";
import { curveControlPoints, wirePath, wireRoute } from "./geometry";

/** A read-only rendering of the published wiring snapshot, not its lesson answer. */
export default function DocumentPreview({ document, className = "" }: { document: CircuitDocument; className?: string }) {
  const boxes = document.components.map(component => ({ component, definition: componentSize(component) }));
  const wirePoints = document.wires.flatMap(wire => wire.style === "curve" ? curveControlPoints(document, wire) : wireRoute(document, wire));
  const x = boxes.length ? Math.min(...boxes.map(({ component }) => component.position.x), ...wirePoints.map(point => point.x)) - 28 : 0;
  const y = boxes.length ? Math.min(...boxes.map(({ component }) => component.position.y), ...wirePoints.map(point => point.y)) - 28 : 0;
  const right = boxes.length ? Math.max(...boxes.map(({ component, definition }) => component.position.x + definition.width), ...wirePoints.map(point => point.x)) + 28 : 500;
  const bottom = boxes.length ? Math.max(...boxes.map(({ component, definition }) => component.position.y + definition.height), ...wirePoints.map(point => point.y)) + 43 : 300;
  const device = ({ component, definition }: typeof boxes[number]) => <g key={component.id}>
    <foreignObject x={component.position.x} y={component.position.y} width={definition.width} height={definition.height}><div className="sim-preview-device" style={{ width: definition.width, height: definition.height }}><DeviceArtwork type={component.type} /></div></foreignObject>
    <text x={component.position.x + definition.width / 2} y={component.position.y + definition.height + 16} textAnchor="middle" fill="#536579" fontSize="10">{component.label}</text>
  </g>;
  return <svg className={`sim-document-preview ${className}`} viewBox={`${x} ${y} ${Math.max(100, right - x)} ${Math.max(100, bottom - y)}`} role="img" aria-label={`${document.title}的实际接线快照`}>
    {boxes.filter(({ component }) => component.type.startsWith("wire-duct")).map(device)}
    {document.wires.map(wire => <path key={wire.id} d={wirePath(document, wire)} fill="none" stroke={wire.color} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />)}
    {boxes.filter(({ component }) => !component.type.startsWith("wire-duct")).map(device)}
    {!boxes.length && <text x="250" y="150" textAnchor="middle" fill="#8f9caf" fontSize="15">空白接线画布</text>}
  </svg>;
}
