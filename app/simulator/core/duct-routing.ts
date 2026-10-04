import { componentSize, isWireDuct, resolveTerminal } from "./catalog";
import type { CircuitComponent, CircuitDocument, CircuitWire, Point } from "./types";

type Rect = { left: number; top: number; right: number; bottom: number };
type Duct = Rect & { vertical: boolean; pins: Point[] };
type Link = { to: string; cost: number; points: Point[] };
type Vertex = { point: Point; links: Link[] };
type Network = { ducts: Duct[]; vertices: Map<string, Vertex> };
type Entry = { duct: Duct; point: Point; lead: Point[]; length: number };
export type DuctRoute = { status: "routed" | "missing" | "blocked" | "disconnected"; sections: Point[][]; trunk: Point[]; message?: string };
const key = (point: Point) => `${point.x},${point.y}`;
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const compact = (points: Point[]) => points.filter((point, index) => !index || distance(point, points[index - 1]) > 0.000001);
const bounds = (component: CircuitComponent): Rect => { const size = componentSize(component); return { left: component.position.x, top: component.position.y, right: component.position.x + size.width, bottom: component.position.y + size.height }; };
const project = (duct: Duct, point: Point): Point => duct.vertical ? { x: (duct.left + duct.right) / 2, y: clamp(point.y, duct.top, duct.bottom) } : { x: clamp(point.x, duct.left, duct.right), y: (duct.top + duct.bottom) / 2 };
const along = (duct: Duct, point: Point) => duct.vertical ? point.y : point.x;
const cache = new WeakMap<CircuitComponent[], { signature: string; network: Network }>();
const routeCache = new WeakMap<CircuitComponent[], { signature: string; routes: Map<string, DuctRoute> }>();

function networkFor(components: CircuitComponent[]): Network {
  const signature = components.filter(component => isWireDuct(component.type)).map(component => `${component.type}:${component.position.x}:${component.position.y}:${component.size?.width}:${component.size?.height}`).join("|");
  const cached = cache.get(components);
  if (cached?.signature === signature) return cached.network;
  const ducts: Duct[] = components.filter(component => isWireDuct(component.type)).map(component => ({ ...bounds(component), vertical: component.type === "wire-duct-vertical", pins: [] }));
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

function entryFor(document: CircuitDocument, terminal: ReturnType<typeof resolveTerminal>, network: Network): Entry | undefined {
  const rect = bounds(terminal.component), side = terminal.terminal.side, world = terminal.world;
  const escape = { x: side === "left" ? rect.left - 8 : side === "right" ? rect.right + 8 : world.x, y: side === "top" ? rect.top - 8 : side === "bottom" ? rect.bottom + 8 : world.y };
  const blockers = document.components.filter(component => !isWireDuct(component.type));
  const candidates: Entry[] = [];
  const consider = (duct: Duct, points: Point[]) => {
    const lead = compact(points), point = lead.at(-1)!;
    if (lead.slice(1).some((next, index) => blockers.some(component => (component.id !== terminal.component.id || index > 0) && crossesBody(lead[index], next, bounds(component))))) return;
    candidates.push({ duct, point, lead, length: lead.slice(1).reduce((sum, next, index) => sum + distance(lead[index], next), 0) });
  };
  for (const duct of network.ducts) {
    let edge: Point | undefined;
    if ((side === "top" || side === "bottom") && escape.x >= duct.left && escape.x <= duct.right) {
      if (side === "top" && duct.top <= escape.y) edge = { x: escape.x, y: Math.min(escape.y, duct.bottom) };
      if (side === "bottom" && duct.bottom >= escape.y) edge = { x: escape.x, y: Math.max(escape.y, duct.top) };
    }
    if ((side === "left" || side === "right") && escape.y >= duct.top && escape.y <= duct.bottom) {
      if (side === "left" && duct.left <= escape.x) edge = { x: Math.min(escape.x, duct.right), y: escape.y };
      if (side === "right" && duct.right >= escape.x) edge = { x: Math.max(escape.x, duct.left), y: escape.y };
    }
    if (edge) consider(duct, [world, escape, edge, project(duct, edge)]);
    const point = project(duct, escape);
    consider(duct, [world, escape, { x: point.x, y: escape.y }, point]);
    consider(duct, [world, escape, { x: escape.x, y: point.y }, point]);
    // External controls and motor tails turn around their bodies into the
    // existing reference board; they do not acquire additional ducts.
    for (const x of [rect.left - 8, rect.right + 8]) {
      const target = project(duct, { x, y: escape.y });
      consider(duct, [world, escape, { x, y: escape.y }, { x, y: target.y }, target]);
    }
    for (const y of [rect.top - 8, rect.bottom + 8]) {
      const target = project(duct, { x: escape.x, y });
      consider(duct, [world, escape, { x: escape.x, y }, { x: target.x, y }, target]);
    }
  }
  return candidates.sort((a, b) => a.length - b.length)[0];
}

/** Binary min-heap keeps the routing cost bounded for custom documents. */
class Queue {
  items: { id: string; cost: number }[] = [];
  push(item: { id: string; cost: number }) {
    let index = this.items.length; this.items.push(item);
    while (index > 0) { const parent = (index - 1) >> 1; if (this.items[parent].cost <= item.cost) break; this.items[index] = this.items[parent]; index = parent; }
    this.items[index] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (this.items.length && last) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].cost < this.items[child].cost) child++;
        if (this.items[child].cost >= last.cost) break;
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
  const bodies = document.components.filter(component => !isWireDuct(component.type)).map(bounds);
  const queue = new Queue(), costs = new Map([["start", 0]]), previous = new Map<string, { id: string; points: Point[] }>();
  queue.push({ id: "start", cost: 0 });
  while (queue.items.length) {
    const current = queue.pop()!;
    if (current.cost !== costs.get(current.id)) continue;
    if (current.id === "end") {
      const pieces: Point[][] = []; let id = "end";
      while (id !== "start") { const step = previous.get(id)!; pieces.unshift(step.points); id = step.id; }
      return compact(pieces.flat());
    }
    for (const edge of [...(network.vertices.get(current.id)?.links ?? []), ...(extra.get(current.id) ?? [])]) {
      if (edge.points.slice(1).some((point, index) => bodies.some(rect => crossesBody(edge.points[index], point, rect)))) continue;
      const cost = current.cost + edge.cost;
      if (cost >= (costs.get(edge.to) ?? Infinity)) continue;
      costs.set(edge.to, cost); previous.set(edge.to, { id: current.id, points: edge.points }); queue.push({ id: edge.to, cost });
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

function laneRoute(document: CircuitDocument, network: Network, wire: CircuitWire, trunk: Point[]): Point[] {
  if (!trunk.length) return trunk;
  // Stable IDs keep parallel wires on the same lane after edits and reloads.
  let hash = 0;
  for (const character of wire.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const half = Math.min(14, ...network.ducts.map(duct => (duct.vertical ? duct.right - duct.left : duct.bottom - duct.top) / 2 - 5));
  const offset = (hash % 9 - 4) * half / 4;
  const shifted = trunk.map(point => ({ x: point.x + offset, y: point.y + offset }));
  const first = trunk[0], last = trunk.at(-1)!, shiftedFirst = shifted[0], shiftedLast = shifted.at(-1)!;
  const candidate = compact([first, { x: shiftedFirst.x, y: first.y }, ...shifted, { x: last.x, y: shiftedLast.y }, last]);
  const bodies = document.components.filter(component => !isWireDuct(component.type)).map(bounds);
  return candidate.slice(1).every((point, index) => segmentInsideDucts(document, candidate[index], point) && !bodies.some(rect => crossesBody(candidate[index], point, rect))) ? candidate : trunk;
}

/** Route presentation through actual overlapping duct rectangles; topology stays in terminal IDs. */
export function routeWireInDucts(document: CircuitDocument, wire: CircuitWire): DuctRoute {
  const signature = document.components.map(component => `${component.id}:${component.type}:${component.position.x}:${component.position.y}:${component.size?.width}:${component.size?.height}`).join("|");
  let cached = routeCache.get(document.components);
  if (cached?.signature !== signature) { cached = { signature, routes: new Map() }; routeCache.set(document.components, cached); }
  const id = `${wire.id}:${wire.from.componentId}:${wire.from.terminalId}:${wire.to.componentId}:${wire.to.terminalId}`;
  const previous = cached.routes.get(id);
  if (previous) return previous;
  const route = calculateRoute(document, wire);
  cached.routes.set(id, route);
  return route;
}

function calculateRoute(document: CircuitDocument, wire: CircuitWire): DuctRoute {
  const source = resolveTerminal(document, wire.from), target = resolveTerminal(document, wire.to);
  const network = networkFor(document.components);
  if (!network.ducts.length) return { status: "missing", sections: [[source.world], [target.world]], trunk: [], message: "请先布置线槽，再自动走线。" };
  const from = entryFor(document, source, network), to = entryFor(document, target, network);
  const sections = [from?.lead ?? [source.world], [...(to?.lead ?? [target.world])].reverse()];
  if (!from || !to) return { status: "blocked", sections, trunk: [], message: "端子出线方向没有可进入的线槽，或引出段被元件挡住，请调整元件或线槽。" };
  const shortest = shortestPath(document, network, from, to);
  if (!shortest) return { status: "disconnected", sections, trunk: [], message: "两端线槽未连通或槽内被元件挡住，请连接线槽或调整布局。" };
  const trunk = laneRoute(document, network, wire, shortest);
  return { status: "routed", sections: [compact([...from.lead, ...trunk, ...[...to.lead].reverse()])], trunk };
}
