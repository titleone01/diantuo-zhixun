import { useState } from "react";
import { BaseEdge, EdgeLabelRenderer, useReactFlow, type Edge, type EdgeProps } from "@xyflow/react";
import type { CircuitDocument, CircuitWire, Point } from "../core/types";
import { wireEndpoints, wirePath, wireRoute } from "./geometry";
import { ductWireRoute } from "./duct-routing";

export type WireData = {
  document: CircuitDocument;
  wire: CircuitWire;
  running: boolean;
  readOnly?: boolean;
  highlighted: boolean;
  energized: boolean;
  onWaypoints: (wireId: string, points: Point[]) => void;
};
export type ElectricalEdge = Edge<WireData, "electrical">;

export default function WireEdge({ id, data, selected }: EdgeProps<ElectricalEdge>) {
  const flow = useReactFlow();
  const [dragged, setDragged] = useState<{ index: number; point: Point } | null>(null);
  if (!data) return null;
  const points = [...(data.wire.waypoints ?? [])];
  if (dragged) points[dragged.index] = dragged.point;
  const wire = { ...data.wire, waypoints: points };
  const endpoints = wireEndpoints(data.document, wire);
  const path = wirePath(data.document, wire);
  const route = wireRoute(data.document, wire);
  const longest = route.slice(1).map((point, index) => ({ from: route[index], to: point, length: Math.abs(point.x - route[index].x) + Math.abs(point.y - route[index].y) })).sort((a, b) => b.length - a.length)[0];
  const anchor = longest ? { x: (longest.from.x + longest.to.x) / 2, y: (longest.from.y + longest.to.y) / 2 } : endpoints.from;
  const updatePoint = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setDragged({ index, point });
  };
  return <g
    className={`sim-wire ${selected ? "is-selected" : ""} ${data.highlighted ? "has-diagnostic" : ""} ${data.energized ? "is-energized" : ""}`}
    data-wire-id={id}
    data-from-terminal={`${wire.from.componentId}::${wire.from.terminalId}`}
    data-to-terminal={`${wire.to.componentId}::${wire.to.terminalId}`}
    data-from-world={JSON.stringify(endpoints.from)}
    data-to-world={JSON.stringify(endpoints.to)}
    data-routing={wire.routing}
    data-routing-status={wire.routing === "duct" ? ductWireRoute(data.document, wire).status : "manual"}
  >
    {(selected || data.highlighted || data.energized) && <path className="sim-wire-outline" d={path} fill="none" stroke={selected ? "#3478f6" : data.highlighted ? "#ef4444" : "#f1be32"} strokeWidth={selected ? 9 : 7} strokeOpacity={selected || data.highlighted ? 0.65 : 0.4} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
    <BaseEdge id={id} path={path} interactionWidth={18} style={{ stroke: wire.color, strokeWidth: selected ? 4 : 3, opacity: 1, vectorEffect: "non-scaling-stroke", strokeLinecap: "round", strokeLinejoin: "round" }} />
    {selected && [endpoints.from,endpoints.to].map((point,index)=><circle key={index} className="sim-wire-selected-endpoint" cx={point.x} cy={point.y} r={5} fill="white" stroke="#3478f6" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
    {selected && !data.running && !data.readOnly && wire.routing !== "duct" && (!wire.style || wire.style === "orthogonal") && <EdgeLabelRenderer>
      {points.map((point, index) => <button
        key={index}
        className="sim-wire-waypoint nodrag nopan"
        style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
        aria-label={`拖动导线折点 ${index + 1}`}
        title="拖动调整走线，双击移除折点"
        onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDragged({ index, point }); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updatePoint(event, index); }}
        onPointerUp={event => {
          event.stopPropagation();
          const updated = [...points];
          updated[index] = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          data.onWaypoints(id, updated);
          setDragged(null);
        }}
        onPointerCancel={() => setDragged(null)}
        onDoubleClick={event => { event.stopPropagation(); data.onWaypoints(id, points.filter((_, item) => item !== index)); }}
      />)}
      {!points.length && <button className="sim-wire-add-bend nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${anchor.x}px, ${anchor.y}px)` }} onClick={event => { event.stopPropagation(); data.onWaypoints(id, [anchor]); }}>添加折点</button>}
    </EdgeLabelRenderer>}
  </g>;
}
