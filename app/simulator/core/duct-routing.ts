import { componentSize, getDefinition, isLayoutObject, isWireDuct, resolveTerminal, transformedTerminal } from "./catalog";
import type { CircuitComponent, CircuitDocument, CircuitWire, Point } from "./types";

type Rect = { left: number; top: number; right: number; bottom: number };
type Duct = Rect & { id: string; vertical: boolean; pins: Point[] };
type Link = { to: string; cost: number; points: Point[] };
type Vertex = { point: Point; links: Link[] };
type Network = { ducts: Duct[]; vertices: Map<string, Vertex> };
type Entry = { duct: Duct; point: Point; lead: Point[]; length: number; facing: boolean };
export type DuctRoute = { status: "routed" | "missing" | "blocked" | "disconnected"; sections: Point[][]; trunk: Point[]; message?: string; capacityWarning?: boolean };
type CenterRoute = DuctRoute & { leads?: [Point[], Point[]] };
const TERMINAL_CLEARANCE = 12;
const key = (point: Point) => `${point.x},${point.y}`;
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const compact = (points: Point[]) => points.filter((point, index) => !index || distance(point, points[index - 1]) > 0.000001);
const bounds = (component: CircuitComponent): Rect => { const size = componentSize(component); return { left: component.position.x, top: component.position.y, right: component.position.x + size.width, bottom: component.position.y + size.height }; };
const project = (duct: Duct, point: Point): Point => duct.vertical ? { x: (duct.left + duct.right) / 2, y: clamp(point.y, duct.top, duct.bottom) } : { x: clamp(point.x, duct.left, duct.right), y: (duct.top + duct.bottom) / 2 };
const along = (duct: Duct, point: Point) => duct.vertical ? point.y : point.x;
const cache = new WeakMap<CircuitComponent[], { signature: string; network: Network }>();
const routeCache = new WeakMap<CircuitComponent[], { signature: string; centers: Map<string, CenterRoute>; layouts: Map<string, Map<string, DuctRoute>> }>();
// Saved previews and JSON reloads can share immutable computed geometry too.
const recentGeometry = new Map<string, NonNullable<ReturnType<typeof routeCache.get>>>();
const routeKey = (wire: CircuitWire) => `${wire.id}:${wire.from.componentId}:${wire.from.terminalId}:${wire.to.componentId}:${wire.to.terminalId}`;
const automaticWire = (wire: CircuitWire) => wire.routing === "duct" || (wire.style as string) === "duct";
const routingSide = (terminal: ReturnType<typeof resolveTerminal>["terminal"]) => terminal.routingSide ?? terminal.side;
const cabinetEquipment = new Set(["breaker1", "breaker3", "knife-switch3", "contactor220", "contactor380", "overload", "fuse", "fuse2", "fuse3", "relay380", "relay380-jzc1-22", "timer380", "timer380-8pin", "auxiliary-no"]);

function networkFor(components: CircuitComponent[]): Network {
  const signature = components.filter(component => isWireDuct(component.type)).map(component => `${component.id}:${component.type}:${component.position.x}:${component.position.y}:${component.size?.width}:${component.size?.height}:${component.rotation??0}`).join("|");
  const cached = cache.get(components);
  if (cached?.signature === signature) return cached.network;
  const ducts: Duct[] = components.filter(component => isWireDuct(component.type)).sort((a, b) => a.id.localeCompare(b.id)).map(component => ({ ...bounds(component), id: component.id, vertical: component.type === "wire-duct-vertical", pins: [] }));
  const vertices = new Map<string, Vertex>();
  const vertex = (point: Point) => { const id = key(point); if (!vertices.has(id)) vertices.set(id, { point, links: [] }); return id; };
  const connect = (points: Point[]) => {
    const first = points[0], last = points.at(-1)!;
    const a = vertex(first), b = vertex(last);
    if (a === b) return;
    const cost = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
    vertices.get(a)!.links.push({ to: b, cost, points });
    vertices.get(b)!.links.push({ to: a, cost, points: [...points].reverse() });
  };
  for (const duct of ducts) duct.pins.push(project(duct, { x: duct.left, y: duct.top }), project(duct, { x: duct.right, y: duct.bottom }));
  for (let i = 0; i < ducts.length; i++) for (let j = i + 1; j < ducts.length; j++) {
    const a = ducts[i], b = ducts[j];
    const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right), top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom);
    // A visual near miss is not a connected channel. Touching edges can connect.
    if (left > right || top > bottom) continue;
    const overlap = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const ap = project(a, overlap), bp = project(b, overlap);
    a.pins.push(ap); b.pins.push(bp);
    connect(compact([ap, overlap, bp]));
  }
  for (const duct of ducts) {
    duct.pins = [...new Map(duct.pins.map(point => [key(point), point])).values()].sort((a, b) => along(duct, a) - along(duct, b));
    for (const point of duct.pins) vertex(point);
    for (let i = 1; i < duct.pins.length; i++) connect([duct.pins[i - 1], duct.pins[i]]);
  }
  const network = { ducts, vertices };
  cache.set(components, { signature, network });
  return network;
}

function crossesBody(a: Point, b: Point, rect: Rect): boolean {
  const inset = 0.001;
  if (a.x === b.x) return a.x > rect.left + inset && a.x < rect.right - inset && Math.max(a.y, b.y) > rect.top + inset && Math.min(a.y, b.y) < rect.bottom - inset;
  return a.y > rect.top + inset && a.y < rect.bottom - inset && Math.max(a.x, b.x) > rect.left + inset && Math.min(a.x, b.x) < rect.right - inset;
}

function terminalLead(terminal: ReturnType<typeof resolveTerminal>): Point[] {
  const rect = bounds(terminal.component), side = routingSide(terminal.terminal), world = terminal.world;
  const escape = { x: side === "left" ? rect.left - TERMINAL_CLEARANCE : side === "right" ? rect.right + TERMINAL_CLEARANCE : world.x, y: side === "top" ? rect.top - TERMINAL_CLEARANCE : side === "bottom" ? rect.bottom + TERMINAL_CLEARANCE : world.y };
  return [world, escape];
}

/** Geometric pin order keeps an exterior fan stable across IDs and reloads. */
function terminalFan(terminal: ReturnType<typeof resolveTerminal>) {
  const side = routingSide(terminal.terminal), vertical = side === "top" || side === "bottom";
  const pins = getDefinition(terminal.component.type).terminals.map(pin => transformedTerminal(terminal.component, pin))
    .filter(pin => routingSide(pin) === side).sort((a, b) => (vertical ? a.x - b.x : a.y - b.y) || a.id.localeCompare(b.id));
  const rank = pins.findIndex(pin => pin.id === terminal.terminal.id), reverse = pins.length - 1 - rank;
  return { rank, reverse, pins, spacing: Math.min(6, 24 / Math.max(1, pins.length - 1)) };
}

function entriesFor(document: CircuitDocument, terminal: ReturnType<typeof resolveTerminal>, network: Network): Entry[] {
  const rect = bounds(terminal.component), side = routingSide(terminal.terminal);
  const [world, escape] = terminalLead(terminal);
  const fan = terminalFan(terminal);
  const blockers = document.components.filter(component => !isLayoutObject(component.type));
  const candidates: Entry[] = [];
  // Cabinet devices enter a horizontal duct vertically. External buttons and
  // rotated boundary strips retain their short, directed side entrances.
  const cabinet = cabinetEquipment.has(terminal.component.type) || network.ducts.some(duct => !duct.vertical && rect.left >= duct.left && rect.right <= duct.right)
    && rect.top >= Math.min(...network.ducts.map(duct => duct.top))
    && rect.bottom <= Math.max(...network.ducts.map(duct => duct.bottom));
  const verticalEntry = cabinet && (side === "top" || side === "bottom");
  const consider = (duct: Duct, points: Point[], facing = false) => {
    const lead = compact([points[0], ...simplify(points.slice(1))]), point = lead.at(-1)!;
    if (verticalEntry) {
      if (duct.vertical) return;
      // A 12-unit escape anchor can already be inside a nearby duct: inspect
      // the actual first boundary crossing instead of only its final segment.
      const entering = lead.slice(1).findIndex((next, index) => crossesBody(lead[index], next, duct));
      if (entering < 0 || lead[entering].x !== lead[entering + 1].x) return;
    }
    if (lead.slice(1).some((next, index) => blockers.some(component => (component.id !== terminal.component.id || index > 0) && crossesBody(lead[index], next, bounds(component))))) return;
    if(lead.slice(1).some((next,index)=>network.ducts.some(other=>other!==duct && (other.right<duct.left||other.left>duct.right||other.bottom<duct.top||other.top>duct.bottom) && crossesBody(lead[index],next,other))))return;
    candidates.push({ duct, point, lead, facing, length: lead.slice(1).reduce((sum, next, index) => sum + distance(lead[index], next), 0) });
  };
  for (const duct of network.ducts) {
    const point = project(duct, escape);
    const obstacles = [rect, ...blockers.filter(component => component.id !== terminal.component.id && fan.pins.some(pin => {
      const origin = side === "top" || side === "bottom" ? { x: terminal.component.position.x + pin.x, y: escape.y } : { x: escape.x, y: terminal.component.position.y + pin.y };
      const ray = side === "top" || side === "bottom" ? { x: origin.x, y: point.y } : { x: point.x, y: origin.y };
      return crossesBody(origin, ray, bounds(component));
    })).map(bounds)];
    let edge: Point | undefined;
    if ((side === "top" || side === "bottom") && escape.x >= duct.left && escape.x <= duct.right) {
      if (side === "top" && duct.top <= escape.y) edge = { x: escape.x, y: Math.min(escape.y, duct.bottom) };
      if (side === "bottom" && duct.bottom >= escape.y) edge = { x: escape.x, y: Math.max(escape.y, duct.top) };
    }
    if ((side === "left" || side === "right") && escape.y >= duct.top && escape.y <= duct.bottom) {
      if (side === "left" && duct.left <= escape.x) edge = { x: Math.min(escape.x, duct.right), y: escape.y };
      if (side === "right" && duct.right >= escape.x) edge = { x: Math.max(escape.x, duct.left), y: escape.y };
    }
    if (edge && obstacles.length === 1) consider(duct, [world, escape, edge, project(duct, edge)], true);
    const outwardPoint = side === "top" ? point.y <= escape.y : side === "bottom" ? point.y >= escape.y : side === "left" ? point.x <= escape.x : point.x >= escape.x;
    if (outwardPoint && obstacles.length === 1) {
      const bend = side === "top" || side === "bottom" ? { x: escape.x, y: point.y } : { x: point.x, y: escape.y };
      consider(duct, [world, escape, bend, point]);
    }
    // Detour around the actual obstruction, rather than only around the
    // terminal's own device. Ordered lanes separate adjacent exterior tails.
    for (const obstacle of obstacles) for (const left of side === "top" || side === "bottom" ? [true, false] : []) {
      const x = left ? obstacle.left - TERMINAL_CLEARANCE - (side === "bottom" ? fan.rank : fan.reverse) * fan.spacing
        : obstacle.right + TERMINAL_CLEARANCE + (side === "bottom" ? fan.reverse : fan.rank) * fan.spacing;
      const y = side === "top" ? escape.y - (left ? fan.rank : fan.reverse) * fan.spacing
        : side === "bottom" ? escape.y + (left ? fan.rank : fan.reverse) * fan.spacing : escape.y;
      const target = project(duct, { x, y });
      consider(duct, [world, escape, { x: escape.x, y }, { x, y }, { x, y: target.y }, target]);
    }
    for (const obstacle of obstacles) for (const above of side === "left" || side === "right" ? [true, false] : []) {
      const y = above ? obstacle.top - TERMINAL_CLEARANCE - fan.reverse * fan.spacing : obstacle.bottom + TERMINAL_CLEARANCE + fan.rank * fan.spacing;
      const x = side === "left" ? escape.x - (above ? fan.rank : fan.reverse) * fan.spacing
        : side === "right" ? escape.x + (above ? fan.reverse : fan.rank) * fan.spacing : escape.x;
      const target = project(duct, { x, y });
      consider(duct, [world, escape, { x, y: escape.y }, { x, y }, { x: target.x, y }, target]);
    }
  }
  // If an outward entrance exists, do not wrap around the device into a duct
  // behind it. That would hide a disconnected cabinet by drawing a long tail.
  // Retain every distinct outward entry point, including farther alternatives.
  const outward = candidates.filter(entry => side === "top" ? entry.point.y <= escape.y : side === "bottom" ? entry.point.y >= escape.y : side === "left" ? entry.point.x <= escape.x : entry.point.x >= escape.x);
  // A facing duct is a physical entrance. Do not bridge a broken channel by
  // inventing a long parallel lead to another duct when that entrance exists.
  // Compare all facing entrances; use lateral/body detours only if none face us.
  const facing = outward.filter(entry => entry.facing);
  const available = facing.length ? facing : outward.length ? outward : candidates;
  return [...new Map(available.sort((a,b)=>a.length-b.length || a.lead.length-b.lead.length || JSON.stringify(a.lead).localeCompare(JSON.stringify(b.lead))).map(entry=>[`${entry.duct.id}/${key(entry.point)}`,entry] as const).reverse()).values()].sort((a,b)=>a.length-b.length || a.duct.id.localeCompare(b.duct.id) || key(a.point).localeCompare(key(b.point)));
}

/** Binary min-heap keeps the routing cost bounded for custom documents. */
type QueueItem = { id: string; cost: number; bends: number };
const compareQueue = (a: QueueItem, b: QueueItem) => a.cost - b.cost || a.bends - b.bends || a.id.localeCompare(b.id);
class Queue {
  items: QueueItem[] = [];
  push(item: QueueItem) {
    let index = this.items.length; this.items.push(item);
    while (index > 0) { const parent = (index - 1) >> 1; if (compareQueue(this.items[parent], item) <= 0) break; this.items[index] = this.items[parent]; index = parent; }
    this.items[index] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (this.items.length && last) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.items.length && compareQueue(this.items[child + 1], this.items[child]) < 0) child++;
        if (compareQueue(this.items[child], last) >= 0) break;
        this.items[index] = this.items[child]; index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

function shortestPath(document: CircuitDocument, network: Network, from: Entry, to: Entry): Point[] | undefined {
  const extra = new Map<string, Link[]>();
  const link = (a: string, b: string, points: Point[]) => {
    const cost = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
    extra.set(a, [...(extra.get(a) ?? []), { to: b, cost, points }]);
    extra.set(b, [...(extra.get(b) ?? []), { to: a, cost, points: [...points].reverse() }]);
  };
  for (const [id, entry] of [["start", from], ["end", to]] as const) {
    const value = along(entry.duct, entry.point);
    const before = entry.duct.pins.filter(point => along(entry.duct, point) <= value).at(-1);
    const after = entry.duct.pins.find(point => along(entry.duct, point) >= value);
    for (const point of new Set([before, after])) if (point) link(id, key(point), [entry.point, point]);
  }
  if (from.duct === to.duct) link("start", "end", [from.point, to.point]);
  const bodies = document.components.filter(component => !isLayoutObject(component.type)).map(bounds);
  const direction = (a: Point, b: Point) => a.x === b.x ? (b.y > a.y ? "down" : "up") : (b.x > a.x ? "right" : "left");
  const firstDirection = direction(from.lead.at(-2)!, from.point);
  const lastDirection = direction(to.point, to.lead.at(-2)!);
  const start = `start|${firstDirection}`;
  // Incoming direction is part of the search state: an equal-length arrival
  // can require a different number of bends on its remaining route.
  const queue = new Queue(), costs = new Map([[start, { cost: 0, bends: 0 }]]), previous = new Map<string, { id: string; points: Point[] }>();
  queue.push({ id: start, cost: 0, bends: 0 });
  while (queue.items.length) {
    const current = queue.pop()!;
    const saved = costs.get(current.id);
    if (current.cost !== saved?.cost || current.bends !== saved.bends) continue;
    const [vertex, incoming] = current.id.split("|");
    if (vertex === "end") {
      const pieces: Point[][] = []; let id = current.id;
      while (id !== start) { const step = previous.get(id)!; pieces.unshift(step.points); id = step.id; }
      return compact(pieces.flat());
    }
    for (const edge of [...(network.vertices.get(vertex)?.links ?? []), ...(extra.get(vertex) ?? [])]) {
      if (edge.points.slice(1).some((point, index) => bodies.some(rect => crossesBody(edge.points[index], point, rect)))) continue;
      const cost = current.cost + edge.cost;
      let heading = incoming, bends = current.bends;
      const points = compact(edge.points);
      for (let index = 1; index < points.length; index++) { const next = direction(points[index - 1], points[index]); if (next !== heading) bends++; heading = next; }
      if (edge.to === "end" && heading !== lastDirection) bends++;
      const id = `${edge.to}|${heading}`, old = costs.get(id);
      if (old && (cost > old.cost || cost === old.cost && bends >= old.bends)) continue;
      costs.set(id, { cost, bends }); previous.set(id, { id: current.id, points: edge.points }); queue.push({ id, cost, bends });
    }
  }
}

/** Every internal segment, including lane bends, must be covered by real ducts. */
export function segmentInsideDucts(document: CircuitDocument, a: Point, b: Point): boolean {
  if (a.x !== b.x && a.y !== b.y) return false;
  const vertical = a.x === b.x, start = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x), end = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x);
  const spans = document.components.filter(component => isWireDuct(component.type)).map(bounds).filter(rect => vertical ? a.x >= rect.left && a.x <= rect.right : a.y >= rect.top && a.y <= rect.bottom).map(rect => vertical ? [rect.top, rect.bottom] : [rect.left, rect.right]).sort((first, second) => first[0] - second[0]);
  let covered = start;
  for (const [min, max] of spans) {
    if (max < covered) continue;
    if (min > covered + 0.000001) return false;
    covered = Math.max(covered, max);
    if (covered >= end - 0.000001) return true;
  }
  return false;
}

type LaneSegment = { wireKey: string; index: number; vertical: boolean; value: number; start: number; end: number; half: number; slot?: number; offset?: number; crowded?: boolean };
const LANE_SPACING = 6;

/** Share lanes only where centre-line segments overlap; unrelated ducts do not consume capacity. */
function assignLanes(document: CircuitDocument, wires: CircuitWire[], centers: Map<string, CenterRoute>): Map<string, DuctRoute> {
  const network = networkFor(document.components), groups = new Map<string, LaneSegment[]>();
  const segments = new Map<string, LaneSegment[]>();
  const ordered = [...wires].sort((a, b) => {
    const endpoints = (wire: CircuitWire) => [resolveTerminal(document, wire.from).world, resolveTerminal(document, wire.to).world].sort((p, q) => p.x - q.x || p.y - q.y);
    const ap = endpoints(a), bp = endpoints(b);
    return ap[0].x - bp[0].x || ap[0].y - bp[0].y || ap[1].x - bp[1].x || ap[1].y - bp[1].y || a.id.localeCompare(b.id);
  });
  const order = new Map(ordered.map((wire, index) => [routeKey(wire), index]));
  for (const wire of ordered) {
    const id = routeKey(wire), base = simplify(centers.get(id)!.trunk), parts: LaneSegment[] = [];
    for (let index = 0; index + 1 < base.length; index++) {
      const a = base[index], b = base[index + 1], vertical = a.x === b.x;
      const value = vertical ? a.x : a.y, start = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x), end = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x);
      const ducts = network.ducts.filter(duct => duct.vertical === vertical && value >= (vertical ? duct.left : duct.top) && value <= (vertical ? duct.right : duct.bottom)
        && start < (vertical ? duct.bottom : duct.right) && end > (vertical ? duct.top : duct.left));
      const half = Math.max(0, Math.min(...ducts.map(duct => Math.min(value - (vertical ? duct.left : duct.top), (vertical ? duct.right : duct.bottom) - value) - 5), 100));
      const part: LaneSegment = { wireKey: id, index, vertical, value, start, end, half: ducts.length ? half : 0 };
      parts.push(part);
      const line = `${vertical ? "v" : "h"}:${value}`;
      groups.set(line, [...(groups.get(line) ?? []), part]);
    }
    segments.set(id, parts);
  }
  for (const line of groups.values()) {
    const sorted = [...line].sort((a, b) => a.start - b.start || a.end - b.end || order.get(a.wireKey)! - order.get(b.wireKey)!);
    const clusters: LaneSegment[][] = [];
    let end = -Infinity;
    for (const segment of sorted) {
      if (!clusters.length || segment.start >= end - 0.000001) { clusters.push([]); end = segment.end; }
      clusters.at(-1)!.push(segment); end = Math.max(end, segment.end);
    }
    for (const cluster of clusters) {
      const assigned: LaneSegment[] = [];
      for (const segment of [...cluster].sort((a, b) => order.get(a.wireKey)! - order.get(b.wireKey)! || a.index - b.index)) {
        const occupied = new Set(assigned.filter(other => segment.start < other.end - 0.000001 && segment.end > other.start + 0.000001).map(other => other.slot));
        let slot = 0; while (occupied.has(slot)) slot++;
        segment.slot = slot; assigned.push(segment);
      }
      const count = Math.max(...cluster.map(segment => segment.slot!)) + 1, half = Math.min(...cluster.map(segment => segment.half));
      const spacing = count > 1 ? Math.min(LANE_SPACING, half * 2 / (count - 1)) : 0;
      for (const segment of cluster) {
        segment.offset = (segment.slot! - (count - 1) / 2) * spacing;
        segment.crowded = count > 1 && spacing < LANE_SPACING - 0.000001;
      }
    }
  }
  const routes = new Map<string, DuctRoute>(), bodies = document.components.filter(component => !isLayoutObject(component.type)).map(bounds);
  for (const wire of ordered) {
    const id = routeKey(wire), center = centers.get(id)!;
    const { leads, ...original } = center;
    const parts = segments.get(id)!;
    if (!leads || !parts.length) { routes.set(id, original); continue; }
    const base = simplify(center.trunk);
    const lines = parts.map(part => ({ vertical: part.vertical, value: part.value + (part.offset ?? 0) }));
    const shifted = base.map((point, index) => {
      const before = lines[Math.max(0, index - 1)], after = lines[Math.min(index, lines.length - 1)];
      return { x: before.vertical ? before.value : after.vertical ? after.value : point.x, y: !before.vertical ? before.value : !after.vertical ? after.value : point.y };
    });
    const trunk = compact([base[0], ...shifted, base.at(-1)!]);
    const points = displayPath([...leads[0], ...trunk, ...leads[1]]);
    const valid = simplePath(points) && trunk.slice(1).every((point, index) => segmentInsideDucts(document, trunk[index], point) && !bodies.some(rect => crossesBody(trunk[index], point, rect)));
    const crowded = parts.some(part => part.crowded) || !valid;
    routes.set(id, { ...original, ...(valid ? { sections: [points], trunk } : {}), ...(crowded ? { capacityWarning: true, message: valid ? "线槽内导线较密，当前部分导线间距不足，请加宽线槽。" : "线槽转弯空间不足，部分导线暂时共用中心路径，请加宽线槽或调整布局。" } : {}) });
  }
  return routes;
}

/** Geometry and wire membership both invalidate shared-lane allocation. */
export function routeWireInDucts(document: CircuitDocument, wire: CircuitWire): DuctRoute {
  const signature = document.components.map(component => `${component.id}:${component.type}:${component.position.x}:${component.position.y}:${component.size?.width}:${component.size?.height}:${component.rotation ?? 0}`).sort().join("|");
  let cached = routeCache.get(document.components);
  if (cached?.signature !== signature) {
    cached = recentGeometry.get(signature) ?? { signature, centers: new Map(), layouts: new Map() };
    routeCache.set(document.components, cached);
    if (recentGeometry.size >= 6 && !recentGeometry.has(signature)) recentGeometry.delete(recentGeometry.keys().next().value!);
    recentGeometry.set(signature, cached);
  }
  // A preview may ask for a wire not committed to the document yet.
  const wires = document.wires.filter(candidate => automaticWire(candidate) && candidate.id !== wire.id);
  wires.push(wire);
  const membership = wires.map(routeKey).sort().join("|");
  let routes = cached.layouts.get(membership);
  if (!routes) {
    if (cached.centers.size > 4000) cached.centers.clear();
    for (const candidate of wires) if (!cached.centers.has(routeKey(candidate))) cached.centers.set(routeKey(candidate), calculateRoute(document, candidate));
    routes = assignLanes(document, wires, cached.centers);
    // Keep normal editing bounded when preview connections or wire sets change.
    if (cached.layouts.size >= 8) cached.layouts.clear();
    cached.layouts.set(membership, routes);
  }
  return routes.get(routeKey(wire))!;
}

/** Collapse collinear detours. The resulting segment is covered by their union. */
function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of compact(points)) {
    while (result.length > 1) {
      const a = result.at(-2)!, b = result.at(-1)!;
      if (a.x === b.x && b.x === point.x || a.y === b.y && b.y === point.y) result.pop();
      else break;
    }
    if (!result.length || distance(result.at(-1)!, point) > 0.000001) result.push(point);
  }
  return result;
}
// Retain both outward escape anchors even when the remainder is simplified.
const displayPath = (points: Point[]) => compact([points[0], ...simplify(points.slice(1, -1)), points.at(-1)!]);
/** A lane shift must not create a loop against either exterior lead. */
function simplePath(points: Point[]): boolean {
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    if (a.x === b.x && b.x === c.x && (b.y - a.y) * (c.y - b.y) < 0 ||
        a.y === b.y && b.y === c.y && (b.x - a.x) * (c.x - b.x) < 0) return false;
  }
  for (let i = 0; i + 1 < points.length; i++) for (let j = i + 2; j + 1 < points.length; j++) {
    const a = points[i], b = points[i + 1], c = points[j], d = points[j + 1];
    // Bounding boxes intersect exactly when two orthogonal segments meet.
    if (Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))) return false;
  }
  return true;
}
const pathLength=(points:Point[])=>points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
function comparePaths(a:Point[],b:Point[]){return pathLength(a)-pathLength(b)||simplify(a).length-simplify(b).length||JSON.stringify(a).localeCompare(JSON.stringify(b));}
function externalRoute(document:CircuitDocument,source:ReturnType<typeof resolveTerminal>,target:ReturnType<typeof resolveTerminal>):DuctRoute {
 const from=terminalLead(source),to=terminalLead(target),a=from[1],b=to[1];
 const bodies=document.components.filter(c=>!isLayoutObject(c.type));
 const clear=(points:Point[])=>points.slice(1).every((p,i)=>!bodies.some(c=>crossesBody(points[i],p,bounds(c))));
 // Endpoint tails may originate inside their own body; every later segment must clear it.
 if([source,target].some((t,i)=>bodies.some(c=>c.id!==t.component.id&&crossesBody((i?to:from)[0],(i?to:from)[1],bounds(c)))))return {status:"blocked",sections:[from,to.reverse()],trunk:[],message:"外部引线被元件挡住，请调整布局。"};
 // Facing XT outputs and motor inputs have an open cabinet-exterior corridor.
 // Ordered horizontal turns separate the phase tails without lengthening them.
 const upper=a.y<=b.y?source:target,lower=upper===source?target:source;
 const u=upper===source?a:b,l=upper===source?b:a;
 if(routingSide(upper.terminal)==="bottom"&&routingSide(lower.terminal)==="top"&&u.y<=l.y){
  const fan=terminalFan(lower),spacing=Math.min(6,(l.y-u.y)/Math.max(1,fan.pins.length+1));
  const lane=(l.y+u.y)/2+(Math.sign(l.x-u.x)||1)*((fan.pins.length-1)/2-fan.rank)*spacing;
  const middle=compact([u,{x:u.x,y:lane},{x:l.x,y:lane},l]);
  const oriented=upper===source?middle:[...middle].reverse();
  const points=displayPath([...from,...oriented,...[...to].reverse()]);
  if(clear(oriented)&&simplePath(points))return {status:"routed",sections:[points],trunk:[]};
 }
 if(routingSide(upper.terminal)==="bottom"&&routingSide(lower.terminal)==="bottom"){
  const rect=bounds(lower.component),fan=terminalFan(lower),gap=rect.top-TERMINAL_CLEARANCE-u.y;
  if(gap>=0){
   const spacing=Math.min(6,gap/Math.max(1,fan.pins.length+1));
   const above=u.y+gap/2+(fan.rank-(fan.pins.length-1)/2)*spacing;
   const below=l.y+fan.rank*6;
   const choices=[rect.left-TERMINAL_CLEARANCE-fan.rank*6,rect.right+TERMINAL_CLEARANCE+fan.rank*6].map(x=>compact([u,{x:u.x,y:above},{x,y:above},{x,y:below},{x:l.x,y:below},l]));
   const options=choices.map(points=>upper===source?points:[...points].reverse()).filter(points=>clear(points)&&simplePath(displayPath([...from,...points,...[...to].reverse()]))).sort(comparePaths);
   if(options.length)return {status:"routed",sections:[displayPath([...from,...options[0],...[...to].reverse()])],trunk:[]};
  }
 }
 const choices:Point[][]=[[a,{x:a.x,y:b.y},b],[a,{x:b.x,y:a.y},b]];
 for(const c of bodies){const r=bounds(c);for(const x of [r.left-12,r.right+12])choices.push([a,{x,y:a.y},{x,y:b.y},b]);for(const y of [r.top-12,r.bottom+12])choices.push([a,{x:a.x,y},{x:b.x,y},b]);}
 const middle=choices.map(simplify).filter(points=>clear(points)&&simplePath(displayPath([...from,...points,...[...to].reverse()]))).sort(comparePaths)[0];
 return middle?{status:"routed",sections:[displayPath(compact([...from,...middle,...to.reverse()]))],trunk:[]}:{status:"blocked",sections:[from,to.reverse()],trunk:[],message:"外部直角路径被元件遮挡，请调整外部器件位置。"};
}
function calculateRoute(document: CircuitDocument, wire: CircuitWire): CenterRoute {
 const source=resolveTerminal(document,wire.from),target=resolveTerminal(document,wire.to);
 const external=source.terminal.routingRole==="external"||target.terminal.routingRole==="external";
 const internal=source.terminal.routingRole==="internal"||target.terminal.routingRole==="internal";
 const belowCabinetSupply=[source,target].find(terminal=>terminal.component.type==="supply"&&document.components.some(component=>isWireDuct(component.type))&&terminal.component.position.y>Math.max(...document.components.filter(component=>isWireDuct(component.type)).map(component=>bounds(component).bottom)));
 const boundary=belowCabinetSupply&&(belowCabinetSupply===source?target:source);
 if(external&&!internal || boundary&&(boundary.terminal.routingRole==="external" || boundary.component.type==="pe-terminal"))return externalRoute(document,source,target);
 const network=networkFor(document.components);
 if(!network.ducts.length)return {status:"missing",sections:[terminalLead(source),terminalLead(target).reverse()],trunk:[],message:"请先布置线槽，再自动走线。"};
 const starts=entriesFor(document,source,network),ends=entriesFor(document,target,network);
 const sections=[starts[0]?.lead??terminalLead(source),[...(ends[0]?.lead??terminalLead(target))].reverse()];
 if(!starts.length||!ends.length)return {status:"blocked",sections,trunk:[],message:"端子出线方向没有可进入的线槽，或引出段被元件挡住，请调整元件或线槽。"};
 const choices:{from:Entry;to:Entry;trunk:Point[];points:Point[]}[]=[];
 for(const from of starts)for(const to of ends){const trunk=shortestPath(document,network,from,to);if(trunk){const points=displayPath([...from.lead,...trunk,...[...to.lead].reverse()]);if(simplePath(points))choices.push({from,to,trunk,points});}}
 const best=choices.sort((a,b)=>pathLength(a.points)-pathLength(b.points)||a.from.length+a.to.length-b.from.length-b.to.length||comparePaths(a.points,b.points))[0];
 if(!best)return {status:"disconnected",sections,trunk:[],message:"两端线槽未连通或槽内被元件挡住，请连接线槽或调整布局。"};
 return {status:"routed",sections:[best.points],trunk:best.trunk,leads:[best.from.lead,[...best.to.lead].reverse()]};
}
