import { getAsset } from "./catalog";
import { mmToScene } from "./scale";
import type { DeviceInstance } from "./types";

export const BOARD_WIDTH_MM = 600;
export const BOARD_DEPTH_MM = 700;
export const BOARD_WIDTH = mmToScene(BOARD_WIDTH_MM);
export const BOARD_DEPTH = mmToScene(BOARD_DEPTH_MM);
export const BOARD_HALF_WIDTH = BOARD_WIDTH / 2;
export const BOARD_HALF_DEPTH = BOARD_DEPTH / 2;
export const BOARD_EDGE_CLEARANCE = mmToScene(50);
export const DEVICE_GAP = mmToScene(10);
export const DIN_RAIL_FACE_WIDTH = mmToScene(35);
export const DIN_RAIL_MOUNT_Y = mmToScene(5);
export const WIRE_DUCT_FACE_WIDTH = mmToScene(30);
export const WIRE_DUCT_WALL_HEIGHT = mmToScene(30);
export const WIRE_DUCT_WIRE_HEIGHT = mmToScene(12);
export const BOARD_HOLE_PITCH = mmToScene(25);

// 600 × 700 mm mounting plate: four usable 125 mm installation bands are
// separated by five 30 mm wire ducts. Coordinates stay in the shared mm scale.
export const RAIL_ROWS = [-245, -80, 80, 245].map(mmToScene) as readonly number[];
export const WIRE_DUCT_ROWS = [-320, -165, 0, 165, 320].map(mmToScene) as readonly number[];
export const WIRE_DUCT_COLUMNS = [-270, 270].map(mmToScene) as readonly number[];

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

const nearestRail = (z: number) => RAIL_ROWS.reduce((best, row) => (
  Math.abs(row - z) < Math.abs(best - z) ? row : best
));

const overlaps = (
  x: number,
  halfWidth: number,
  rail: number,
  instances: DeviceInstance[],
  ignoredInstanceId?: string,
) => instances.some((instance) => {
  if (instance.id === ignoredInstanceId || Math.abs(instance.position[2] - rail) > 0.05) return false;
  const occupiedHalfWidth = getAsset(instance.assetId).footprint.width / 2;
  return Math.abs(instance.position[0] - x) < occupiedHalfWidth + halfWidth + DEVICE_GAP;
});

const freeXOnRail = (
  assetId: string,
  preferredX: number,
  rail: number,
  instances: DeviceInstance[],
  ignoredInstanceId?: string,
) => {
  const halfWidth = getAsset(assetId).footprint.width / 2;
  const minimumX = -BOARD_HALF_WIDTH + BOARD_EDGE_CLEARANCE + halfWidth;
  const maximumX = BOARD_HALF_WIDTH - BOARD_EDGE_CLEARANCE - halfWidth;
  const desiredX = clamp(preferredX, minimumX, maximumX);
  const candidates = new Set<number>([desiredX, clamp(0, minimumX, maximumX)]);

  for (const instance of instances) {
    if (instance.id === ignoredInstanceId || Math.abs(instance.position[2] - rail) > 0.05) continue;
    const occupiedHalfWidth = getAsset(instance.assetId).footprint.width / 2;
    const spacing = occupiedHalfWidth + halfWidth + DEVICE_GAP;
    candidates.add(clamp(instance.position[0] - spacing, minimumX, maximumX));
    candidates.add(clamp(instance.position[0] + spacing, minimumX, maximumX));
  }

  return [...candidates]
    .sort((left, right) => Math.abs(left - desiredX) - Math.abs(right - desiredX) || Math.abs(left) - Math.abs(right))
    .find((candidate) => !overlaps(candidate, halfWidth, rail, instances, ignoredInstanceId));
};

export function clampToBoardAndRail(assetId: string, x: number, z: number): [number, number] {
  const asset = getAsset(assetId);
  const halfWidth = asset.footprint.width / 2;
  const boundedX = clamp(
    x,
    -BOARD_HALF_WIDTH + BOARD_EDGE_CLEARANCE + halfWidth,
    BOARD_HALF_WIDTH - BOARD_EDGE_CLEARANCE - halfWidth,
  );
  if (asset.mounting.type === "panel-screw") {
    const halfDepth = asset.footprint.depth / 2;
    const boundedZ = clamp(
      z,
      -BOARD_HALF_DEPTH + BOARD_EDGE_CLEARANCE + halfDepth,
      BOARD_HALF_DEPTH - BOARD_EDGE_CLEARANCE - halfDepth,
    );
    return [Math.round(boundedX * 20) / 20, Math.round(boundedZ * 20) / 20];
  }
  return [Math.round(boundedX * 20) / 20, nearestRail(z)];
}

export function findAvailablePlacement(
  assetId: string,
  preferredX: number,
  preferredZ: number,
  instances: DeviceInstance[],
  options: { ignoredInstanceId?: string; tryOtherRails?: boolean } = {},
): [number, number] {
  if (getAsset(assetId).mounting.type === "panel-screw") {
    return clampToBoardAndRail(assetId, preferredX, preferredZ);
  }
  const preferredRail = nearestRail(preferredZ);
  const rails = options.tryOtherRails
    ? [...RAIL_ROWS].sort((left, right) => Math.abs(left - preferredRail) - Math.abs(right - preferredRail))
    : [preferredRail];

  for (const rail of rails) {
    const freeX = freeXOnRail(assetId, preferredX, rail, instances, options.ignoredInstanceId);
    if (freeX !== undefined) return [Math.round(freeX * 20) / 20, rail];
  }

  return clampToBoardAndRail(assetId, preferredX, preferredZ);
}
