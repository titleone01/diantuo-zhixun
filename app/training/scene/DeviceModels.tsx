"use client";

import { Html, useCursor, useGLTF } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { getAsset } from "./catalog";
import { useWiringSceneStore } from "./store";
import type { ComponentAsset, ComponentTerminal, DeviceInstance } from "./types";
import { terminalId } from "./types";

const assetUrl = (path: string) => `${import.meta.env.BASE_URL ?? "/"}${path}`;

function TerminalPort({ instance, terminal }: { instance: DeviceInstance; terminal: ComponentTerminal }) {
  const id = terminalId(instance.id, terminal.key);
  const pending = useWiringSceneStore((state) => state.pendingTerminal);
  const beginTerminal = useWiringSceneStore((state) => state.beginTerminal);
  const finishTerminal = useWiringSceneStore((state) => state.finishTerminal);
  const world = [
    instance.position[0] + terminal.position[0],
    instance.position[1] + terminal.position[1],
    instance.position[2] + terminal.position[2],
  ];

  return (
    <Html position={terminal.position} center zIndexRange={[30, 10]}>
      <button
        type="button"
        className={`scene-terminal ${pending === id ? "is-connecting" : ""}`}
        aria-label={`端子 ${instance.reference}-${terminal.key}`}
        aria-pressed={pending === id}
        data-terminal-id={id}
        data-world-position={world.map((value) => value.toFixed(4)).join(",")}
        title={`${instance.reference}-${terminal.key} · 拖到另一个螺丝接线`}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          beginTerminal(id);
        }}
        onPointerUp={(event) => {
          event.preventDefault();
          event.stopPropagation();
          finishTerminal(id);
        }}
        onDragStart={(event) => event.preventDefault()}
      >
        <span>{terminal.label}</span>
      </button>
    </Html>
  );
}

function DeviceCaption({
  instance,
  asset,
  expanded,
}: {
  instance: DeviceInstance;
  asset: ComponentAsset;
  expanded: boolean;
}) {
  if (!expanded) return null;
  return (
    <Html position={[0, asset.footprint.height + 0.24, 0]} center style={{ pointerEvents: "none" }}>
      <div
        className="scene-device-caption is-expanded"
        aria-label={`${instance.reference} ${asset.name} ${asset.model}`}
        title={`${instance.reference} · ${asset.name} · ${asset.model}`}
      >
        <b>{instance.reference}</b><span>{asset.name}</span><small>{asset.model}</small>
      </div>
    </Html>
  );
}

function GltfDevice({ path, modelScale }: { path: string; modelScale: number }) {
  const gltf = useGLTF(assetUrl(path));
  const object = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = false;
      child.receiveShadow = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = Math.max(material.roughness, 0.38);
          material.metalness = Math.min(material.metalness, 0.78);
        }
      });
    });
    return clone;
  }, [gltf.scene]);

  return <primitive object={object} scale={modelScale} />;
}

function Screw({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh>
        <cylinderGeometry args={[0.12, 0.13, 0.055, 24]} />
        <meshStandardMaterial color="#d9e0e3" roughness={0.22} metalness={0.94} />
      </mesh>
      <mesh position={[0, 0.032, 0]}>
        <boxGeometry args={[0.14, 0.025, 0.026]} />
        <meshStandardMaterial color="#4b555b" roughness={0.55} metalness={0.78} />
      </mesh>
    </group>
  );
}

function BreakerModel({ asset }: { asset: ComponentAsset }) {
  return (
    <group>
      <mesh position={[0, 0.73, 0]}>
        <boxGeometry args={[2.16, 1.28, 1.34]} />
        <meshStandardMaterial color="#e9e9e4" roughness={0.56} />
      </mesh>
      {[-0.72, 0, 0.72].map((x) => (
        <group position={[x, 1.14, 0]} key={x}>
          <mesh>
            <boxGeometry args={[0.52, 0.2, 0.58]} />
            <meshStandardMaterial color="#f8f8f3" roughness={0.55} />
          </mesh>
          <mesh position={[0, 0.11, 0.04]}>
            <boxGeometry args={[0.42, 0.12, 0.16]} />
            <meshStandardMaterial color="#176bb3" roughness={0.35} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.63, -0.68]}>
        <boxGeometry args={[1.95, 0.36, 0.035]} />
        <meshStandardMaterial color="#f4f6f2" roughness={0.62} />
      </mesh>
      {asset.terminals.map((terminal) => <Screw position={terminal.position} key={terminal.key} />)}
    </group>
  );
}

function ContactorModel({ asset }: { asset: ComponentAsset }) {
  return (
    <group>
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[2.44, 1.42, 1.62]} />
        <meshStandardMaterial color="#f0f1ed" roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.12, 0]}>
        <boxGeometry args={[1.32, 0.42, 0.76]} />
        <meshStandardMaterial color="#202b35" roughness={0.42} />
      </mesh>
      {[-0.42, 0, 0.42].map((x) => (
        <mesh position={[x, 1.35, 0.07]} key={x}>
          <boxGeometry args={[0.31, 0.16, 0.44]} />
          <meshStandardMaterial color="#114a9a" roughness={0.38} />
        </mesh>
      ))}
      <mesh position={[0, 0.48, 0.82]}>
        <boxGeometry args={[2.05, 0.45, 0.04]} />
        <meshStandardMaterial color="#222d36" roughness={0.7} />
      </mesh>
      {asset.terminals.map((terminal) => <Screw position={terminal.position} key={terminal.key} />)}
    </group>
  );
}

export function DeviceModel({ instance }: { instance: DeviceInstance }) {
  const asset = getAsset(instance.assetId);
  const beginMoveInstance = useWiringSceneStore((state) => state.beginMoveInstance);
  const moveInstance = useWiringSceneStore((state) => state.moveInstance);
  const finishMoveInstance = useWiringSceneStore((state) => state.finishMoveInstance);
  const moving = useWiringSceneStore((state) => state.movingInstanceId === instance.id);
  const [hovered, setHovered] = useState(false);
  const dragOffset = useRef<[number, number] | null>(null);
  useCursor(hovered || moving, moving ? "grabbing" : "grab");

  const pointOnBoard = (ray: THREE.Ray) => {
    const point = new THREE.Vector3();
    return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2), point) ? point : null;
  };

  return (
    <group
      position={instance.position}
      rotation={[0, instance.rotationY, 0]}
      name={instance.reference}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const point = pointOnBoard(event.ray);
        if (!point) return;
        dragOffset.current = [instance.position[0] - point.x, instance.position[2] - point.z];
        (event.target as (EventTarget & { setPointerCapture: (pointerId: number) => void }) | null)
          ?.setPointerCapture(event.pointerId);
        beginMoveInstance(instance.id);
      }}
      onPointerMove={(event) => {
        if (!dragOffset.current) return;
        event.stopPropagation();
        const point = pointOnBoard(event.ray);
        if (!point) return;
        moveInstance(instance.id, point.x + dragOffset.current[0], point.z + dragOffset.current[1]);
      }}
      onPointerUp={(event) => {
        if (!dragOffset.current) return;
        event.stopPropagation();
        dragOffset.current = null;
        (event.target as (EventTarget & { releasePointerCapture: (pointerId: number) => void }) | null)
          ?.releasePointerCapture(event.pointerId);
        finishMoveInstance(instance.id);
      }}
      onPointerCancel={() => {
        dragOffset.current = null;
        finishMoveInstance(instance.id);
      }}
    >
      {asset.geometry.kind === "gltf"
        ? <GltfDevice path={asset.geometry.path} modelScale={asset.geometry.modelScale} />
        : asset.geometry.shape === "breaker-3p"
          ? <BreakerModel asset={asset} />
          : <ContactorModel asset={asset} />}
      {asset.terminals.map((terminal) => (
        <TerminalPort instance={instance} terminal={terminal} key={terminal.key} />
      ))}
      <DeviceCaption instance={instance} asset={asset} expanded={hovered && !moving} />
    </group>
  );
}

useGLTF.preload(assetUrl("models/chint/tb-1506/CHINT_TB-1506_no-cover.glb"));
