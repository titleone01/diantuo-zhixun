import { componentSize, getDefinition, isLayoutObject, isWireDuct, resolveTerminal, transformedTerminal } from "./catalog";
import type { CircuitComponent, CircuitDocument, CircuitWire, Point } from "./types";

type Rect = { left: number; top: number; right: number; bottom: number };
type Duct = Rect & { id: string; vertical: boolean; pins: Point[] };
type Link = { to: string; cost: number; points: Point[] };
type Vertex = { point: Point; links: Link[] };
type Network = { ducts: Duct[]; vertices: Map<string, Vertex> };
type Entry = { duct: Duct; point: Point; lead: Point[]; length: number; facing: boolean };
export type DuctRoute = { status: "routed" | "missing" | "blocked" | "disconnected"; sections: Point[][]; trunk: Point[]; message?: string };
const TERMINAL_CLEARANCE = 12;
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
  const rect = bounds(terminal.component), side = terminal.terminal.side, world = terminal.world;
  const escape = { x: side === "left" ? rect.left - TERMINAL_CLEARANCE : side === "right" ? rect.right + TERMINAL_CLEARANCE : world.x, y: side === "top" ? rect.top - TERMINAL_CLEARANCE : side === "bottom" ? rect.bottom + TERMINAL_CLEARANCE : world.y };
  return [world, escape];
}

/** Geometric pin order keeps an exterior fan stable across IDs and reloads. */
function terminalFan(terminal: ReturnType<typeof resolveTerminal>) {
  const side = terminal.terminal.side, vertical = side === "top" || side === "bottom";
  const pins = getDefinition(terminal.component.type).terminals.map(pin => transformedTerminal(terminal.component, pin))
    .filter(pin => pin.side === side).sort((a, b) => (vertical ? a.x - b.x : a.y - b.y) || a.id.localeCompare(b.id));
  const rank = pins.findIndex(pin => pin.id === terminal.terminal.id), reverse = pins.length - 1 - rank;
  return { rank, reverse, pins, spacing: Math.min(6, 24 / Math.max(1, pins.length - 1)) };
}

function entriesFor(document: CircuitDocument, terminal: ReturnType<typeof resolveTerminal>, network: Network): Entry[] {
  const rect = bounds(terminal.component), side = terminal.terminal.side;
  const [world, escape] = terminalLead(terminal);
  const fan = terminalFan(terminal);
  const blockers = document.components.filter(component => !isLayoutObject(component.type));
  const candidates: Entry[] = [];
  const consider = (duct: Duct, points: Point[], facing = false) => {
    const lead = compact([points[0], ...simplify(points.slice(1))]), point = lead.at(-1)!;
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

function laneRoute(document: CircuitDocument, network: Network, wire: CircuitWire, trunk: Point[]): Point[] {
  if (!trunk.length) return trunk;
  // Stable IDs keep parallel wires on the same lane after edits and reloads.
  let hash = 0;
  for (const character of wire.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const half = Math.min(14, ...network.ducts.map(duct => (duct.vertical ? duct.right - duct.left : duct.bottom - duct.top) / 2 - 5));
  const offset = (hash % 9 - 4) * half / 4;
  const base=simplify(trunk);
  if(base.length<2)return base;
  const segment=(a:Point,b:Point)=>a.x===b.x ? {vertical:true,value:a.x-Math.sign(b.y-a.y)*offset} : {vertical:false,value:a.y+Math.sign(b.x-a.x)*offset};
  const lines=base.slice(1).map((b,i)=>segment(base[i],b));
  const shifted=base.map((p,i)=>{const before=lines[Math.max(0,i-1)],after=lines[Math.min(i,lines.length-1)];return {x:before.vertical?before.value:after.vertical?after.value:p.x,y:!before.vertical?before.value:!after.vertical?after.value:p.y};});
  const candidate = compact([base[0],...shifted,base.at(-1)!]);
  const bodies = document.components.filter(component => !isLayoutObject(component.type)).map(bounds);
  return candidate.slice(1).every((point, index) => segmentInsideDucts(document, candidate[index], point) && !bodies.some(rect => crossesBody(candidate[index], point, rect))) ? candidate : trunk;
}

/** Route presentation through actual overlapping duct rectangles; topology stays in terminal IDs. */
export function routeWireInDucts(document: CircuitDocument, wire: CircuitWire): DuctRoute {
  const signature = document.components.map(component => `${component.id}:${component.type}:${component.position.x}:${component.position.y}:${component.size?.width}:${component.size?.height}:${component.rotation??0}`).join("|");
  let cached = routeCache.get(document.components);
  if (cached?.signature !== signature) { cached = { signature, routes: new Map() }; routeCache.set(document.components, cached); }
  const id = `${wire.id}:${wire.from.componentId}:${wire.from.terminalId}:${wire.to.componentId}:${wire.to.terminalId}`;
  const previous = cached.routes.get(id);
  if (previous) return previous;
  const route = calculateRoute(document, wire);
  cached.routes.set(id, route);
  return route;
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
 const choices:Point[][]=[[a,{x:a.x,y:b.y},b],[a,{x:b.x,y:a.y},b]];
 for(const c of bodies){const r=bounds(c);for(const x of [r.left-12,r.right+12])choices.push([a,{x,y:a.y},{x,y:b.y},b]);for(const y of [r.top-12,r.bottom+12])choices.push([a,{x:a.x,y},{x:b.x,y},b]);}
 const middle=choices.map(simplify).filter(points=>clear(points)&&simplePath(displayPath([...from,...points,...[...to].reverse()]))).sort(comparePaths)[0];
 return middle?{status:"routed",sections:[displayPath(compact([...from,...middle,...to.reverse()]))],trunk:[]}:{status:"blocked",sections:[from,to.reverse()],trunk:[],message:"外部直角路径被元件遮挡，请调整外部器件位置。"};
}
function calculateRoute(document: CircuitDocument, wire: CircuitWire): DuctRoute {
 const source=resolveTerminal(document,wire.from),target=resolveTerminal(document,wire.to);
 const external=source.terminal.routingRole==="external"||target.terminal.routingRole==="external";
 const internal=source.terminal.routingRole==="internal"||target.terminal.routingRole==="internal";
 if(external&&!internal)return externalRoute(document,source,target);
 const network=networkFor(document.components);
 if(!network.ducts.length)return {status:"missing",sections:[terminalLead(source),terminalLead(target).reverse()],trunk:[],message:"请先布置线槽，再自动走线。"};
 const starts=entriesFor(document,source,network),ends=entriesFor(document,target,network);
 const sections=[starts[0]?.lead??terminalLead(source),[...(ends[0]?.lead??terminalLead(target))].reverse()];
 if(!starts.length||!ends.length)return {status:"blocked",sections,trunk:[],message:"端子出线方向没有可进入的线槽，或引出段被元件挡住，请调整元件或线槽。"};
 const choices:{from:Entry;to:Entry;trunk:Point[];points:Point[]}[]=[];
 for(const from of starts)for(const to of ends){const trunk=shortestPath(document,network,from,to);if(trunk){const points=displayPath([...from.lead,...trunk,...[...to.lead].reverse()]);if(simplePath(points))choices.push({from,to,trunk,points});}}
 const best=choices.sort((a,b)=>pathLength(a.points)-pathLength(b.points)||a.from.length+a.to.length-b.from.length-b.to.length||comparePaths(a.points,b.points))[0];
 if(!best)return {status:"disconnected",sections,trunk:[],message:"两端线槽未连通或槽内被元件挡住，请连接线槽或调整布局。"};
 let trunk=laneRoute(document,network,wire,best.trunk);
 let points=displayPath([...best.from.lead,...trunk,...[...best.to.lead].reverse()]);
 if(!simplePath(points)){trunk=best.trunk;points=best.points;}
 // Simplify across the joins too: a shifted lane may meet the lead before
 // its centre-line anchor. Keeping both would draw an in-duct U-turn.
 // Collinear removal only shortens the existing segment union; the separate
 // trunk still retains its validated entry/exit boundaries.
 return {status:"routed",sections:[points],trunk};
}
