export type RoutePoint = { x: number; y: number };
export type RouteRect = { x: number; y: number; width: number; height: number };
export type DuctAxis = "horizontal" | "vertical";
export type DuctEntry = { point: RoutePoint; axis: DuctAxis };

type Direction = "horizontal" | "vertical" | "start";

type RouteOptions = {
  source: RoutePoint;
  target: RoutePoint;
  obstacles: RouteRect[];
  laneIndex?: number;
  clearance?: number;
  bendPenalty?: number;
  preferredHorizontalChannels?: number[];
  preferredVerticalChannels?: number[];
};

const epsilon = 0.001;

const inflate = (rect: RouteRect, clearance: number): RouteRect => ({
  x: rect.x - clearance,
  y: rect.y - clearance,
  width: rect.width + clearance * 2,
  height: rect.height + clearance * 2,
});

const inside = (point: RoutePoint, rect: RouteRect) => point.x > rect.x + epsilon
  && point.x < rect.x + rect.width - epsilon
  && point.y > rect.y + epsilon
  && point.y < rect.y + rect.height - epsilon;

const segmentBlocked = (a: RoutePoint, b: RoutePoint, obstacles: RouteRect[]) => obstacles.some((rect) => {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  if (Math.abs(a.y - b.y) < epsilon) {
    if (a.y <= top + epsilon || a.y >= bottom - epsilon) return false;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return maxX > left + epsilon && minX < right - epsilon;
  }
  if (Math.abs(a.x - b.x) < epsilon) {
    if (a.x <= left + epsilon || a.x >= right - epsilon) return false;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return maxY > top + epsilon && minY < bottom - epsilon;
  }
  return true;
});

const distance = (a: RoutePoint, b: RoutePoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const pointKey = (xIndex: number, yIndex: number) => `${xIndex}:${yIndex}`;
const stateKey = (key: string, direction: Direction) => `${key}:${direction}`;

const simplify = (points: RoutePoint[]) => points.filter((point, index) => {
  if (index === 0 || index === points.length - 1) return true;
  const previous = points[index - 1];
  const next = points[index + 1];
  const vertical = Math.abs(previous.x - point.x) < epsilon && Math.abs(point.x - next.x) < epsilon;
  const horizontal = Math.abs(previous.y - point.y) < epsilon && Math.abs(point.y - next.y) < epsilon;
  return !vertical && !horizontal;
});

const coordinateKey = (point: RoutePoint) => `${point.x.toFixed(4)}:${point.y.toFixed(4)}`;
const onChannel = (value: number, channels: number[]) => channels.some((channel) => Math.abs(channel - value) < epsilon);

/**
 * Route only inside the center-line network formed by the physical wire ducts.
 * The source and target must already be projected onto their nearest duct.
 */
export function routeInDuctNetwork({
  source,
  target,
  horizontalChannels,
  verticalChannels,
}: {
  source: DuctEntry;
  target: DuctEntry;
  horizontalChannels: number[];
  verticalChannels: number[];
}): RoutePoint[] {
  const nodes = new Map<string, RoutePoint>();
  const addNode = (point: RoutePoint) => nodes.set(coordinateKey(point), point);
  addNode(source.point);
  addNode(target.point);
  for (const x of verticalChannels) {
    for (const y of horizontalChannels) addNode({ x, y });
  }

  const sourceKey = coordinateKey(source.point);
  const targetKey = coordinateKey(target.point);
  const distances = new Map<string, number>([[sourceKey, 0]]);
  const previous = new Map<string, string>();
  const unvisited = new Set(nodes.keys());

  while (unvisited.size) {
    const currentKey = [...unvisited].sort((left, right) => (
      (distances.get(left) ?? Number.POSITIVE_INFINITY) - (distances.get(right) ?? Number.POSITIVE_INFINITY)
      || left.localeCompare(right)
    ))[0];
    const currentDistance = distances.get(currentKey) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(currentDistance)) break;
    unvisited.delete(currentKey);
    if (currentKey === targetKey) break;
    const current = nodes.get(currentKey)!;

    for (const nextKey of unvisited) {
      const next = nodes.get(nextKey)!;
      const sharesHorizontalDuct = Math.abs(current.y - next.y) < epsilon
        && onChannel(current.y, horizontalChannels);
      const sharesVerticalDuct = Math.abs(current.x - next.x) < epsilon
        && onChannel(current.x, verticalChannels);
      if (!sharesHorizontalDuct && !sharesVerticalDuct) continue;
      const candidate = currentDistance + distance(current, next);
      if (candidate >= (distances.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(nextKey, candidate);
      previous.set(nextKey, currentKey);
    }
  }

  if (!distances.has(targetKey)) {
    throw new Error(`线槽路由网络不连通: ${source.axis} → ${target.axis}`);
  }

  const route: RoutePoint[] = [];
  let key: string | undefined = targetKey;
  while (key) {
    route.push(nodes.get(key)!);
    key = previous.get(key);
  }
  return simplify(route.reverse());
}

export function routeOrthogonal({
  source,
  target,
  obstacles,
  laneIndex = 0,
  clearance = 18,
  bendPenalty = 34,
  preferredHorizontalChannels = [],
  preferredVerticalChannels = [],
}: RouteOptions): RoutePoint[] {
  const laneBand = laneIndex % 9;
  const inflated = obstacles.map((rect) => inflate(rect, clearance));
  const lane = laneBand * 9;
  const xs = new Set<number>([source.x, target.x, (source.x + target.x) / 2 + lane]);
  const ys = new Set<number>([
    source.y,
    target.y,
    Math.min(source.y, target.y) - 26 - lane,
    Math.max(source.y, target.y) + 26 + lane,
  ]);
  preferredVerticalChannels.forEach((x) => xs.add(x));
  preferredHorizontalChannels.forEach((y) => ys.add(y));

  for (const rect of inflated) {
    xs.add(rect.x);
    xs.add(rect.x + rect.width);
    ys.add(rect.y);
    ys.add(rect.y + rect.height);
  }

  const xValues = [...xs].sort((a, b) => a - b);
  const yValues = [...ys].sort((a, b) => a - b);
  const points = new Map<string, RoutePoint>();
  for (let xIndex = 0; xIndex < xValues.length; xIndex += 1) {
    for (let yIndex = 0; yIndex < yValues.length; yIndex += 1) {
      const point = { x: xValues[xIndex], y: yValues[yIndex] };
      if (!inflated.some((rect) => inside(point, rect))) points.set(pointKey(xIndex, yIndex), point);
    }
  }

  const sourceKey = pointKey(xValues.indexOf(source.x), yValues.indexOf(source.y));
  const targetKey = pointKey(xValues.indexOf(target.x), yValues.indexOf(target.y));
  if (!points.has(sourceKey) || !points.has(targetKey)) {
    const fallbackY = preferredHorizontalChannels[0] ?? Math.min(source.y, target.y) - 26 - lane;
    return simplify([source, { x: source.x, y: fallbackY }, { x: target.x, y: fallbackY }, target]);
  }

  const queue: Array<{ key: string; direction: Direction; cost: number; score: number }> = [
    { key: sourceKey, direction: "start", cost: 0, score: distance(source, target) },
  ];
  const best = new Map<string, number>([[stateKey(sourceKey, "start"), 0]]);
  const previous = new Map<string, string>();
  let finalState: string | null = null;

  while (queue.length) {
    queue.sort((a, b) => a.score - b.score);
    const current = queue.shift()!;
    const currentState = stateKey(current.key, current.direction);
    if (current.cost !== best.get(currentState)) continue;
    if (current.key === targetKey) {
      finalState = currentState;
      break;
    }

    const [xIndex, yIndex] = current.key.split(":").map(Number);
    const candidates: Array<[number, number, Direction]> = [
      [xIndex - 1, yIndex, "horizontal"],
      [xIndex + 1, yIndex, "horizontal"],
      [xIndex, yIndex - 1, "vertical"],
      [xIndex, yIndex + 1, "vertical"],
    ];

    for (const [nextX, nextY, direction] of candidates) {
      const nextKey = pointKey(nextX, nextY);
      const nextPoint = points.get(nextKey);
      const currentPoint = points.get(current.key)!;
      if (!nextPoint || segmentBlocked(currentPoint, nextPoint, inflated)) continue;
      const turnCost = current.direction !== "start" && current.direction !== direction ? bendPenalty : 0;
      const onPreferredChannel = direction === "horizontal"
        ? preferredHorizontalChannels.some((channel) => Math.abs(channel - currentPoint.y) < epsilon)
        : preferredVerticalChannels.some((channel) => Math.abs(channel - currentPoint.x) < epsilon);
      const segmentCost = distance(currentPoint, nextPoint) * (onPreferredChannel ? 0.18 : 1);
      const cost = current.cost + segmentCost + turnCost;
      const nextState = stateKey(nextKey, direction);
      if (cost >= (best.get(nextState) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(nextState, cost);
      previous.set(nextState, currentState);
      queue.push({ key: nextKey, direction, cost, score: cost + distance(nextPoint, target) });
    }
  }

  if (!finalState) {
    const fallbackY = Math.min(source.y, target.y) - 26 - lane;
    return simplify([source, { x: source.x, y: fallbackY }, { x: target.x, y: fallbackY }, target]);
  }

  const route: RoutePoint[] = [];
  let state: string | undefined = finalState;
  while (state) {
    const parts = state.split(":");
    route.push(points.get(`${parts[0]}:${parts[1]}`)!);
    state = previous.get(state);
  }
  return simplify(route.reverse());
}

export function roundedOrthogonalPath(points: RoutePoint[], radius = 8): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incoming = Math.min(radius, distance(previous, current) / 2);
    const outgoing = Math.min(radius, distance(current, next) / 2);
    const before = {
      x: current.x + Math.sign(previous.x - current.x) * incoming,
      y: current.y + Math.sign(previous.y - current.y) * incoming,
    };
    const after = {
      x: current.x + Math.sign(next.x - current.x) * outgoing,
      y: current.y + Math.sign(next.y - current.y) * outgoing,
    };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }

  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}
