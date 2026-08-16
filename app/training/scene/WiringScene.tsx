"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BoardHardware } from "./BoardHardware";
import { DeviceLibrary } from "./DeviceLibrary";
import { DeviceModel } from "./DeviceModels";
import { resolveTerminal } from "./catalog";
import { BOARD_DEPTH, BOARD_WIDTH } from "./layout";
import { buildWireRoute } from "./routing";
import { useWiringSceneStore } from "./store";
import type { PersistedWiringScene } from "./store";
import { Wire3D } from "./Wire3D";
import type { WireKind } from "./types";

function CameraRig() {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const movingInstanceId = useWiringSceneStore((state) => state.movingInstanceId);
  const zoom = Math.max(52, Math.min(
    82,
    (size.width - Math.min(280, size.width * 0.2)) / (BOARD_WIDTH + 0.9),
    (size.height - 132) / (BOARD_DEPTH + 0.8),
  ));
  const cameraX = -Math.min(116, size.width * 0.075) / zoom;
  useEffect(() => {
    camera.position.set(cameraX, 14, 0.001);
    camera.up.set(0, 0, -1);
    camera.lookAt(cameraX, 0, 0);
    // React Three Fiber exposes the Three.js camera for imperative projection updates.
    // eslint-disable-next-line react-hooks/immutability
    if (camera instanceof THREE.OrthographicCamera) camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }, [camera, cameraX, zoom]);
  return (
    <MapControls
      makeDefault
      enabled={!movingInstanceId}
      enableRotate={false}
      enableDamping
      dampingFactor={0.12}
      minZoom={42}
      maxZoom={125}
      target={[cameraX, 0, 0]}
    />
  );
}

function WiringWorld() {
  const instances = useWiringSceneStore((state) => state.instances);
  const wires = useWiringSceneStore((state) => state.wires);
  const selectWire = useWiringSceneStore((state) => state.selectWire);
  const cancelConnection = useWiringSceneStore((state) => state.cancelConnection);
  return (
    <>
      <CameraRig />
      <color attach="background" args={["#c7d0d5"]} />
      <ambientLight intensity={1.8} />
      <hemisphereLight args={["#f4f7f9", "#35434d", 2.2]} />
      <directionalLight
        intensity={2.7}
        position={[-4, 10, -5]}
      />
      <group
        onPointerDown={() => selectWire(null)}
        onPointerUp={() => cancelConnection()}
      >
        <BoardHardware />
      </group>
      <Suspense fallback={null}>
        {instances.map((instance) => <DeviceModel instance={instance} key={instance.id} />)}
      </Suspense>
      {wires.map((wire, index) => (
        <Wire3D wire={wire} instances={instances} index={index} key={wire.id} />
      ))}
    </>
  );
}

const wireLabels: Record<WireKind, string> = {
  main: "主回路黄线",
  control: "控制回路红线",
  earth: "保护接地线",
};

function SceneToolbar() {
  const wireKind = useWiringSceneStore((state) => state.wireKind);
  const selectedWireId = useWiringSceneStore((state) => state.selectedWireId);
  const wires = useWiringSceneStore((state) => state.wires);
  const setWireKind = useWiringSceneStore((state) => state.setWireKind);
  const deleteSelectedWire = useWiringSceneStore((state) => state.deleteSelectedWire);
  const clearWires = useWiringSceneStore((state) => state.clearWires);
  const resetBoard = useWiringSceneStore((state) => state.resetBoard);
  const pastCount = useWiringSceneStore((state) => state.past.length);
  const futureCount = useWiringSceneStore((state) => state.future.length);
  const undo = useWiringSceneStore((state) => state.undo);
  const redo = useWiringSceneStore((state) => state.redo);
  return (
    <div className="scene-toolbar" aria-label="接线工具">
      <div className="scene-title"><b>三维模拟接线板</b><span>端子就近入槽 · 线槽内走线 · 滚轮缩放</span></div>
      <div className="scene-wire-types">
        {(Object.keys(wireLabels) as WireKind[]).map((kind) => (
          <button
            type="button"
            className={wireKind === kind ? `wire-${kind} active` : `wire-${kind}`}
            aria-pressed={wireKind === kind}
            onClick={() => setWireKind(kind)}
            key={kind}
          >{wireLabels[kind]}</button>
        ))}
      </div>
      <button type="button" disabled={!pastCount} onClick={undo} title="撤回（Ctrl+Z）">撤回</button>
      <button type="button" disabled={!futureCount} onClick={redo} title="重做（Ctrl+Y）">重做</button>
      <button type="button" disabled={!selectedWireId} onClick={deleteSelectedWire}>拆除所选</button>
      <button type="button" disabled={!wires.length} onClick={clearWires}>清空导线</button>
      <button type="button" onClick={resetBoard}>恢复模板板</button>
    </div>
  );
}

function SceneStatus() {
  const message = useWiringSceneStore((state) => state.message);
  const instances = useWiringSceneStore((state) => state.instances);
  const wires = useWiringSceneStore((state) => state.wires);
  const debug = useMemo(() => wires.map((wire, index) => {
    const from = resolveTerminal(instances, wire.from);
    const to = resolveTerminal(instances, wire.to);
    return {
      id: wire.id,
      from: from.electricalId,
      to: to.electricalId,
      fromWorld: from.world,
      toWorld: to.world,
      routingMode: "nearest-duct-network",
      route: buildWireRoute(instances, wire, index),
    };
  }), [instances, wires]);
  return (
    <footer className="scene-statusbar">
      <b>操作提示</b><span>{message}</span><em>本机自动保存 · 器件 {instances.length} · 导线 {wires.length}</em>
      <output className="scene-debug-output" data-wire-endpoints={JSON.stringify(debug)} aria-hidden="true" />
    </footer>
  );
}

export function WiringScene() {
  const cameraRef = useRef<THREE.Camera | null>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const libraryDragStartRef = useRef<{ assetId: string; x: number; y: number } | null>(null);
  const [draggedAssetId, setDraggedAssetId] = useState<string | null>(null);
  const addInstance = useWiringSceneStore((state) => state.addInstance);
  const hydrateScene = useWiringSceneStore((state) => state.hydrateScene);
  const instances = useWiringSceneStore((state) => state.instances);
  const wires = useWiringSceneStore((state) => state.wires);
  const wireKind = useWiringSceneStore((state) => state.wireKind);
  const past = useWiringSceneStore((state) => state.past);
  const future = useWiringSceneStore((state) => state.future);
  const undo = useWiringSceneStore((state) => state.undo);
  const redo = useWiringSceneStore((state) => state.redo);
  const storageReadyRef = useRef(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("diantuo-wiring-scene-v2");
      if (stored) {
        const scene = JSON.parse(stored) as PersistedWiringScene;
        if (
          scene.version === 2
          && Array.isArray(scene.instances)
          && Array.isArray(scene.wires)
          && Array.isArray(scene.past)
          && Array.isArray(scene.future)
          && ["main", "control", "earth"].includes(scene.wireKind)
        ) hydrateScene(scene);
      }
    } catch {
      localStorage.removeItem("diantuo-wiring-scene-v2");
    } finally {
      storageReadyRef.current = true;
    }
  }, [hydrateScene]);

  useEffect(() => {
    if (!storageReadyRef.current) return;
    const timer = window.setTimeout(() => {
      const scene: PersistedWiringScene = { version: 2, instances, wires, wireKind, past, future };
      localStorage.setItem("diantuo-wiring-scene-v2", JSON.stringify(scene));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [future, instances, past, wireKind, wires]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  const placeAsset = (assetId: string, clientX: number, clientY: number) => {
    const camera = cameraRef.current;
    const host = canvasHostRef.current;
    if (!camera || !host) return;
    const rect = host.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, camera);
    const world = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2), world);
    if (hit) addInstance(assetId, world.x, world.z);
  };

  return (
    <section
      className="unified-wiring-scene"
      ref={canvasHostRef}
      data-board-template="four-rail-cabinet"
      data-dragging-asset={draggedAssetId ?? undefined}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-electrical-asset")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const assetId = event.dataTransfer.getData("application/x-electrical-asset");
        if (!assetId) return;
        event.preventDefault();
        placeAsset(assetId, event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        const start = libraryDragStartRef.current;
        if (!start) return;
        libraryDragStartRef.current = null;
        setDraggedAssetId(null);
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 30) return;
        placeAsset(start.assetId, event.clientX, event.clientY);
      }}
      onPointerCancel={() => {
        libraryDragStartRef.current = null;
        setDraggedAssetId(null);
      }}
    >
      <Canvas
        orthographic
        camera={{ position: [0, 14, 0.001], zoom: 58, near: 0.1, far: 40 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ camera, gl }) => {
          cameraRef.current = camera;
          gl.domElement.setAttribute("aria-label", "统一三维场景中的金属网孔板、DIN 导轨、器件和真实接线");
        }}
        onPointerMissed={() => useWiringSceneStore.getState().cancelConnection()}
      >
        <WiringWorld />
      </Canvas>
      <DeviceLibrary onPickUp={(assetId, x, y) => {
        libraryDragStartRef.current = { assetId, x, y };
        setDraggedAssetId(assetId);
      }} onAdd={(assetId) => addInstance(assetId)} />
      <SceneToolbar />
      <SceneStatus />
    </section>
  );
}
