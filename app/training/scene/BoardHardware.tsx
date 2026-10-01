"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BOARD_DEPTH,
  BOARD_HOLE_PITCH,
  BOARD_HALF_DEPTH,
  BOARD_HALF_WIDTH,
  BOARD_WIDTH,
  DIN_RAIL_FACE_WIDTH,
  DIN_RAIL_MOUNT_Y,
  RAIL_ROWS,
  WIRE_DUCT_FACE_WIDTH,
  WIRE_DUCT_COLUMNS,
  WIRE_DUCT_ROWS,
  WIRE_DUCT_WALL_HEIGHT,
} from "./layout";
import { mmToScene } from "./scale";

function Perforations() {
  const cavityRef = useRef<THREE.InstancedMesh>(null);
  const rimRef = useRef<THREE.InstancedMesh>(null);
  const positions = useMemo(() => {
    const result: Array<[number, number]> = [];
    for (let x = -BOARD_HALF_WIDTH + BOARD_HOLE_PITCH; x <= BOARD_HALF_WIDTH - BOARD_HOLE_PITCH; x += BOARD_HOLE_PITCH) {
      for (let z = -BOARD_HALF_DEPTH + BOARD_HOLE_PITCH; z <= BOARD_HALF_DEPTH - BOARD_HOLE_PITCH; z += BOARD_HOLE_PITCH) result.push([x, z]);
    }
    return result;
  }, []);

  useLayoutEffect(() => {
    const cavity = cavityRef.current;
    const rim = rimRef.current;
    if (!cavity || !rim) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const scale = new THREE.Vector3(1, 1, 1);
    positions.forEach(([x, z], index) => {
      matrix.compose(new THREE.Vector3(x, 0.135, z), new THREE.Quaternion(), scale);
      cavity.setMatrixAt(index, matrix);
      matrix.compose(new THREE.Vector3(x, 0.153, z), rotation, scale);
      rim.setMatrixAt(index, matrix);
    });
    cavity.instanceMatrix.needsUpdate = true;
    rim.instanceMatrix.needsUpdate = true;
  }, [positions]);

  return (
    <>
      <instancedMesh ref={cavityRef} args={[undefined, undefined, positions.length]}>
        <cylinderGeometry args={[mmToScene(2.5), mmToScene(2.8), mmToScene(2), 18]} />
        <meshStandardMaterial color="#222b31" roughness={0.78} metalness={0.45} />
      </instancedMesh>
      <instancedMesh ref={rimRef} args={[undefined, undefined, positions.length]}>
        <torusGeometry args={[mmToScene(3), mmToScene(0.45), 5, 18]} />
        <meshStandardMaterial color="#aeb9bf" roughness={0.38} metalness={0.82} />
      </instancedMesh>
    </>
  );
}

function DinRail({ z }: { z: number }) {
  const railWidth = Math.abs(WIRE_DUCT_COLUMNS[1] - WIRE_DUCT_COLUMNS[0]) - WIRE_DUCT_FACE_WIDTH;
  const slots = useMemo(() => Array.from(
    { length: Math.floor((railWidth - mmToScene(20)) / mmToScene(25)) },
    (_, index) => -railWidth / 2 + mmToScene(18) + index * mmToScene(25),
  ), [railWidth]);
  return (
    <group position={[0, DIN_RAIL_MOUNT_Y, z]}>
      <mesh>
        <boxGeometry args={[railWidth, mmToScene(1.5), DIN_RAIL_FACE_WIDTH]} />
        <meshStandardMaterial color="#cbd3d7" roughness={0.28} metalness={0.86} />
      </mesh>
      <mesh position={[0, mmToScene(1), 0]}>
        <boxGeometry args={[railWidth - mmToScene(12), mmToScene(0.8), mmToScene(15)]} />
        <meshStandardMaterial color="#626e75" roughness={0.48} metalness={0.7} />
      </mesh>
      {slots.map((x) => (
        <mesh position={[x, mmToScene(1.5), 0]} key={x}>
          <boxGeometry args={[mmToScene(14), mmToScene(0.9), mmToScene(6)]} />
          <meshStandardMaterial color="#303a40" roughness={0.65} metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function HorizontalWireDuct({ z }: { z: number }) {
  const ductWidth = Math.abs(WIRE_DUCT_COLUMNS[1] - WIRE_DUCT_COLUMNS[0]);
  const slots = useMemo(() => Array.from(
    { length: Math.floor((ductWidth - mmToScene(10)) / mmToScene(8)) },
    (_, index) => -ductWidth / 2 + mmToScene(7) + index * mmToScene(8),
  ), [ductWidth]);
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, mmToScene(3.5), 0]}>
        <boxGeometry args={[ductWidth, mmToScene(2), WIRE_DUCT_FACE_WIDTH]} />
        <meshStandardMaterial color="#d9dfe2" roughness={0.62} metalness={0.08} />
      </mesh>
      <mesh position={[0, mmToScene(4.8), 0]}>
        <boxGeometry args={[ductWidth - mmToScene(6), mmToScene(0.8), mmToScene(18)]} />
        <meshStandardMaterial color="#65727a" roughness={0.82} />
      </mesh>
      {slots.map((x) => (
        <group key={x}>
          <mesh position={[x, WIRE_DUCT_WALL_HEIGHT / 2, -WIRE_DUCT_FACE_WIDTH / 2 + mmToScene(2)]}>
            <boxGeometry args={[mmToScene(4.5), WIRE_DUCT_WALL_HEIGHT, mmToScene(2)]} />
            <meshStandardMaterial color="#eef1f2" roughness={0.58} />
          </mesh>
          <mesh position={[x, WIRE_DUCT_WALL_HEIGHT / 2, WIRE_DUCT_FACE_WIDTH / 2 - mmToScene(2)]}>
            <boxGeometry args={[mmToScene(4.5), WIRE_DUCT_WALL_HEIGHT, mmToScene(2)]} />
            <meshStandardMaterial color="#eef1f2" roughness={0.58} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function VerticalWireDuct({ x }: { x: number }) {
  const ductDepth = Math.abs(WIRE_DUCT_ROWS.at(-1)! - WIRE_DUCT_ROWS[0]);
  const slots = useMemo(() => Array.from(
    { length: Math.floor((ductDepth - mmToScene(10)) / mmToScene(8)) },
    (_, index) => -ductDepth / 2 + mmToScene(7) + index * mmToScene(8),
  ), [ductDepth]);
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, mmToScene(3.5), 0]}>
        <boxGeometry args={[WIRE_DUCT_FACE_WIDTH, mmToScene(2), ductDepth]} />
        <meshStandardMaterial color="#d9dfe2" roughness={0.62} metalness={0.08} />
      </mesh>
      <mesh position={[0, mmToScene(4.8), 0]}>
        <boxGeometry args={[mmToScene(18), mmToScene(0.8), ductDepth - mmToScene(6)]} />
        <meshStandardMaterial color="#65727a" roughness={0.82} />
      </mesh>
      {slots.map((z) => (
        <group key={z}>
          <mesh position={[-WIRE_DUCT_FACE_WIDTH / 2 + mmToScene(2), WIRE_DUCT_WALL_HEIGHT / 2, z]}>
            <boxGeometry args={[mmToScene(2), WIRE_DUCT_WALL_HEIGHT, mmToScene(4.5)]} />
            <meshStandardMaterial color="#eef1f2" roughness={0.58} />
          </mesh>
          <mesh position={[WIRE_DUCT_FACE_WIDTH / 2 - mmToScene(2), WIRE_DUCT_WALL_HEIGHT / 2, z]}>
            <boxGeometry args={[mmToScene(2), WIRE_DUCT_WALL_HEIGHT, mmToScene(4.5)]} />
            <meshStandardMaterial color="#eef1f2" roughness={0.58} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function BoardHardware() {
  return (
    <group>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[BOARD_WIDTH, mmToScene(2), BOARD_DEPTH]} />
        <meshStandardMaterial color="#9da8ae" roughness={0.46} metalness={0.72} />
      </mesh>
      <mesh position={[0, -mmToScene(3), 0]}>
        <boxGeometry args={[BOARD_WIDTH + mmToScene(8), mmToScene(4), BOARD_DEPTH + mmToScene(8)]} />
        <meshStandardMaterial color="#606d74" roughness={0.45} metalness={0.78} />
      </mesh>
      <Perforations />
      {RAIL_ROWS.map((z) => <DinRail z={z} key={`rail-${z}`} />)}
      {WIRE_DUCT_ROWS.map((z) => <HorizontalWireDuct z={z} key={`duct-row-${z}`} />)}
      {WIRE_DUCT_COLUMNS.map((x) => <VerticalWireDuct x={x} key={`duct-column-${x}`} />)}
      {([[-BOARD_HALF_WIDTH + mmToScene(12), -BOARD_HALF_DEPTH + mmToScene(12)], [BOARD_HALF_WIDTH - mmToScene(12), -BOARD_HALF_DEPTH + mmToScene(12)], [-BOARD_HALF_WIDTH + mmToScene(12), BOARD_HALF_DEPTH - mmToScene(12)], [BOARD_HALF_WIDTH - mmToScene(12), BOARD_HALF_DEPTH - mmToScene(12)]] as Array<[number, number]>).map(([x, z]) => (
        <group position={[x, 0.18, z]} key={`${x}-${z}`}>
          <mesh>
            <cylinderGeometry args={[0.14, 0.16, 0.11, 24]} />
            <meshStandardMaterial color="#d6dde0" roughness={0.24} metalness={0.92} />
          </mesh>
          <mesh position={[0, 0.06, 0]}>
            <boxGeometry args={[0.18, 0.025, 0.035]} />
            <meshStandardMaterial color="#48545a" roughness={0.6} metalness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
