"use client";

import { Html } from "@react-three/drei/web/Html.js";
import { useCursor } from "@react-three/drei/web/useCursor.js";
import { useFrame, useLoader } from "@react-three/fiber";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getAsset, worldTerminalPosition } from "./catalog";
import { useWiringSceneStore } from "./store";
import type { ComponentAsset, ComponentTerminal, DeviceInstance, OperatingState, Vec3 } from "./types";
import { terminalId } from "./types";
import { getTerminalColor } from "./wire-style";

const assetUrl = (path: string) => `${import.meta.env.BASE_URL ?? "/"}${path}`;
const configureGltfLoader = (loader: GLTFLoader) => loader.setMeshoptDecoder(MeshoptDecoder);

function TerminalPort({ instance, terminal }: { instance: DeviceInstance; terminal: ComponentTerminal }) {
  const id = terminalId(instance.id, terminal.key);
  const pending = useWiringSceneStore((state) => state.pendingTerminal);
  const beginTerminal = useWiringSceneStore((state) => state.beginTerminal);
  const finishTerminal = useWiringSceneStore((state) => state.finishTerminal);
  const world = worldTerminalPosition(instance, terminal);
  const terminalColor = getTerminalColor(terminal);

  return (
    <Html position={terminal.position} center zIndexRange={[30, 10]}>
      <button
        type="button"
        className={`scene-terminal ${pending === id ? "is-connecting" : ""}`}
        style={{ "--terminal-color": terminalColor } as CSSProperties}
        aria-label={`端子 ${instance.reference}-${terminal.key}`}
        aria-pressed={pending === id}
        data-terminal-id={id}
        data-terminal-color={terminalColor}
        data-world-position={world.map((value) => value.toFixed(4)).join(",")}
        title={`${instance.reference}-${terminal.key} · 拖到另一个螺钉接线`}
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
        onPointerEnter={(event) => {
          if (event.buttons !== 1 || !pending || pending === id) return;
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

function DeviceCaption({ instance, asset, expanded }: { instance: DeviceInstance; asset: ComponentAsset; expanded: boolean }) {
  if (!expanded) return null;
  return (
    <Html position={[0, asset.footprint.height + 0.28, 0]} center style={{ pointerEvents: "none" }}>
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

type MaterialProfile = Extract<ComponentAsset["geometry"], { kind: "gltf" }>["materialProfile"];

type RenderableGltf = {
  path: string;
  modelScale: number | Vec3;
  modelPosition?: Vec3;
  modelRotation?: Vec3;
  materialProfile?: MaterialProfile;
  interactiveNodes?: {
    breakerHandle?: {
      nodeName: string;
      pivot: Vec3;
      axis: "x" | "y" | "z";
      openAngleRad: number;
      closedAngleRad: number;
    };
    startButton?: string[];
    stopButton?: string[];
  };
};

const tuneMaterial = (material: THREE.Material, profile: MaterialProfile, nodeName: string) => {
  const tuned = material.clone();
  if (!(tuned instanceof THREE.MeshStandardMaterial)) return tuned;

  if (profile === "chint-nxb") {
    const palette: Record<string, { color: string; roughness: number; metalness: number }> = {
      mat_0: { color: "#0875bd", roughness: 0.33, metalness: 0.04 },
      mat_1: { color: "#efefea", roughness: 0.5, metalness: 0.02 },
      mat_2: { color: "#c53b32", roughness: 0.38, metalness: 0.02 },
      mat_3: { color: "#c9d0d2", roughness: 0.3, metalness: 0.74 },
    };
    const style = palette[tuned.name] ?? palette.mat_0;
    tuned.color.set(style.color);
    tuned.roughness = style.roughness;
    tuned.metalness = style.metalness;
  } else if (profile === "chint-white") {
    tuned.color.set("#ecece7");
    tuned.roughness = 0.52;
    tuned.metalness = 0.03;
  } else if (profile === "chint-terminal") {
    tuned.color.set("#e9e9e3");
    tuned.roughness = 0.5;
    tuned.metalness = 0.04;
  } else if (profile === "chint-pe") {
    tuned.color.set(nodeName.includes("mesh") ? "#6f9f23" : "#d8c91e");
    tuned.roughness = 0.5;
    tuned.metalness = 0.04;
  } else if (profile === "chint-np2-green" && nodeName.includes("official-child-0002")) {
    tuned.color.set("#12813a");
    tuned.roughness = 0.35;
    tuned.metalness = 0.02;
  } else if (profile === "chint-np2-red" && nodeName.includes("official-child-0002")) {
    tuned.color.set("#c52a22");
    tuned.roughness = 0.35;
    tuned.metalness = 0.02;
  } else {
    tuned.roughness = Math.max(tuned.roughness, 0.38);
    tuned.metalness = Math.min(tuned.metalness, 0.78);
  }
  return tuned;
};

function GltfScene({ geometry, state }: { geometry: RenderableGltf; state?: OperatingState }) {
  const gltf = useLoader(GLTFLoader, assetUrl(geometry.path), configureGltfLoader);
  const object = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = false;
      child.receiveShadow = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const tuned = materials.map((material) => tuneMaterial(material, geometry.materialProfile, child.name));
      child.material = Array.isArray(child.material) ? tuned : tuned[0];
    });

    const handleMotion = geometry.interactiveNodes?.breakerHandle;
    const handle = handleMotion ? clone.getObjectByName(handleMotion.nodeName) : null;
    if (handle && handleMotion) {
      clone.updateMatrixWorld(true);
      const pivot = new THREE.Group();
      pivot.name = "official-breaker-handle-pivot";
      pivot.position.fromArray(handleMotion.pivot);
      clone.add(pivot);
      pivot.attach(handle);
      clone.userData.breakerHandlePivot = pivot;
      clone.userData.breakerHandleMotion = handleMotion;
    }

    const buttonNames = [
      ...(geometry.interactiveNodes?.startButton ?? []),
      ...(geometry.interactiveNodes?.stopButton ?? []),
    ];
    const buttons = buttonNames.map((name) => clone.getObjectByName(name)).filter(Boolean) as THREE.Object3D[];
    clone.userData.officialButtonNodes = buttons;
    clone.userData.officialButtonBaseZ = buttons.map((button) => button.position.z);
    return clone;
  }, [geometry.interactiveNodes, geometry.materialProfile, gltf.scene]);

  useFrame((_, delta) => {
    const pivot = object.userData.breakerHandlePivot as THREE.Group | undefined;
    const motion = object.userData.breakerHandleMotion as RenderableGltf["interactiveNodes"] extends infer Nodes
      ? Nodes extends { breakerHandle?: infer Handle } ? Handle : never
      : never;
    if (pivot && motion) {
      const target = state === "closed" ? motion.closedAngleRad : motion.openAngleRad;
      // React Three Fiber animations update Three.js objects imperatively on each frame.
      // eslint-disable-next-line react-hooks/immutability
      pivot.rotation[motion.axis] = THREE.MathUtils.damp(pivot.rotation[motion.axis], target, 9, delta);
    }
    const buttons = object.userData.officialButtonNodes as THREE.Object3D[] | undefined;
    const bases = object.userData.officialButtonBaseZ as number[] | undefined;
    if (buttons && bases) {
      const pressed = state === "start-pressed" || state === "stop-pressed";
      buttons.forEach((button, index) => {
        button.position.z = THREE.MathUtils.damp(button.position.z, bases[index] + (pressed ? -1.8 : 0), 12, delta);
      });
    }
  });

  return (
    <group position={geometry.modelPosition} rotation={geometry.modelRotation}>
      <primitive object={object} scale={geometry.modelScale} />
    </group>
  );
}

function AssetGeometry({ asset, state }: { asset: ComponentAsset; state?: OperatingState }) {
  if (asset.geometry.kind === "gltf") return <GltfScene geometry={asset.geometry} state={state} />;
  if (asset.geometry.kind === "composite-gltf") {
    return <>{asset.geometry.parts.map((part, index) => <GltfScene geometry={part} key={`${part.path}-${index}`} />)}</>;
  }
  const geometry = asset.geometry;
  return (
    <>
      {Array.from({ length: geometry.count }, (_, index) => {
        const centeredIndex = index - (geometry.count - 1) / 2;
        const base = geometry.modelPosition ?? [0, 0, 0];
        const position: Vec3 = [
          base[0] + geometry.spacing[0] * centeredIndex,
          base[1] + geometry.spacing[1] * centeredIndex,
          base[2] + geometry.spacing[2] * centeredIndex,
        ];
        return <GltfScene geometry={{ ...geometry, modelPosition: position }} key={index} />;
      })}
    </>
  );
}

function PushbuttonHitArea({ instance }: { instance: DeviceInstance }) {
  const pressPushbutton = useWiringSceneStore((state) => state.pressPushbutton);
  const releasePushbutton = useWiringSceneStore((state) => state.releasePushbutton);
  return (
    <mesh
      position={[0, 2.78, 0]}
      onPointerDown={(event) => {
        event.stopPropagation();
        (event.target as EventTarget & { setPointerCapture: (pointerId: number) => void }).setPointerCapture(event.pointerId);
        pressPushbutton(instance.id);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        (event.target as EventTarget & { releasePointerCapture: (pointerId: number) => void }).releasePointerCapture(event.pointerId);
        releasePushbutton(instance.id);
      }}
      onPointerCancel={() => releasePushbutton(instance.id)}
    >
      <cylinderGeometry args={[0.67, 0.67, 0.32, 32]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

export function DeviceModel({ instance }: { instance: DeviceInstance }) {
  const asset = getAsset(instance.assetId);
  const beginMoveInstance = useWiringSceneStore((state) => state.beginMoveInstance);
  const moveInstance = useWiringSceneStore((state) => state.moveInstance);
  const finishMoveInstance = useWiringSceneStore((state) => state.finishMoveInstance);
  const toggleBreaker = useWiringSceneStore((state) => state.toggleBreaker);
  const contactorEngaged = useWiringSceneStore((state) => state.contactorEngaged);
  const overloadTripped = useWiringSceneStore((state) => state.overloadTripped);
  const moving = useWiringSceneStore((state) => state.movingInstanceId === instance.id);
  const [hovered, setHovered] = useState(false);
  const dragOffset = useRef<[number, number] | null>(null);
  const pointerOrigin = useRef<[number, number] | null>(null);
  const dragMoved = useRef(false);
  const operatingState = instance.operatingState ?? asset.interaction?.defaultState;
  useCursor(hovered || moving, moving ? "grabbing" : asset.interaction ? "pointer" : "grab");

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
        pointerOrigin.current = [point.x, point.z];
        dragMoved.current = false;
        (event.target as EventTarget & { setPointerCapture: (pointerId: number) => void }).setPointerCapture(event.pointerId);
        beginMoveInstance(instance.id);
      }}
      onPointerMove={(event) => {
        if (!dragOffset.current) return;
        event.stopPropagation();
        const point = pointOnBoard(event.ray);
        if (!point) return;
        if (pointerOrigin.current && Math.hypot(point.x - pointerOrigin.current[0], point.z - pointerOrigin.current[1]) > 0.08) dragMoved.current = true;
        moveInstance(instance.id, point.x + dragOffset.current[0], point.z + dragOffset.current[1]);
      }}
      onPointerUp={(event) => {
        if (!dragOffset.current) return;
        event.stopPropagation();
        const shouldToggle = !dragMoved.current && asset.interaction?.kind === "breaker-toggle";
        dragOffset.current = null;
        pointerOrigin.current = null;
        (event.target as EventTarget & { releasePointerCapture: (pointerId: number) => void }).releasePointerCapture(event.pointerId);
        finishMoveInstance(instance.id);
        if (shouldToggle) toggleBreaker(instance.id);
      }}
      onPointerCancel={() => {
        dragOffset.current = null;
        pointerOrigin.current = null;
        dragMoved.current = false;
        finishMoveInstance(instance.id);
      }}
    >
      <AssetGeometry asset={asset} state={operatingState} />
      {asset.interaction?.kind === "momentary-pushbutton" && <PushbuttonHitArea instance={instance} />}
      {asset.terminals.map((terminal) => <TerminalPort instance={instance} terminal={terminal} key={terminal.key} />)}
      <DeviceCaption instance={instance} asset={asset} expanded={hovered && !moving} />
      {instance.reference === "KM1" && (
        <Html position={[0, asset.footprint.height + 0.28, 0]} center style={{ pointerEvents: "none" }}>
          <div className={`scene-starter-state ${overloadTripped ? "is-tripped" : contactorEngaged ? "is-engaged" : ""}`}>
            <b>KM1 {contactorEngaged ? "吸合" : "释放"}</b><span>FR1 {overloadTripped ? "过载动作" : "95-96 闭合"}</span>
          </div>
        </Html>
      )}
      {asset.interaction?.kind === "breaker-toggle" && (
        <Html position={[1.75, asset.footprint.height + 0.28, 0]} center>
          <button
            type="button"
            className={`scene-breaker-state is-${operatingState}`}
            data-breaker-state={operatingState}
            aria-label={`${instance.reference} ${operatingState === "closed" ? "断开" : "闭合"}断路器`}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={() => toggleBreaker(instance.id)}
          >
            {operatingState === "closed" ? "ON" : "OFF"}
          </button>
        </Html>
      )}
    </group>
  );
}

[
  "models/chint/nxb-63/CHINT_NXB-63_3P.glb",
  "models/chint/nc1-09-12/CHINT_NC1-09-12.glb",
  "models/chint/nre8-25/CHINT_NRE8-25.glb",
  "models/chint/np2-ba/CHINT_NP2-BA.glb",
  "models/chint/jcuk-5n/CHINT_JCUK-5N.glb",
  "models/chint/jcuk-5jd/CHINT_JCUK-5JD.glb",
].forEach((path) => useLoader.preload(GLTFLoader, assetUrl(path), configureGltfLoader));
