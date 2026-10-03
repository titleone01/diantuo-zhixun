import { resolveTerminal } from "../core/catalog";
import type { CircuitDocument, CircuitWire, Point, Terminal } from "../core/types";
import { ductWireRoute } from "./duct-routing";

const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

export function terminalColor(terminal: Terminal): string {
  if (terminal.color) return terminal.color;
  if (terminal.electrical === "earth" || terminal.id === "PE") return "#659f2f";
  if (terminal.electrical === "neutral" || terminal.id === "N") return "#3478f6";
  if (["L1", "U", "1", "2"].includes(terminal.id)) return "#e7b000";
  if (["L2", "V", "3", "4", "23", "24"].includes(terminal.id)) return "#20b963";
  if (["L3", "W", "5", "6", "11", "12"].includes(terminal.id)) return "#f04452";
  return "#56616f";
}

/** Electrical endpoints always come from the catalogue and instance positions. */
export function wireEndpoints(document: CircuitDocument, wire: CircuitWire) {
  return {
    from: resolveTerminal(document, wire.from).world,
    to: resolveTerminal(document, wire.to).world,
  };
}

/** Waypoints are world-space drawing hints; they never add electrical junctions. */
export function wireRoute(document: CircuitDocument, wire: CircuitWire): Point[] {
  if(wire.routing==="duct"){const routed=ductWireRoute(document,wire);if(routed.points)return routed.points;}
  const source = resolveTerminal(document, wire.from);
  const target = resolveTerminal(document, wire.to);
  if (wire.style === "straight" || wire.style === "curve") return [source.world, target.world];
  const points: Point[] = [source.world];
  const horizontalFirst = source.terminal.side === "left" || source.terminal.side === "right";
  if (wire.waypoints?.length) {
    let horizontal = horizontalFirst;
    for (const next of [...wire.waypoints, target.world]) {
      const last = points[points.length - 1];
      const corner = horizontal ? { x: next.x, y: last.y } : { x: last.x, y: next.y };
      if (!equal(last, corner)) points.push(corner);
      if (!equal(points[points.length - 1], next)) points.push(next);
      horizontal = !horizontal;
    }
  } else if (horizontalFirst) {
    const x = (source.world.x + target.world.x) / 2;
    points.push({ x, y: source.world.y }, { x, y: target.world.y }, target.world);
  } else {
    const y = (source.world.y + target.world.y) / 2;
    points.push({ x: source.world.x, y }, { x: target.world.x, y }, target.world);
  }
  return points.filter((point, index) => index === 0 || !equal(point, points[index - 1]));
}

export function curveControlPoints(document: CircuitDocument, wire: CircuitWire): [Point, Point, Point, Point] {
    const source = resolveTerminal(document, wire.from);
    const target = resolveTerminal(document, wire.to);
    const distance = Math.max(35, Math.min(180, Math.hypot(target.world.x - source.world.x, target.world.y - source.world.y) * 0.4));
    const lead = (point: Point, side: Terminal["side"]) => ({ x: point.x + (side === "left" ? -distance : side === "right" ? distance : 0), y: point.y + (side === "top" ? -distance : side === "bottom" ? distance : 0) });
    const first = lead(source.world, source.terminal.side);
    const second = lead(target.world, target.terminal.side);
    return [source.world, first, second, target.world];
}

export function wirePath(document: CircuitDocument, wire: CircuitWire): string {
  if(wire.routing==="duct"){const routed=ductWireRoute(document,wire);if(routed.points)return routed.points.map((point,index)=>`${index===0?"M":"L"} ${point.x} ${point.y}`).join(" ");}
  if (wire.style === "curve") {
    const [source, first, second, target] = curveControlPoints(document, wire);
    return `M ${source.x} ${source.y} C ${first.x} ${first.y} ${second.x} ${second.y} ${target.x} ${target.y}`;
  }
  return wireRoute(document, wire).map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}
