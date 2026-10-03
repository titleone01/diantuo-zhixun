"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import { MapControls as MapControlsImpl } from "three/examples/jsm/controls/MapControls.js";
import { BoardHardware } from "./BoardHardware";
import { DeviceLibrary } from "./DeviceLibrary";
import { DolControlPanel } from "./DolControlPanel";
import { DeviceModel } from "./DeviceModels";
import { resolveTerminal } from "./catalog";
import { BOARD_DEPTH, BOARD_WIDTH } from "./layout";
import { buildWireRoute } from "./routing";
import { createScenePersistence, type ScenePersistence } from "./persistence";
import { useWiringSceneStore } from "./store";
import type { PersistedWiringScene } from "./store";
import { Wire3D } from "./Wire3D";
import type { WireKind } from "./types";
import { getWireColor } from "./wire-style";

const configureMapControls = (
  controls: MapControlsImpl,
  enabled: boolean,
  cameraX: number,
) => {
  controls.enabled = enabled;
  controls.enablePan = true;
  controls.enableRotate = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.panSpeed = 1.15;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.minZoom = 10;
  controls.maxZoom = 90;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.target.set(cameraX, 0, 0);
};

function CameraRig({ onMovingChange }: { onMovingChange: (moving: boolean) => void }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const movingInstanceId = useWiringSceneStore((state) => state.movingInstanceId);
  const zoom = Math.max(14, Math.min(
    34,
    (size.width - Math.min(280, size.width * 0.2)) / (BOARD_WIDTH + 0.9),
    (size.height - 132) / (BOARD_DEPTH + 0.8),
  ));
  const cameraX = -Math.min(116, size.width * 0.075) / zoom;
  const handleStart = useCallback(() => onMovingChange(true), [onMovingChange]);
  const handleEnd = useCallback(() => onMovingChange(false), [onMovingChange]);
  const controls = useMemo(() => new MapControlsImpl(camera, gl.domElement), [camera, gl.domElement]);
  useEffect(() => {
    camera.position.set(cameraX, 22, 0.001);
    camera.up.set(0, 0, -1);
    camera.lookAt(cameraX, 0, 0);
    // React Three Fiber exposes the Three.js camera for imperative projection updates.
    // eslint-disable-next-line react-hooks/immutability
    if (camera instanceof THREE.OrthographicCamera) camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }, [camera, cameraX, zoom]);
  useEffect(() => {
    configureMapControls(controls, !movingInstanceId, cameraX);
    controls.addEventListener("start", handleStart);
    controls.addEventListener("end", handleEnd);
    return () => {
      controls.removeEventListener("start", handleStart);
      controls.removeEventListener("end", handleEnd);
    };
  }, [cameraX, controls, handleEnd, handleStart, movingInstanceId]);
  useEffect(() => () => controls.dispose(), [controls]);
  useFrame(() => controls.update(), -1);
  return null;
}

function WiringWorld({ onCameraMovingChange }: { onCameraMovingChange: (moving: boolean) => void }) {
  const instances = useWiringSceneStore((state) => state.instances);
  const wires = useWiringSceneStore((state) => state.wires);
  const selectWire = useWiringSceneStore((state) => state.selectWire);
  const cancelConnection = useWiringSceneStore((state) => state.cancelConnection);
  return (
    <>
      <CameraRig onMovingChange={onCameraMovingChange} />
      <color attach="background" args={["#c7d0d5"]} />
      <ambientLight intensity={0.72} />
      <hemisphereLight args={["#f7fafb", "#40515b", 1.25]} />
      <directionalLight
        intensity={1.95}
        position={[-4, 10, -5]}
      />
      <directionalLight color="#dcecff" intensity={0.58} position={[7, 8, 5]} />
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
  main: "主回路",
  control: "控制回路",
  earth: "保护接地线",
};

function SceneToolbar() {
  const wireKind = useWiringSceneStore((state) => state.wireKind);
  const wireStyle = useWiringSceneStore((state) => state.wireStyle);
  const setWireStyle = useWiringSceneStore((state) => state.setWireStyle);
  const updateSelectedWire = useWiringSceneStore((state) => state.updateSelectedWire);
  const selectWire = useWiringSceneStore((state) => state.selectWire);
  const instances = useWiringSceneStore((state) => state.instances);
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
  const selectedWire = wires.find((wire) => wire.id === selectedWireId);
  const selectedColor = selectedWire ? getWireColor(selectedWire, resolveTerminal(instances, selectedWire.from).terminal) : "#e5bb24";
  return (
    <div className="scene-toolbar" aria-label="接线工具">
      <div className="scene-title"><b>三维模拟接线板</b><span>左键拖动空白 / 中键拖动画布 · 滚轮缩放</span></div>
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
      <label className="wire-style-control">新线线形
        <select aria-label="新导线线形" value={wireStyle} onChange={(event) => setWireStyle(event.target.value === "straight" ? "straight" : "curve")}>
          <option value="straight">直线</option><option value="curve">曲线</option>
        </select>
      </label>
      <button type="button" disabled={!pastCount} onClick={undo} title="撤回（Ctrl+Z）">撤回</button>
      <button type="button" disabled={!futureCount} onClick={redo} title="重做（Ctrl+Y）">重做</button>
      <button type="button" disabled={!selectedWireId} onClick={deleteSelectedWire}>拆除所选</button>
      <button type="button" disabled={!wires.length} onClick={clearWires}>清空导线</button>
      <button type="button" onClick={resetBoard}>恢复模板板</button>
      <div className="wire-properties" aria-label="导线属性">
        <label>已接导线
          <select aria-label="选择已接导线" value={selectedWireId ?? ""} onChange={(event) => selectWire(event.target.value || null)}>
            <option value="">选择导线后修改</option>
            {wires.map((wire, index) => <option value={wire.id} key={wire.id}>{index + 1}. {resolveTerminal(instances, wire.from).electricalId} → {resolveTerminal(instances, wire.to).electricalId}</option>)}
          </select>
        </label>
        <label>线色<input type="color" aria-label="所选导线颜色" disabled={!selectedWire} value={selectedColor} onChange={(event) => updateSelectedWire({ color: event.target.value })} /></label>
        <label>线形<select aria-label="所选导线线形" disabled={!selectedWire} value={selectedWire?.style ?? "curve"} onChange={(event) => updateSelectedWire({ style: event.target.value === "straight" ? "straight" : "curve" })}><option value="straight">直线</option><option value="curve">曲线</option></select></label>
        <span>默认取起点端子颜色 · 两种线形均沿线槽走线</span>
      </div>
    </div>
  );
}

function SceneStatus({ persistence }: { persistence: ScenePersistence }) {
  const storageStatus = useSyncExternalStore(persistence.subscribe, persistence.getSnapshot, persistence.getServerSnapshot);
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
      color: getWireColor(wire, from.terminal),
      style: wire.style ?? "curve",
      routingMode: "nearest-duct-network",
      route: buildWireRoute(instances, wire, index),
    };
  }), [instances, wires]);
  return (
    <footer className="scene-statusbar">
      <b>操作提示</b><span>{message}</span><em role={storageStatus.state === "blocked" ? "alert" : undefined}>{storageStatus.message} · 器件 {instances.length} · 导线 {wires.length}</em>
      <output className="scene-debug-output" data-wire-endpoints={JSON.stringify(debug)} aria-hidden="true" />
    </footer>
  );
}


export function WiringScene({ storageKey = "diantuo-wiring-scene-v2", simulationEnabled = true, selectedProjectName, projectPanel }: {
  storageKey?: string;
  simulationEnabled?: boolean;
  selectedProjectName?: string;
  projectPanel?: ReactNode;
}) {
  const cameraRef = useRef<THREE.Camera | null>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const libraryDragStartRef = useRef<{ assetId: string; x: number; y: number } | null>(null);
  const [draggedAssetId, setDraggedAssetId] = useState<string | null>(null);
  const [cameraMoving, setCameraMoving] = useState(false);
  const addInstance = useWiringSceneStore((state) => state.addInstance);
  const hydrateScene = useWiringSceneStore((state) => state.hydrateScene);
  const instances = useWiringSceneStore((state) => state.instances);
  const wires = useWiringSceneStore((state) => state.wires);
  const wireKind = useWiringSceneStore((state) => state.wireKind);
  const wireStyle = useWiringSceneStore((state) => state.wireStyle);
  const past = useWiringSceneStore((state) => state.past);
  const future = useWiringSceneStore((state) => state.future);
  const powerState = useWiringSceneStore((state) => state.powerState);
  const overloadTripped = useWiringSceneStore((state) => state.overloadTripped);
  const undo = useWiringSceneStore((state) => state.undo);
  const redo = useWiringSceneStore((state) => state.redo);
  const syncRuntime = useWiringSceneStore((state) => state.syncRuntime);
  const persistence = useMemo(() => createScenePersistence(storageKey), [storageKey]);

  useEffect(() => {
    persistence.load(hydrateScene);
  }, [hydrateScene, persistence]);

  useEffect(() => {
    if (persistence.getSnapshot().state !== "ready") return;
    const timer = window.setTimeout(() => {
      // Hydration can replace the store after this render. Read the latest
      // snapshot so the initial timer cannot overwrite it with the template.
      const { instances, wires, wireKind, wireStyle, past, future } = useWiringSceneStore.getState();
      const scene: PersistedWiringScene = { version: 2, instances, wires, wireKind, wireStyle, past, future };
      persistence.save(scene);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [future, instances, past, wireKind, wireStyle, wires, persistence]);

  useEffect(() => {
    syncRuntime();
  }, [instances, overloadTripped, powerState, syncRuntime, wires]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
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
      data-camera-moving={cameraMoving || undefined}
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
        camera={{ position: [0, 22, 0.001], zoom: 18, near: 0.1, far: 60 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ camera, gl }) => {
          cameraRef.current = camera;
          gl.domElement.setAttribute("aria-label", "统一三维场景中的金属网孔板、DIN 导轨、器件和真实接线");
        }}
        onPointerMissed={() => useWiringSceneStore.getState().cancelConnection()}
      >
        <WiringWorld onCameraMovingChange={setCameraMoving} />
      </Canvas>
      <DeviceLibrary onPickUp={(assetId, x, y) => {
        libraryDragStartRef.current = { assetId, x, y };
        setDraggedAssetId(assetId);
      }} onAdd={(assetId) => addInstance(assetId)} />
      <SceneToolbar />
      <aside className="training-sidebar" aria-label="项目选择与仿真控制">
        {projectPanel}
        {simulationEnabled ? <DolControlPanel /> : <section className="project-pending"><b>{selectedProjectName}</b><p>可在上方上传或查看本项目图纸。该项目的仿真回路尚未开放。</p><p>选择“电动机连续运行控制电路”可继续本轮直接启动训练。</p></section>}
      </aside>
      {!simulationEnabled && <div className="project-review-overlay"><b>{selectedProjectName}</b><span>图纸查看模式 · 当前接线已保留</span></div>}
      <SceneStatus persistence={persistence} />
    </section>
  );
}
