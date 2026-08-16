import { getAsset } from "./catalog";
import type { DeviceInstance } from "./types";

export const BOARD_WIDTH = 17;
export const BOARD_DEPTH = 13.4;
export const BOARD_HALF_WIDTH = BOARD_WIDTH / 2;
export const BOARD_HALF_DEPTH = BOARD_DEPTH / 2;
export const BOARD_EDGE_CLEARANCE = 0.48;
export const DEVICE_GAP = 0.24;

// 参照用户提供的柜内模板：四层安装区、五条横线槽和左右两条竖线槽。
export const RAIL_ROWS = [-4.7, -1.55, 1.55, 4.7] as const;
export const WIRE_DUCT_ROWS = [-6.1, -3.15, 0, 3.15, 6.1] as const;
export const WIRE_DUCT_COLUMNS = [-7.75, 7.75] as const;

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
  const halfWidth = getAsset(assetId).footprint.width / 2;
  const boundedX = clamp(
    x,
    -BOARD_HALF_WIDTH + BOARD_EDGE_CLEARANCE + halfWidth,
    BOARD_HALF_WIDTH - BOARD_EDGE_CLEARANCE - halfWidth,
  );
  return [Math.round(boundedX * 20) / 20, nearestRail(z)];
}

export function findAvailablePlacement(
  assetId: string,
  preferredX: number,
  preferredZ: number,
  instances: DeviceInstance[],
  options: { ignoredInstanceId?: string; tryOtherRails?: boolean } = {},
): [number, number] {
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
