"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BOARD_DEPTH,
  BOARD_HALF_DEPTH,
  BOARD_HALF_WIDTH,
  BOARD_WIDTH,
  RAIL_ROWS,
  WIRE_DUCT_COLUMNS,
  WIRE_DUCT_ROWS,
} from "./layout";

function Perforations() {
  const cavityRef = useRef<THREE.InstancedMesh>(null);
  const rimRef = useRef<THREE.InstancedMesh>(null);
  const positions = useMemo(() => {
    const result: Array<[number, number]> = [];
    for (let x = -BOARD_HALF_WIDTH + 0.36; x <= BOARD_HALF_WIDTH - 0.36; x += 0.44) {
      for (let z = -BOARD_HALF_DEPTH + 0.36; z <= BOARD_HALF_DEPTH - 0.36; z += 0.42) result.push([x, z]);
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
        <cylinderGeometry args={[0.055, 0.072, 0.085, 14]} />
        <meshStandardMaterial color="#222b31" roughness={0.78} metalness={0.45} />
      </instancedMesh>
      <instancedMesh ref={rimRef} args={[undefined, undefined, positions.length]}>
        <torusGeometry args={[0.066, 0.012, 5, 14]} />
        <meshStandardMaterial color="#aeb9bf" roughness={0.38} metalness={0.82} />
      </instancedMesh>
    </>
  );
}

function DinRail({ z }: { z: number }) {
  const railWidth = BOARD_WIDTH - 1.65;
  const slots = useMemo(() => Array.from(
    { length: Math.floor((railWidth - 0.5) / 0.5) },
    (_, index) => -railWidth / 2 + 0.42 + index * 0.5,
  ), [railWidth]);
  return (
    <group position={[0, 0.25, z]}>
      <mesh>
        <boxGeometry args={[railWidth, 0.18, 0.34]} />
        <meshStandardMaterial color="#cbd3d7" roughness={0.28} metalness={0.86} />
      </mesh>
      <mesh position={[0, 0.105, 0]}>
        <boxGeometry args={[railWidth - 0.55, 0.035, 0.13]} />
        <meshStandardMaterial color="#626e75" roughness={0.48} metalness={0.7} />
      </mesh>
      {slots.map((x) => (
        <mesh position={[x, 0.135, 0]} key={x}>
          <boxGeometry args={[0.24, 0.045, 0.12]} />
          <meshStandardMaterial color="#303a40" roughness={0.65} metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function HorizontalWireDuct({ z }: { z: number }) {
  const ductWidth = BOARD_WIDTH - 1.05;
  const slots = useMemo(() => Array.from(
    { length: Math.floor((ductWidth - 0.35) / 0.295) },
    (_, index) => -ductWidth / 2 + 0.3 + index * 0.295,
  ), [ductWidth]);
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0.235, 0]}>
        <boxGeometry args={[ductWidth, 0.12, 0.5]} />
        <meshStandardMaterial color="#d9dfe2" roughness={0.62} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0.303, 0]}>
        <boxGeometry args={[ductWidth - 0.34, 0.025, 0.27]} />
        <meshStandardMaterial color="#65727a" roughness={0.82} />
      </mesh>
      {slots.map((x) => (
        <group key={x}>
          <mesh position={[x, 0.47, -0.21]}>
            <boxGeometry args={[0.12, 0.34, 0.08]} />
            <meshStandardMaterial color="#eef1f2" roughness={0.58} />
          </mesh>
          <mesh position={[x, 0.47, 0.21]}>
            <boxGeometry args={[0.12, 0.34, 0.08]} />
            <meshStandardMaterial color="#eef1f2" roughness={0.58} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function VerticalWireDuct({ x }: { x: number }) {
  const ductDepth = BOARD_DEPTH - 1.05;
  const slots = useMemo(() => Array.from(
    { length: Math.floor((ductDepth - 0.35) / 0.295) },
    (_, index) => -ductDepth / 2 + 0.3 + index * 0.295,
  ), [ductDepth]);
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0.235, 0]}>
        <boxGeometry args={[0.5, 0.12, ductDepth]} />
        <meshStandardMaterial color="#d9dfe2" roughness={0.62} metalness={0.08} />
      </mesh>
      <mesh position={[0, 0.303, 0]}>
        <boxGeometry args={[0.27, 0.025, ductDepth - 0.34]} />
        <meshStandardMaterial color="#65727a" roughness={0.82} />
      </mesh>
      {slots.map((z) => (
        <group key={z}>
          <mesh position={[-0.21, 0.47, z]}>
            <boxGeometry args={[0.08, 0.34, 0.12]} />
            <meshStandardMaterial color="#eef1f2" roughness={0.58} />
          </mesh>
          <mesh position={[0.21, 0.47, z]}>
            <boxGeometry args={[0.08, 0.34, 0.12]} />
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
        <boxGeometry args={[BOARD_WIDTH, 0.22, BOARD_DEPTH]} />
        <meshStandardMaterial color="#9da8ae" roughness={0.46} metalness={0.72} />
      </mesh>
      <mesh position={[0, -0.16, 0]}>
        <boxGeometry args={[BOARD_WIDTH + 0.22, 0.18, BOARD_DEPTH + 0.22]} />
        <meshStandardMaterial color="#606d74" roughness={0.45} metalness={0.78} />
      </mesh>
      <Perforations />
      {RAIL_ROWS.map((z) => <DinRail z={z} key={`rail-${z}`} />)}
      {WIRE_DUCT_ROWS.map((z) => <HorizontalWireDuct z={z} key={`duct-row-${z}`} />)}
      {WIRE_DUCT_COLUMNS.map((x) => <VerticalWireDuct x={x} key={`duct-column-${x}`} />)}
      {([[-BOARD_HALF_WIDTH + 0.28, -BOARD_HALF_DEPTH + 0.28], [BOARD_HALF_WIDTH - 0.28, -BOARD_HALF_DEPTH + 0.28], [-BOARD_HALF_WIDTH + 0.28, BOARD_HALF_DEPTH - 0.28], [BOARD_HALF_WIDTH - 0.28, BOARD_HALF_DEPTH - 0.28]] as Array<[number, number]>).map(([x, z]) => (
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
