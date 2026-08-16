import { routeInDuctNetwork, type DuctAxis, type DuctEntry, type RoutePoint } from "../wire-routing";
import { resolveTerminal } from "./catalog";
import { WIRE_DUCT_COLUMNS, WIRE_DUCT_ROWS } from "./layout";
import type { DeviceInstance, SceneWire, Vec3 } from "./types";

const scale = 100;
const laneOffset = (index: number) => {
  const lane = index % 5;
  if (lane === 0) return 0;
  const distance = Math.ceil(lane / 2) * 0.0375;
  return lane % 2 ? distance : -distance;
};

const point2d = (point: Vec3): RoutePoint => ({ x: point[0] * scale, y: point[2] * scale });
const DUCT_WIRE_HEIGHT = 0.42;
const APPROACH_HEIGHT = 0.72;

type SceneDuctEntry = DuctEntry & { world: Vec3 };

const nearestDuctEntry = (
  exit: Vec3,
  horizontalChannels: number[],
  verticalChannels: number[],
): SceneDuctEntry => {
  const nearestHorizontal = horizontalChannels.reduce((best, channel) => (
    Math.abs(channel - exit[2]) < Math.abs(best - exit[2]) ? channel : best
  ));
  const nearestVertical = verticalChannels.reduce((best, channel) => (
    Math.abs(channel - exit[0]) < Math.abs(best - exit[0]) ? channel : best
  ));
  const horizontalDistance = Math.abs(nearestHorizontal - exit[2]);
  const verticalDistance = Math.abs(nearestVertical - exit[0]);
  const axis: DuctAxis = horizontalDistance <= verticalDistance ? "horizontal" : "vertical";
  const world: Vec3 = axis === "horizontal"
    ? [exit[0], DUCT_WIRE_HEIGHT, nearestHorizontal]
    : [nearestVertical, DUCT_WIRE_HEIGHT, exit[2]];
  return { axis, world, point: point2d(world) };
};

const samePoint = (a: Vec3, b: Vec3) => (
  Math.abs(a[0] - b[0]) < 0.0001 && Math.abs(a[1] - b[1]) < 0.0001 && Math.abs(a[2] - b[2]) < 0.0001
);

export function buildWireRoute(instances: DeviceInstance[], wire: SceneWire, index: number): Vec3[] {
  const source = resolveTerminal(instances, wire.from);
  const target = resolveTerminal(instances, wire.to);
  const offset = laneOffset(index % 10);
  const horizontalChannels = WIRE_DUCT_ROWS.map((value) => value + offset);
  const verticalChannels = WIRE_DUCT_COLUMNS.map((value) => value + offset);
  const sourceEntry = nearestDuctEntry(source.exit, horizontalChannels, verticalChannels);
  const targetEntry = nearestDuctEntry(target.exit, horizontalChannels, verticalChannels);
  const routed = routeInDuctNetwork({
    source: sourceEntry,
    target: targetEntry,
    horizontalChannels: horizontalChannels.map((value) => value * scale),
    verticalChannels: verticalChannels.map((value) => value * scale),
  }).map<Vec3>((point) => [point.x / scale, DUCT_WIRE_HEIGHT + Math.floor(index / 5) * 0.012, point.y / scale]);
  const sourceApproach: Vec3 = [sourceEntry.world[0], APPROACH_HEIGHT, sourceEntry.world[2]];
  const targetApproach: Vec3 = [targetEntry.world[0], APPROACH_HEIGHT, targetEntry.world[2]];

  return [source.world, source.exit, sourceApproach, sourceEntry.world, ...routed, targetEntry.world, targetApproach, target.exit, target.world]
    .filter((point, pointIndex, list) => pointIndex === 0 || !samePoint(point, list[pointIndex - 1]));
}
