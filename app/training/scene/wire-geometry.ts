import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec3, WireStyle } from "./types";

// At 20 mm per scene unit this is a 6.4 mm bend. Together with the widest
// routing lane and insulation it stays inside the 30 mm wire ducts.
export const WIRE_CORNER_RADIUS = 0.32;

export function createWireCurve(points: Vec3[], style: WireStyle, bendRadius = WIRE_CORNER_RADIUS) {
  const vectors = points.map((point) => new THREE.Vector3(...point))
    .filter((point, index, list) => index === 0 || point.distanceToSquared(list[index - 1]) > 1e-12);
  const path = new THREE.CurvePath<THREE.Vector3>();
  if (vectors.length < 2) throw new Error("导线路径至少需要两个不同的世界坐标");

  if (style === "straight") {
    for (let index = 1; index < vectors.length; index += 1) {
      path.add(new THREE.LineCurve3(vectors[index - 1], vectors[index]));
    }
    return path;
  }

  let cursor = vectors[0].clone();
  for (let index = 1; index < vectors.length - 1; index += 1) {
    const previous = vectors[index - 1];
    const current = vectors[index];
    const next = vectors[index + 1];
    const incoming = current.clone().sub(previous);
    const outgoing = next.clone().sub(current);
    const before = current.clone().add(incoming.clone().normalize().multiplyScalar(-Math.min(bendRadius, incoming.length() / 2)));
    const after = current.clone().add(outgoing.clone().normalize().multiplyScalar(Math.min(bendRadius, outgoing.length() / 2)));
    if (cursor.distanceToSquared(before) > 1e-12) path.add(new THREE.LineCurve3(cursor.clone(), before.clone()));
    path.add(new THREE.QuadraticBezierCurve3(before, current.clone(), after));
    cursor = after;
  }

  const end = vectors.at(-1)!;
  if (cursor.distanceToSquared(end) > 1e-12) path.add(new THREE.LineCurve3(cursor, end));
  return path;
}

export function createWireGeometry(points: Vec3[], style: WireStyle, radius: number): THREE.BufferGeometry {
  const path = createWireCurve(points, style);
  if (style === "curve") return new THREE.TubeGeometry(path, Math.max(64, points.length * 24), radius, 10, false);

  // Sampling one TubeGeometry over a polyline can cut across corners. Build
  // each straight segment separately so every route vertex is retained.
  const pieces: THREE.BufferGeometry[] = path.curves.map((segment) => new THREE.TubeGeometry(segment, 1, radius, 10, false));
  for (const point of points.slice(1, -1)) {
    pieces.push(new THREE.SphereGeometry(radius, 10, 6).translate(...point));
  }
  const merged = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  if (!merged) throw new Error("无法生成导线几何体");
  return merged;
}
