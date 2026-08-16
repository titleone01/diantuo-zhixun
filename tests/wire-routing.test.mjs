import assert from "node:assert/strict";
import test from "node:test";

import { roundedOrthogonalPath, routeInDuctNetwork, routeOrthogonal } from "../app/training/wire-routing.ts";

const crossesRect = (a, b, rect) => {
  if (a.y === b.y) {
    return a.y > rect.y && a.y < rect.y + rect.height
      && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width;
  }
  if (a.x === b.x) {
    return a.x > rect.x && a.x < rect.x + rect.width
      && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height;
  }
  return true;
};

test("routes an orthogonal wire around a component obstacle", () => {
  const obstacle = { x: 40, y: -20, width: 20, height: 40 };
  const route = routeOrthogonal({
    source: { x: 0, y: 0 },
    target: { x: 100, y: 0 },
    obstacles: [obstacle],
    clearance: 10,
  });

  assert.ok(route.length >= 4);
  for (let index = 1; index < route.length; index += 1) {
    assert.equal(route[index - 1].x === route[index].x || route[index - 1].y === route[index].y, true);
    assert.equal(crossesRect(route[index - 1], route[index], obstacle), false);
  }
});

test("uses deterministic lanes to keep parallel wires separated", () => {
  const options = {
    source: { x: 10, y: 80 },
    target: { x: 210, y: 80 },
    obstacles: [{ x: 90, y: 40, width: 40, height: 80 }],
    clearance: 12,
  };
  const first = routeOrthogonal({ ...options, laneIndex: 0, preferredHorizontalChannels: [25] });
  const later = routeOrthogonal({ ...options, laneIndex: 4, preferredHorizontalChannels: [135] });

  assert.notDeepEqual(first, later);
});

test("rounds orthogonal corners without changing endpoints", () => {
  const path = roundedOrthogonalPath([
    { x: 0, y: 0 },
    { x: 0, y: 40 },
    { x: 80, y: 40 },
    { x: 80, y: 90 },
  ]);

  assert.match(path, /^M 0 0/);
  assert.match(path, /Q 0 40/);
  assert.match(path, /L 80 90$/);
});

test("keeps the long run inside the physical wire-duct network", () => {
  const horizontalChannels = [-60, -30, 0, 30, 60];
  const verticalChannels = [-75, 75];
  const route = routeInDuctNetwork({
    source: { point: { x: -18, y: -30 }, axis: "horizontal" },
    target: { point: { x: -12, y: 60 }, axis: "horizontal" },
    horizontalChannels,
    verticalChannels,
  });

  assert.deepEqual(route, [
    { x: -18, y: -30 },
    { x: -75, y: -30 },
    { x: -75, y: 60 },
    { x: -12, y: 60 },
  ]);
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const insideHorizontalDuct = start.y === end.y && horizontalChannels.includes(start.y);
    const insideVerticalDuct = start.x === end.x && verticalChannels.includes(start.x);
    assert.equal(insideHorizontalDuct || insideVerticalDuct, true);
  }
});

test("uses the shortest connected duct intersection instead of crossing the board", () => {
  const route = routeInDuctNetwork({
    source: { point: { x: -65, y: -30 }, axis: "horizontal" },
    target: { point: { x: -55, y: 30 }, axis: "horizontal" },
    horizontalChannels: [-30, 30],
    verticalChannels: [-75, 75],
  });

  assert.equal(route.some((point) => point.x === -75), true);
  assert.equal(route.some((point) => point.x === 75), false);
});
