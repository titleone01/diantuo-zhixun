"use client";

import { Html } from "@react-three/drei/web/Html.js";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { resolveTerminal } from "./catalog";
import { buildWireRoute } from "./routing";
import { useWiringSceneStore } from "./store";
import type { DeviceInstance, SceneWire, Vec3 } from "./types";
import { createWireGeometry } from "./wire-geometry";
import { DEFAULT_WIRE_STYLE, getWireColor, normalizeWireStyle } from "./wire-style";

function WireLug({ position, color }: { position: Vec3; color: string }) {
  return (
    <group position={[position[0], position[1] + 0.035, position[2]]}>
      <mesh>
        <cylinderGeometry args={[0.145, 0.145, 0.045, 24]} />
        <meshStandardMaterial color="#c8d0d4" roughness={0.2} metalness={0.96} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.09, 0.032, 8, 24]} />
        <meshStandardMaterial color={color} roughness={0.48} metalness={0.12} />
      </mesh>
      <mesh position={[0, 0.035, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.025, 18]} />
        <meshStandardMaterial color="#39464e" roughness={0.7} metalness={0.55} />
      </mesh>
    </group>
  );
}

function labelPosition(points: Vec3[]): Vec3 {
  let bestStart = points[0];
  let bestEnd = points.at(-1)!;
  let bestScore = -1;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.abs(end[0] - start[0]) + Math.abs(end[2] - start[2]);
    const horizontalBonus = Math.abs(end[2] - start[2]) < 0.001 ? 4 : 0;
    if (length + horizontalBonus > bestScore) {
      bestStart = start;
      bestEnd = end;
      bestScore = length + horizontalBonus;
    }
  }
  return [
    (bestStart[0] + bestEnd[0]) / 2,
    Math.max(bestStart[1], bestEnd[1]) + 0.2,
    (bestStart[2] + bestEnd[2]) / 2,
  ];
}

export function Wire3D({ wire, instances, index }: { wire: SceneWire; instances: DeviceInstance[]; index: number }) {
  const selectedWireId = useWiringSceneStore((state) => state.selectedWireId);
  const selectWire = useWiringSceneStore((state) => state.selectWire);
  const points = useMemo(() => buildWireRoute(instances, wire, index), [index, instances, wire]);
  const style = normalizeWireStyle(wire.style) ?? DEFAULT_WIRE_STYLE;
  const selected = selectedWireId === wire.id;
  const [hovered, setHovered] = useState(false);
  const from = useMemo(() => resolveTerminal(instances, wire.from), [instances, wire.from]);
  const to = useMemo(() => resolveTerminal(instances, wire.to), [instances, wire.to]);
  const color = getWireColor(wire, from.terminal);
  const tagPosition = useMemo(() => labelPosition(points), [points]);
  const outlineGeometry = useMemo(() => createWireGeometry(points, style, selected ? 0.098 : 0.083), [points, selected, style]);
  const wireGeometry = useMemo(() => createWireGeometry(points, style, selected ? 0.072 : 0.057), [points, selected, style]);
  useEffect(() => () => {
    outlineGeometry.dispose();
    wireGeometry.dispose();
  }, [outlineGeometry, wireGeometry]);

  return (
    <group
      name={wire.id}
      onClick={(event) => {
        event.stopPropagation();
        selectWire(wire.id);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <mesh geometry={outlineGeometry}>
        <meshBasicMaterial
          color={selected ? "#ff7a32" : "#27343d"}
          side={THREE.BackSide}
          transparent
          opacity={selected ? 0.95 : 0.78}
        />
      </mesh>
      <mesh geometry={wireGeometry}>
        <meshStandardMaterial
          color={color}
          roughness={0.34}
          metalness={0.08}
          emissive={color}
          emissiveIntensity={selected ? 0.24 : 0.035}
        />
      </mesh>
      <WireLug position={points[0]} color={color} />
      <WireLug position={points.at(-1)!} color={color} />
      {(hovered || selected) && (
        <Html position={tagPosition} center zIndexRange={[24, 12]} style={{ pointerEvents: "none" }}>
          <div className={`scene-wire-label ${selected ? "is-selected" : ""}`}>
            <b>导线 {index + 1}</b><span>{from.electricalId} → {to.electricalId}</span>
          </div>
        </Html>
      )}
    </group>
  );
}
