"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { Background, BackgroundVariant, ConnectionMode, ConnectionLineType, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type EdgeChange, type NodeChange } from "@xyflow/react";
import { CheckCheck, ChevronLeft, ChevronRight, Copy, Download, FileImage, FolderOpen, PanelRightClose, Play, Redo2, Search, ShieldCheck, Square, Undo2, X } from "lucide-react";
import { CATALOG, componentSize, DUCT_MAX_SIZE, DUCT_MIN_SIZE, getDefinition, isWireDuct } from "../core/catalog";
import { initialRuntime, simulate } from "../core/engine";
import { validateDocument } from "../core/validation";
import type { CircuitComponent, CircuitDocument, ComponentSize, ComponentType, Diagnostic, LessonAssessment, Point, SimulationAction, SimulationResult } from "../core/types";
import DeviceArtwork from "./DeviceArtwork";
import DeviceNode, { type ElectricalNode } from "./DeviceNode";
import WireEdge, { type ElectricalEdge } from "./WireEdge";
import { terminalColor } from "./geometry";
import { runtimeSummary } from "./labels";
import { createSimulationSession } from "./simulation-session";
import DrawingViewer, { type DrawingZoom } from "../DrawingViewer";
import FloatingSchematic from "./FloatingSchematic";
import { referenceVideoForDocument } from "../reference-video/catalog";
import { getReferenceDrawing, referenceDrawingImageUrl } from "../core/reference-drawings";
import { selectReferenceDrawing } from "../core/reference-workspace";
import ReferenceDrawingPicker from "../ReferenceDrawingPicker";
import { poolGroups, poolLabel } from "./library-presentation";
import ShortCircuitAlert from "./ShortCircuitAlert";
import { shortCircuitDiagnostic, shortCircuitNoticeKey } from "./short-circuit-notice";
import { copySelection, pasteSelection, type SelectionClipboard } from "./selection-clipboard";
import "../reference-layout.css";
import "@xyflow/react/dist/style.css";
import "./editor.css";

export type SimulatorEditorProps = {
  document: CircuitDocument;
  documentKey?: string;
  clipboardScope?: string;
  onDocumentChange: (document: CircuitDocument) => void;
  onSave?: () => Promise<void> | void;
  onPublish?: () => Promise<void> | void;
  onAssess?: (document: CircuitDocument) => Promise<LessonAssessment>;
  onImportDrawing?: (file: File) => Promise<{ id: string; url: string }>;
  drawingUrl?: string;
  drawingType?: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  renderSchematic?: ReactNode | ((drawingPreview: ReactNode, selectionRevision: number, viewerControls: DrawingZoom) => ReactNode);
  referenceVideoAllowed?: boolean;
  readOnly?: boolean;
  onRunningChange?: (running: boolean) => void;
};

const nodeTypes = { electrical: DeviceNode };
const edgeTypes = { electrical: WireEdge };
const COLORS = ["#e7b000", "#20b963", "#f04452", "#3478f6", "#56616f", "#659f2f"];
const LABELS: Record<ComponentType, string> = { supply: "电源", breaker3: "QF", breaker1: "QF", fuse: "FU", fuse3: "FU", fuse2: "FU", "terminal-strip16": "XT", "knife-switch3": "QS", contactor220: "KM", contactor380: "KM", overload: "FR", "push-no": "SB", "push-nc": "SB", "push-latching-red": "SB", "push-latching-green": "SB", switch1: "S", switch2: "S", lamp: "EL", motor: "M", terminal: "XT", "pe-terminal": "PE", "auxiliary-no": "NO", relay380: "KA", timer380: "KT", "limit-switch": "SQ", "motor-star-delta": "M", "motor-dahlander": "M", "wire-duct": "WD", "wire-duct-vertical": "WD" };
const clone = (value: CircuitDocument) => JSON.parse(JSON.stringify(value)) as CircuitDocument;

/** Imported circuits are checked again by the server on save and assessment. */
function parseImport(value: unknown): CircuitDocument {
  const result = validateDocument(value);
  if (!result.valid || !result.document) throw new Error(result.errors.join("；"));
  return clone(result.document);
}

function Workspace(props: SimulatorEditorProps) {
  const { document: circuit, onDocumentChange, onSave, onPublish, onAssess, onImportDrawing, renderSchematic, readOnly = false } = props;
  const flow = useReactFlow<ElectricalNode, ElectricalEdge>();
  const docRef = useRef(circuit);
  docRef.current = circuit;
  const [category, setCategory] = useState<"all" | "industrial" | "lighting">("all");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [colorAnchor, setColorAnchor] = useState({left:0,top:0});
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedWires, setSelectedWires] = useState<string[]>([]);
  const clipboard=useRef<SelectionClipboard | null>(null);
  const clipboardPastes=useRef(0);
  const [canPaste,setCanPaste]=useState(false);
  useLayoutEffect(()=>{clipboard.current=null;clipboardPastes.current=0;setCanPaste(false);},[props.clipboardScope]);
  const [past, setPast] = useState<CircuitDocument[]>([]);
  const [future, setFuture] = useState<CircuitDocument[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [colorOverride, setColorOverride] = useState(false);
  const [wireStyle, setWireStyle] = useState<"orthogonal" | "straight" | "curve">("orthogonal");
  const [colorsOpen, setColorsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const sessionRef = useRef<ReturnType<typeof createSimulationSession> | null>(null);
  if (!sessionRef.current) sessionRef.current = createSimulationSession();
  const session = sessionRef.current;
  const sessionGeneration = session.generation;
  const [assessment, setAssessment] = useState<LessonAssessment | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"runtime" | "safety" | "lesson">("runtime");
  const [drawing, setDrawing] = useState(props.drawingUrl ?? "");
  const [drawingZoom, setDrawingZoom] = useState(1);
  const [drawingPickerOpen, setDrawingPickerOpen] = useState(false);
  const [referenceSelectionRevision, setReferenceSelectionRevision] = useState(0);
  const drawingSelectionEpoch = useRef(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [transferMode, setTransferMode] = useState<"export" | "import" | null>(null);
  const [transferText, setTransferText] = useState("");
  const [transferNotice, setTransferNotice] = useState("");
  const transferInput = useRef<HTMLTextAreaElement | null>(null);
  const [focusedDiagnostic, setFocusedDiagnostic] = useState<Diagnostic | null>(null);
  const dragBefore = useRef<CircuitDocument | null>(null);
  const resizing = useRef<{ id: string; before: CircuitDocument; documentKey?: string } | null>(null);
  const [shortAlert, setShortAlert] = useState<Diagnostic | null>(null);
  const shownShort = useRef("");
  const assessmentRequest = useRef(0);
  const board = useRef<HTMLDivElement | null>(null);
  const diagramPanel = useRef<HTMLDivElement | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);
  const importRequest = useRef(0);
  const drawingInput = useRef<HTMLInputElement | null>(null);
  const frozen = running || readOnly;
  const frozenRef = useRef(frozen);
  useLayoutEffect(() => { frozenRef.current = frozen; }, [frozen]);
  const initial = useMemo(() => initialRuntime(circuit, false), [circuit]);
  const frameInitialView = useCallback(() => {
    const components = docRef.current.components;
    if (!components.length) { void flow.setViewport({ x: 50, y: 85, zoom: 0.78 }); return; }
    const minX = Math.min(...components.map(component => component.position.x));
    const minY = Math.min(...components.map(component => component.position.y));
    const maxX = Math.max(...components.map(component => component.position.x + componentSize(component).width));
    // These DOM sizes only frame the viewport; electrical endpoints remain in document coordinates.
    const boardWidth = board.current?.clientWidth ?? 1000;
    const diagramWidth = diagramPanel.current?.offsetWidth ?? 332;
    const usableWidth = Math.max(240, boardWidth - diagramWidth - 70);
    const maxY = Math.max(...components.map(component => component.position.y + componentSize(component).height + 45));
    const usableHeight = Math.max(240,(board.current?.clientHeight ?? 650)-160);
    const zoom = Math.max(0.22, Math.min(0.9, (usableWidth - 30) / Math.max(1, maxX - minX),usableHeight / Math.max(1,maxY-minY)));
    void flow.setViewport({ x: 35 + (usableWidth - (maxX - minX) * zoom) / 2 - minX * zoom, y: 85 - minY * zoom, zoom }, { duration: 180 });
  }, [flow]);

  useEffect(() => { props.onRunningChange?.(running); }, [running, props.onRunningChange]);
  useEffect(() => () => { props.onRunningChange?.(false); }, [props.onRunningChange]);

  useEffect(() => {
    assessmentRequest.current++;
    session.clear();
    resizing.current = null;
    shownShort.current = ""; setShortAlert(null);
    setPast([]); setFuture([]); setRunning(false); setSimulation(null); setAssessment(null); setSelectedNodes([]); setSelectedWires([]); setFocusedDiagnostic(null); setTransferMode(null);
    const timer = setTimeout(frameInitialView, 80);
    return () => clearTimeout(timer);
  }, [props.documentKey, frameInitialView, session]);
  useEffect(() => () => session.clear(), [session]);
  useEffect(() => {
    const diagnostic = running ? shortCircuitDiagnostic(simulation) : null;
    if (!diagnostic) { shownShort.current = ""; setShortAlert(null); return; }
    const key = shortCircuitNoticeKey(sessionGeneration, diagnostic);
    if (shownShort.current !== key) { shownShort.current = key; setShortAlert(diagnostic); }
  }, [running, simulation, sessionGeneration]);
  useEffect(() => { setDrawing(props.drawingUrl ?? ""); }, [props.drawingUrl, props.documentKey]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(""), 4500); return () => clearTimeout(timer); }, [message]);

  const changed = useCallback((next: CircuitDocument) => {
    if (frozen) return;
    const previous = docRef.current;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    setPast(items => [...items.slice(-79), clone(previous)]);
    setFuture([]); setAssessment(null); setSimulation(null); setFocusedDiagnostic(null);
    onDocumentChange(next);
  }, [frozen, onDocumentChange]);

  const undo = useCallback(() => {
    if (frozen || !past.length) return;
    const previous = past[past.length - 1], current = clone(docRef.current);
    setFuture(items => [current, ...items]);
    setPast(items => items.slice(0, -1)); setAssessment(null); setSimulation(null); setFocusedDiagnostic(null); onDocumentChange(previous);
  }, [frozen, onDocumentChange, past]);
  const redo = useCallback(() => {
    if (frozen || !future.length) return;
    const current = clone(docRef.current);
    setPast(items => [...items, current]);
    const next = future[0]; setFuture(items => items.slice(1)); setAssessment(null); setSimulation(null); setFocusedDiagnostic(null); onDocumentChange(next);
  }, [frozen, future, onDocumentChange]);
  const deleteSelected = useCallback(() => {
    if (frozen) return;
    changed({ ...docRef.current, components: docRef.current.components.filter(component => !selectedNodes.includes(component.id)).map(component => component.linkedTo && selectedNodes.includes(component.linkedTo) ? { ...component, linkedTo: undefined } : component), wires: docRef.current.wires.filter(wire => !selectedWires.includes(wire.id) && !selectedNodes.includes(wire.from.componentId) && !selectedNodes.includes(wire.to.componentId)), roles: docRef.current.roles ? Object.fromEntries(Object.entries(docRef.current.roles).filter(([, componentId]) => !selectedNodes.includes(componentId))) : undefined });
    setSelectedNodes([]); setSelectedWires([]);
  }, [frozen, changed, selectedNodes, selectedWires]);

  const action = useCallback((nextAction: SimulationAction) => {
    if (!running) return;
    const result = session.dispatch(nextAction, sessionGeneration);
    if (!result) return;
    const present = () => {
      setSimulation(result);
      if (result.runtime.faultLatched || !result.supported) { setPanelOpen(true); setPanelTab("safety"); }
    };
    // Commit a user's discrete action before the next pointer event or DOM state read.
    // The engine state is already settled; this only synchronizes its presentation.
    if (nextAction.type === "advance-time") present(); else flushSync(present);
  }, [running, session, sessionGeneration]);

  const copySelected=()=>{
    if(frozen)return;
    const selection=copySelection(docRef.current,selectedNodes);
    if(!selection.components.length){setMessage("请选择要复制的器件或线槽，可按 Shift 多选。");return;}
    clipboard.current=selection;clipboardPastes.current=0;setCanPaste(true);
    setMessage(`已复制 ${selection.components.length} 个对象和 ${selection.wires.length} 根组内导线。`);
  };
  const pasteSelected=()=>{
    if(frozen || !clipboard.current)return;
    try{
      const pasted=pasteSelection(docRef.current,clipboard.current,32*(clipboardPastes.current+1));
      changed(pasted.document);clipboardPastes.current++;
      setSelectedNodes(pasted.componentIds);setSelectedWires(pasted.wireIds);
      setMessage(pasted.clearedLinks ? `已粘贴；${pasted.clearedLinks} 个组外辅助关联已清除，请重新选择线圈。` : "已粘贴，可整体移动；一次撤销恢复。");
    }catch(error){setMessage(error instanceof Error?error.message:"粘贴失败，当前电路保持不变。");}
  };

  const hasTimers = circuit.components.some(component => component.type === "timer380");
  useEffect(() => {
    if (!running || !hasTimers || timerPaused) return;
    // Each discrete tick is explicit engine input, also reproducible in server-side lesson assessment.
    const timer = setInterval(() => {
      if (session.current?.runtime.powerOn && session.current.supported && !session.current.runtime.faultLatched) action({ type: "advance-time", ms: 100 });
    }, 100);
    return () => clearInterval(timer);
  }, [running, hasTimers, timerPaused, action, session]);

  const startStop = () => {
    if (running) { session.clear(); setRunning(false); setSimulation(null); setFocusedDiagnostic(null); setMessage("仿真已结束，开关和按钮恢复编辑前状态。"); return; }
    try {
      const result = session.start(circuit);
      setSimulation(result); setRunning(true); setTimerPaused(false); setFocusedDiagnostic(null);
      if (result.runtime.faultLatched || !result.supported) { setPanelOpen(true); setPanelTab("safety"); }
      else setMessage("仿真已开始：点击断路器合闸，再按住启动按钮。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "电路暂时无法仿真。"); }
  };

  const addComponent = (type: ComponentType, point?: Point) => {
    if (frozen) return;
    const bounds = board.current?.getBoundingClientRect();
    const position = point ?? flow.screenToFlowPosition({ x: (bounds?.left ?? 300) + (bounds?.width ?? 900) * 0.4, y: (bounds?.top ?? 120) + (bounds?.height ?? 600) * 0.4 });
    const prefix = LABELS[type];
    let index = 1;
    while (circuit.components.some(component => component.label === `${prefix}${index}`)) index++;
    const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
    changed({ ...circuit, components: [...circuit.components, { id, type, label: `${prefix}${index}`, position: { x: Math.round(position.x / 8) * 8, y: Math.round(position.y / 8) * 8 } }] });
    setSelectedNodes([id]); setSelectedWires([]);
  };
  const connect = (connection: Connection) => {
    if (frozen || !connection.sourceHandle || !connection.targetHandle || !connection.source || !connection.target) return;
    const from = { componentId: connection.source, terminalId: connection.sourceHandle };
    const to = { componentId: connection.target, terminalId: connection.targetHandle };
    if (from.componentId === to.componentId && from.terminalId === to.terminalId) return;
    const same = (a: typeof from, b: typeof from) => a.componentId === b.componentId && a.terminalId === b.terminalId;
    if (circuit.wires.some(wire => (same(wire.from, from) && same(wire.to, to)) || (same(wire.from, to) && same(wire.to, from)))) { setMessage("这两个端子已经相连。"); return; }
    const sourceComponent = circuit.components.find(component => component.id === from.componentId);
    const sourceTerminal = sourceComponent && getDefinition(sourceComponent.type).terminals.find(terminal => terminal.id === from.terminalId);
    const newColor = colorOverride || !sourceTerminal ? color : terminalColor(sourceTerminal);
    changed({ ...circuit, wires: [...circuit.wires, { id: `wire-${crypto.randomUUID().slice(0, 10)}`, from, to, color: newColor, style: wireStyle }] });
  };
  const onWaypoints = useCallback((id: string, points: Point[]) => changed({ ...docRef.current, wires: docRef.current.wires.map(wire => wire.id === id ? { ...wire, waypoints: points } : wire) }), [changed]);
  const configure = useCallback((id: string, patch: Pick<CircuitComponent, "linkedTo" | "settings">) => changed({ ...docRef.current, components: docRef.current.components.map(component => component.id === id ? { ...component, ...patch } : component) }), [changed]);
  const beginResize = useCallback((id: string) => {
    if (frozen || !isWireDuct(docRef.current.components.find(component => component.id === id)?.type ?? "")) return;
    resizing.current = { id, before: clone(docRef.current), documentKey: props.documentKey };
  }, [frozen, props.documentKey]);
  const resize = useCallback((id: string, bounds: Point & ComponentSize, finish = false) => {
    const gesture = resizing.current;
    if (frozen || !gesture || gesture.id !== id || gesture.documentKey !== props.documentKey || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return;
    const size = { width: Math.max(DUCT_MIN_SIZE, Math.min(DUCT_MAX_SIZE, bounds.width)), height: Math.max(DUCT_MIN_SIZE, Math.min(DUCT_MAX_SIZE, bounds.height)) };
    const next = { ...docRef.current, components: docRef.current.components.map(component => component.id === id ? { ...component, position: { x: bounds.x, y: bounds.y }, size } : component) };
    onDocumentChange(next); setAssessment(null); setSimulation(null); setFocusedDiagnostic(null);
    if (finish) {
      if (JSON.stringify(gesture.before) !== JSON.stringify(next)) { setPast(items => [...items.slice(-79), gesture.before]); setFuture([]); }
      resizing.current = null;
    }
  }, [frozen, props.documentKey, onDocumentChange]);
  const cancelResize = useCallback(() => {
    const gesture = resizing.current; resizing.current = null;
    if (gesture && gesture.documentKey === props.documentKey && !frozen) onDocumentChange(gesture.before);
  }, [frozen, props.documentKey, onDocumentChange]);
  const linkedComponents = useMemo(() => circuit.components.filter(component => component.type === "contactor220" || component.type === "contactor380" || component.type === "relay380").map(({ id, label }) => ({ id, label })), [circuit.components]);

  const diagnostics = useMemo(() => focusedDiagnostic ? [focusedDiagnostic] : simulation?.diagnostics ?? [], [focusedDiagnostic, simulation]);
  const nodes = useMemo<ElectricalNode[]>(() => circuit.components.map(component => ({ id: component.id, type: "electrical", className: isWireDuct(component.type) ? "sim-duct-flow-node" : undefined, zIndex: isWireDuct(component.type) ? 0 : 2, position: component.position, selected: selectedNodes.includes(component.id), ...componentSize(component), style: componentSize(component), data: { component, document: circuit, selectedWireIds: selectedWires, running, runtime: simulation?.runtime ?? initial, result: simulation?.components[component.id], terminalStates: simulation?.terminals ?? {}, diagnostics, action, readOnly, linkedComponents, configure, beginResize, resize, cancelResize } })), [circuit, selectedNodes, selectedWires, running, simulation, initial, diagnostics, action, readOnly, linkedComponents, configure, beginResize, resize, cancelResize]);
  const edges = useMemo<ElectricalEdge[]>(() => circuit.wires.map(wire => ({ id: wire.id, type: "electrical", zIndex: 1, source: wire.from.componentId, target: wire.to.componentId, sourceHandle: wire.from.terminalId, targetHandle: wire.to.terminalId, selected: selectedWires.includes(wire.id), data: { document: circuit, wire, running, highlighted: diagnostics.some(diagnostic => diagnostic.wireIds.includes(wire.id)), energized: simulation?.energizedWireIds.includes(wire.id) ?? false, onWaypoints } })), [circuit, selectedWires, running, diagnostics, simulation, onWaypoints]);

  const nodesChanged = (changes: NodeChange<ElectricalNode>[]) => {
    const selection = changes.filter(change => change.type === "select");
    if (selection.length) setSelectedNodes(current => { const next = new Set(current); for (const change of selection) if (change.type === "select") { if (change.selected) next.add(change.id); else next.delete(change.id); } return [...next]; });
    if (frozen) return;
    const positions = changes.filter(change => change.type === "position" && change.position && change.id !== resizing.current?.id);
    if (positions.length) {
      const next = { ...docRef.current, components: docRef.current.components.map(component => { const update = positions.find(change => change.type === "position" && change.id === component.id); return update?.type === "position" && update.position ? { ...component, position: update.position } : component; }) };
      onDocumentChange(next); setAssessment(null); setSimulation(null);
    }
  };
  const edgesChanged = (changes: EdgeChange<ElectricalEdge>[]) => {
    setSelectedWires(current => { const next = new Set(current); for (const change of changes) if (change.type === "select") { if (change.selected) next.add(change.id); else next.delete(change.id); } return [...next]; });
  };
  const setWireColor = (next: string) => {
    setColor(next); setColorOverride(true);
    if (selectedWires.length) changed({ ...circuit, wires: circuit.wires.map(wire => selectedWires.includes(wire.id) ? { ...wire, color: next } : wire) });
  };
  const setStyle = (next: "orthogonal" | "straight" | "curve") => {
    setWireStyle(next);
    if (selectedWires.length) changed({ ...circuit, wires: circuit.wires.map(wire => selectedWires.includes(wire.id) ? { ...wire, style: next } : wire) });
  };
  const selectedStyles = [...new Set(circuit.wires.filter(wire => selectedWires.includes(wire.id)).map(wire => wire.style ?? "orthogonal"))];
  const displayedWireStyle = selectedStyles.length > 1 ? "mixed" : selectedStyles[0] ?? wireStyle;
  const openTransfer = (mode: "export" | "import") => {
    setTransferText(mode === "export" ? JSON.stringify(circuit, null, 2) : ""); setTransferNotice(""); setTransferMode(mode);
  };
  const exportDocument = () => {
    const url = URL.createObjectURL(new Blob([transferText], { type: "application/json" }));
    const anchor = globalThis.document.createElement("a");
    anchor.href = url; anchor.download = `${circuit.title || "电拓电路"}.json`;
    globalThis.document.body.appendChild(anchor);
    anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setTransferNotice("已请求下载。若浏览器没有保存文件，可复制下方 JSON 并另存为 .json 文件。");
  };
  const importDocument = (text: string) => {
    if (frozen) throw new Error("请先结束仿真，再导入电路。");
    if (new Blob([text]).size > 5 * 1024 * 1024) throw new Error("电路文件不能超过 5 MB。");
    const document = parseImport(JSON.parse(text));
    changed(document); setSelectedNodes([]); setSelectedWires([]); setTransferMode(null); setMessage("电路已导入，可撤销本次导入。");
    setTimeout(frameInitialView, 80);
  };
  const importFile = async (file: File) => {
    if (frozenRef.current) return;
    const request = ++importRequest.current;
    const original = docRef.current;
    const generation = session.generation;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("电路文件不能超过 5 MB。");
      const text = await file.text();
      // File reads can finish after edits, another import, or a new simulation/workspace.
      // The callback's captured frozen state cannot protect those later transitions.
      if (request !== importRequest.current || original !== docRef.current || generation !== session.generation || frozenRef.current) {
        setMessage("读取期间电路或仿真状态已变化，当前接线保持不变，请重新导入。");
        return;
      }
      importDocument(text);
    } catch (error) { setTransferNotice(error instanceof Error ? error.message : "导入失败。"); }
  };
  const perform = async (key: string, callback?: () => Promise<void> | void) => {
    if (!callback || busy) return;
    setBusy(key);
    try { await callback(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败，请重试。"); } finally { setBusy(""); }
  };
  const checkCircuit = async () => {
    setPanelOpen(true); setPanelTab(circuit.lessonId ? "lesson" : "safety");
    if (!running) setSimulation(simulate(circuit, initialRuntime(circuit, false)));
    if (!circuit.lessonId) { setMessage("自由接线只报告运行状态和安全诊断；请选择图纸课程后进行课程判定。"); return; }
    if (!onAssess) { setMessage("登录后可提交服务端课程检查。"); return; }
    const requestId = ++assessmentRequest.current;
    const snapshot = JSON.stringify(circuit);
    await perform("assess", async () => {
      const next = await onAssess(circuit);
      if (requestId !== assessmentRequest.current || snapshot !== JSON.stringify(docRef.current)) { setMessage("电路已变化，请重新检查当前接线。"); return; }
      setAssessment(next); setFocusedDiagnostic(null);
    });
  };
  const focusDiagnostic = (diagnostic: Diagnostic) => {
    setFocusedDiagnostic(diagnostic);
    const ids = diagnostic.componentIds.length ? diagnostic.componentIds : [...new Set(circuit.wires.filter(wire => diagnostic.wireIds.includes(wire.id)).flatMap(wire => [wire.from.componentId, wire.to.componentId]))];
    if (ids.length) flow.fitView({ nodes: ids.map(id => ({ id })), padding: 0.6, maxZoom: 1.25, duration: 300 });
  };
  const librarySections = poolGroups(category, search);
  const safetyDiagnostics = simulation?.diagnostics ?? [];
  const lessonDiagnostics = assessment?.diagnostics ?? [];
  const referenceDrawing = circuit.referenceDiagramId === undefined ? undefined : getReferenceDrawing(circuit.referenceDiagramId);
  const viewerControls = { zoom: drawingZoom, onZoomChange: setDrawingZoom };
  const drawingPreview = drawing ? <DrawingViewer compact src={drawing} type={props.drawingType} title="用户导入的接线图" {...viewerControls}/> : referenceDrawing ? <DrawingViewer compact src={referenceDrawingImageUrl(referenceDrawing.id, import.meta.env.BASE_URL || "/")} title={referenceDrawing.title} {...viewerControls}/> : null;
  const schematicContent = typeof renderSchematic === "function" ? renderSchematic(drawingPreview, referenceSelectionRevision, viewerControls) : drawingPreview ?? renderSchematic;

  return <div className={`sim-editor ${libraryOpen ? "" : "library-collapsed"} ${running ? "is-running" : ""}`} data-simulation-events={running ? JSON.stringify(session.trace) : undefined} onKeyDown={event => {
    if (event.key === "Escape" && resizing.current) { event.preventDefault(); cancelResize(); return; }
    if ((event.target as HTMLElement).matches("input,textarea,select")) return;
    if ((event.target as HTMLElement).closest('[contenteditable="true"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); copySelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelected(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
  }}>
    <aside className="sim-library">
      <div className="sim-library-heading"><h2>器件库</h2><button className="sim-search-toggle" aria-label={searchOpen ? "收起元件搜索" : "展开元件搜索"} onClick={() => { setSearchOpen(!searchOpen); if(searchOpen) setSearch(""); }}><Search size={16}/></button></div>
      <div className="sim-library-tabs" role="tablist" aria-label="元件分类"><button role="tab" aria-selected={category === "all"} className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>全部</button><button role="tab" aria-selected={category === "lighting"} className={category === "lighting" ? "active" : ""} onClick={() => setCategory("lighting")}>家庭电路组件</button><button role="tab" aria-selected={category === "industrial"} className={category === "industrial" ? "active" : ""} onClick={() => setCategory("industrial")}>工业电路组件</button></div>
      {searchOpen && <label className="sim-library-search"><Search size={14} /><input placeholder="搜索元器件" aria-label="搜索元器件" value={search} onChange={event => setSearch(event.target.value)} /></label>}
      <div className="sim-library-scroller">{librarySections.map(group => <section key={group.id} className="sim-library-group"><h3>{group.title}</h3><div className="sim-library-grid">
        {group.items.map(definition => <button key={definition.type} className="sim-library-item" disabled={frozen} draggable={!frozen} onDragStart={event => { event.dataTransfer.setData("application/x-diantuo-component", definition.type); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => addComponent(definition.type)} title={`${definition.description} 点击或拖入画布`} aria-label={`添加${definition.name}`}><DeviceArtwork type={definition.type}/><span>{poolLabel[definition.type] ?? definition.name}</span></button>)}
      </div></section>)}{!librarySections.length && <p className="sim-empty">没有找到匹配的元件</p>}{category !== "lighting" && !search && <div className="sim-pending-library"><h3>待支持</h3><div><span>PLC</span><small>暂不可接线</small></div></div>}</div>
      <p className="sim-library-note">点击添加或拖入画布<br />教学示意元件 · 端子可重复接线</p>
    </aside>
    <section className="sim-workspace">
      <div className="sim-toolbar">
        <button className={`sim-button sim-primary ${running ? "sim-stop" : ""}`} disabled={!!busy} onClick={startStop}>{running ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{running ? "结束仿真" : "开始仿真"}</button>
        <button className="sim-button sim-danger" disabled={frozen || (!selectedNodes.length && !selectedWires.length)} onClick={deleteSelected}>删除选中</button>
        <button className="sim-button sim-danger" disabled={frozen || !circuit.wires.length} onClick={() => { changed({ ...circuit, wires: [] }); setSelectedWires([]); }}>删除所有线</button>
        <div className="sim-color-control"><button className="sim-button sim-outline" disabled={frozen} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setColorAnchor({left: Math.max(8, Math.min(rect.left, window.innerWidth - 285)), top: rect.bottom + 6}); setColorsOpen(!colorsOpen); }}><i style={{ backgroundColor: color }} />设置导线颜色</button>{colorsOpen && board.current && createPortal(<div className="sim-color-popover" style={{position:"fixed",left:colorAnchor.left,top:colorAnchor.top}}><div className="sim-color-swatches">{COLORS.map(item => <button aria-label={`选择导线颜色 ${item}`} key={item} style={{ backgroundColor: item }} className={color === item && colorOverride ? "active" : ""} onClick={() => { setWireColor(item); setColorsOpen(false); }} />)}<input aria-label="自定义导线颜色" type="color" value={color} onChange={event => setWireColor(event.target.value)} /></div><button className={`sim-auto-color ${!colorOverride ? "active" : ""}`} onClick={() => { setColorOverride(false); setColorsOpen(false); }}>新导线跟随起点端子颜色</button></div>, board.current)}</div>
        <label className="sim-line-select"><span>线条样式</span><select aria-label="线条样式" disabled={frozen} value={displayedWireStyle} onChange={event => setStyle(event.target.value as typeof wireStyle)}>{displayedWireStyle === "mixed" && <option value="mixed" disabled>多种样式</option>}<option value="orthogonal">自定义直角</option><option value="straight">直线</option><option value="curve">曲线</option></select></label>
        <div className="sim-history"><button aria-label="复制选中对象" title="复制 Ctrl+C · Shift 多选" disabled={frozen || !selectedNodes.length} onClick={copySelected}><Copy size={18}/></button><button aria-label="粘贴对象" title="粘贴 Ctrl+V" disabled={frozen || !canPaste} onClick={pasteSelected}>粘贴</button><button aria-label="撤销" title="撤销 Ctrl+Z" disabled={frozen || !past.length} onClick={undo}><Undo2 size={18} /></button><button aria-label="重做" title="重做 Ctrl+Shift+Z" disabled={frozen || !future.length} onClick={redo}><Redo2 size={18} /></button></div>
        <div className="sim-toolbar-spacer" />
        <button className="sim-button sim-export" onClick={() => openTransfer("export")}><Download size={16} /><span>导出图纸到本地</span></button>
        <button className="sim-button sim-import" disabled={frozen} onClick={() => openTransfer("import")}><FolderOpen size={16} /><span>导入本地保存的图纸</span></button>
      </div>
      <div className="sim-canvas" ref={board} tabIndex={0} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = frozen ? "none" : "copy"; }} onDrop={event => { event.preventDefault(); const type = event.dataTransfer.getData("application/x-diantuo-component"); if (CATALOG.some(item => item.type === type)) addComponent(type as ComponentType, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}>
        <ReactFlow<ElectricalNode, ElectricalEdge>
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={nodesChanged} onEdgesChange={edgesChanged} onConnect={connect}
          connectionMode={ConnectionMode.Loose} connectionLineType={wireStyle === "straight" ? ConnectionLineType.Straight : wireStyle === "curve" ? ConnectionLineType.Bezier : ConnectionLineType.Step}
          onConnectStart={(_event, params) => { if (colorOverride) return; const component = circuit.components.find(item => item.id === params.nodeId); const terminal = component && getDefinition(component.type).terminals.find(item => item.id === params.handleId); if (terminal) setColor(terminalColor(terminal)); }}
          connectionLineStyle={{ stroke: color, strokeWidth: 3, vectorEffect: "non-scaling-stroke" }}
          nodesDraggable={!frozen} nodesConnectable={!frozen} elementsSelectable={!running}
          deleteKeyCode={null} minZoom={0.22} maxZoom={2} snapToGrid snapGrid={[8, 8]} defaultViewport={{ x: 35, y: 85, zoom: 0.78 }} fitViewOptions={{ padding: 0.22, maxZoom: 0.92 }}
          onNodeDragStart={() => { if (!resizing.current) dragBefore.current = clone(docRef.current); }}
          onNodeDragStop={(_event, node) => {
            if (resizing.current || frozen) return;
            const finalDocument = { ...docRef.current, components: docRef.current.components.map(component => component.id === node.id ? { ...component, position: node.position } : component) };
            if (dragBefore.current && JSON.stringify(dragBefore.current) !== JSON.stringify(finalDocument)) { const previous = dragBefore.current; setPast(items => [...items.slice(-79), previous]); setFuture([]); onDocumentChange(finalDocument); }
            dragBefore.current = null;
          }}
          onEdgeDoubleClick={(event, edge) => { if (frozen) return; event.stopPropagation(); const wire = circuit.wires.find(item => item.id === edge.id); if (wire && (!wire.style || wire.style === "orthogonal")) onWaypoints(wire.id, [...(wire.waypoints ?? []), flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })]); }}
          onPaneClick={() => { setFocusedDiagnostic(null); setColorsOpen(false); }}
          aria-label="电路接线画布"
        ><Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#ccd4de" /><Controls showInteractive={false} /></ReactFlow>
        <button className="sim-library-toggle" aria-label={libraryOpen ? "收起元件库" : "展开元件库"} onClick={() => setLibraryOpen(!libraryOpen)}>{libraryOpen ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}</button>
        <div className="sim-canvas-heading"><span>{running ? "正在仿真" : "接线工作台"}</span><b>{circuit.title}</b>{running && <i className={simulation?.runtime.faultLatched ? "fault" : simulation?.supported === false ? "unsupported" : "live"}>{simulation?.runtime.faultLatched ? "故障中止" : simulation?.supported === false ? "此接法暂不支持" : "运行中"}</i>}</div>
        {running && hasTimers && <div className="sim-clock" aria-label="教学仿真时钟"><span>教学时间 {((simulation?.runtime.timeMs ?? 0) / 1000).toFixed(1)} s{simulation?.supported === false ? " · 已暂停" : ""}</span><button disabled={simulation?.runtime.faultLatched || simulation?.supported === false} onClick={() => setTimerPaused(value => !value)}>{timerPaused ? "继续计时" : "暂停计时"}</button><button disabled={simulation?.runtime.faultLatched || simulation?.supported === false} onClick={() => action({ type: "advance-time", ms: 1000 })}>推进 1 秒</button></div>}
        <div className="sim-document-actions"><button className="sim-button" disabled={frozen || !!busy} onClick={() => drawingInput.current?.click()}><FileImage size={15} />上传图纸</button><button className="sim-button" disabled={!onSave || !!busy} onClick={() => perform("save", onSave)}>{busy === "save" ? "保存中…" : "保存草稿"}</button><button className="sim-button sim-primary" disabled={!onPublish || !!busy || running} onClick={() => perform("publish", onPublish)}>发布电路</button></div>
        <FloatingSchematic panelRef={diagramPanel} boardRef={board} documentKey={props.documentKey} zoom={drawingZoom} onZoomChange={setDrawingZoom} video={referenceVideoForDocument(circuit, !!drawing || !!props.drawingUrl || props.referenceVideoAllowed === false)} onChooseDrawing={() => setDrawingPickerOpen(true)} selectionDisabled={frozen}>
          <div className="sim-diagram-scaled">{schematicContent ?? <div className="sim-diagram-empty"><FileImage size={38}/><b>参考接线图</b><p>从图纸集选择课程，或上传自己的接线图。</p></div>}</div>
        </FloatingSchematic>
        <button className="sim-check-button" disabled={!!busy} onClick={checkCircuit}><ShieldCheck size={19} />{busy === "assess" ? "正在检查…" : "检查接线"}</button>
        {panelOpen && <section className="sim-diagnostics" aria-label="电路检查结果"><div className="sim-diagnostics-header"><button className={panelTab === "runtime" ? "active" : ""} onClick={() => setPanelTab("runtime")}>运行状态</button><button className={panelTab === "safety" ? "active" : ""} onClick={() => setPanelTab("safety")}>安全诊断{safetyDiagnostics.length > 0 && <i>{safetyDiagnostics.length}</i>}</button><button className={panelTab === "lesson" ? "active" : ""} onClick={() => setPanelTab("lesson")}>课程判定</button><button aria-label="收起检查结果" className="sim-panel-close" onClick={() => setPanelOpen(false)}><X size={16} /></button></div><div className="sim-diagnostics-body">
          {panelTab === "runtime" && <>{running ? <><p className="sim-panel-note">元件状态由实际接线计算；电机运行并不代表安全合格。</p><div className="sim-runtime-list">{circuit.components.filter(component => getDefinition(component.type).load || component.type === "overload").map(component => <div key={component.id}><span>{component.label} · {getDefinition(component.type).name}</span><b className={simulation?.components[component.id]?.active ? "active" : ""}>{runtimeSummary(simulation?.components[component.id])}</b></div>)}</div>{simulation?.runtime.faultLatched && <button className="sim-button sim-danger" onClick={() => action({ type: "reset-fault" })}>复位教学电源故障</button>}</> : <p className="sim-empty">点击「开始仿真」，再操作开关和按钮。</p>}</>}
          {panelTab === "safety" && <>{!simulation ? <p className="sim-empty">点击「检查接线」或「开始仿真」检查当前电路。</p> : safetyDiagnostics.length ? safetyDiagnostics.map((diagnostic, index) => <button key={`${diagnostic.code}-${index}`} className={`sim-diagnostic-row ${diagnostic.severity}`} onClick={() => focusDiagnostic(diagnostic)}><b>{diagnostic.severity === "error" ? "错误" : diagnostic.severity === "warning" ? "提醒" : "信息"}</b><span>{diagnostic.message}</span><ChevronRight size={14} /></button>) : <div className="sim-clear-state"><CheckCheck size={30} /><b>当前状态未检出安全故障</b><p>开关闭合后的故障会在运行中继续检查；完整合格结果还需通过课程动作。</p></div>}</>}
          {panelTab === "lesson" && <>{!circuit.lessonId ? <p className="sim-empty">当前是自由接线。先从图纸集选择课程，系统才能判断目标动作是否完成。</p> : assessment ? <><div className={`sim-assessment-status ${assessment.status}`}><b>{assessment.status === "passed" ? "课程通过" : assessment.status === "incomplete" ? "尚未完成" : assessment.status === "unsupported" ? "暂不支持此接法" : "接线未通过"}</b><span>{assessment.passed} / {assessment.total} 项动作符合要求</span></div><ul className="sim-check-list">{assessment.checks.map(check => <li key={check.id} className={check.passed ? "passed" : "failed"}><span>{check.passed ? "通过" : "未通过"}</span>{check.label}</li>)}</ul>{lessonDiagnostics.map((diagnostic, index) => <button key={`${diagnostic.code}-${index}`} className={`sim-diagnostic-row ${diagnostic.severity}`} onClick={() => focusDiagnostic(diagnostic)}><b>定位</b><span>{diagnostic.message}</span><ChevronRight size={14} /></button>)}</> : <p className="sim-empty">{busy === "assess" ? "正在按课程顺序检查合闸、启停和保护动作…" : "点击「检查接线」，系统会在副本中执行课程动作，保留当前画布。"}</p>}</>}
        </div></section>}
        {message && <div className="sim-toast" role="status">{message}<button aria-label="关闭提示" onClick={() => setMessage("")}><X size={14} /></button></div>}
        {shortAlert && <ShortCircuitAlert diagnostic={shortAlert} onClose={() => setShortAlert(null)} onLocate={() => { setShortAlert(null); setPanelOpen(true); setPanelTab("safety"); focusDiagnostic(shortAlert); }} />}
      </div>
      <footer className="sim-editor-footer"><span><i className={running ? "live" : ""} />{running ? "运行中 · 接线编辑已锁定" : "拖动端子接线 · 选中导线双击添加折点"}</span><span>{circuit.components.length} 个元件<span className="sim-footer-divider">·</span>{circuit.wires.length} 根导线<button aria-label="查看运行和诊断" onClick={() => { setPanelOpen(!panelOpen); setPanelTab(running ? "runtime" : "safety"); }}><PanelRightClose size={15} /></button></span></footer>
    </section>
    <ReferenceDrawingPicker open={drawingPickerOpen} selectedId={circuit.referenceDiagramId} disabled={frozen} onClose={() => setDrawingPickerOpen(false)} onSelect={id => { if (frozen) return; drawingSelectionEpoch.current++; setDrawing(""); setReferenceSelectionRevision(value => value + 1); changed(selectReferenceDrawing(docRef.current, id)); }}/>
    {transferMode && <div className="sim-transfer-backdrop" onClick={() => setTransferMode(null)}><section className="sim-transfer-dialog" role="dialog" aria-modal="true" aria-label={transferMode === "export" ? "导出电路 JSON" : "导入电路 JSON"} onClick={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") setTransferMode(null); }}><header><h2>{transferMode === "export" ? "导出电路" : "导入电路"}</h2><button className="sim-button" aria-label="关闭电路文件窗口" onClick={() => setTransferMode(null)}><X size={18}/></button></header><p>{transferMode === "export" ? "以下 JSON 包含元件、端子连接和走线路径。可下载文件，或复制后另存为 .json 文件。" : "选择电路 JSON 文件，或粘贴完整内容。导入将替换当前画布，可撤销；保存时会更新当前草稿。如需独立草稿，请先关闭窗口并新建电路，再导入。"}</p><textarea ref={transferInput} aria-label={transferMode === "export" ? "导出的电路 JSON" : "待导入的电路 JSON"} spellCheck={false} autoFocus readOnly={transferMode === "export"} value={transferText} onChange={event => { setTransferText(event.target.value); setTransferNotice(""); }} placeholder={transferMode === "import" ? "在此粘贴完整电路 JSON" : undefined}/>{transferNotice && <p className="sim-transfer-notice" role="status">{transferNotice}</p>}<footer>{transferMode === "export" ? <><button className="sim-button" onClick={async () => { try { await navigator.clipboard.writeText(transferText); setTransferNotice("电路 JSON 已复制。"); } catch { transferInput.current?.focus(); transferInput.current?.select(); setTransferNotice("浏览器未允许自动复制。已选中全部 JSON，请按 Ctrl+C 复制。"); } }}><Copy size={16}/>复制 JSON</button><button className="sim-button sim-primary" onClick={exportDocument}><Download size={16}/>下载 JSON 文件</button></> : <><button className="sim-button" disabled={frozen} onClick={() => importInput.current?.click()}><FolderOpen size={16}/>选择 JSON 文件</button><button className="sim-button sim-primary" disabled={frozen || !transferText.trim()} onClick={() => { try { importDocument(transferText); } catch (error) { setTransferNotice(error instanceof Error ? error.message : "导入失败。"); } }}>导入粘贴内容</button></>}</footer></section></div>}
    <input ref={importInput} type="file" accept="application/json,.json" className="sim-hidden-input" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) await importFile(file); }} />
    <input ref={drawingInput} type="file" accept="image/png,image/jpeg,image/webp" className="sim-hidden-input" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file || frozen) return; const uploadEpoch = ++drawingSelectionEpoch.current, uploadDocument = docRef.current, uploadGeneration = session.generation; const stillCurrent = () => uploadEpoch === drawingSelectionEpoch.current && uploadDocument === docRef.current && uploadGeneration === session.generation; await perform("drawing", async () => { if (file.size > 10 * 1024 * 1024) throw new Error("图纸图片不能超过 10 MB。"); if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("支持 PNG、JPEG 和 WebP 图片。"); if (onImportDrawing) { const uploaded = await onImportDrawing(file); if (!stillCurrent()) throw new Error("上传期间已切换图纸或编辑电路，当前接线保持不变，请重新上传。"); setDrawing(uploaded.url); changed({ ...docRef.current, referenceDiagramId: undefined, drawingMediaId: uploaded.id, drawingMediaType: file.type as "image/png" | "image/jpeg" | "image/webp", trainingProjectId: undefined, projectDrawings: undefined, drawingKind: undefined }); } else { const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file); }); if (!stillCurrent()) return; setDrawing(dataUrl); setMessage("已打开本地图纸预览；登录后上传可随草稿保存。"); } }); }} />
  </div>;
}

export default function SimulatorEditor(props: SimulatorEditorProps) {
  return <ReactFlowProvider><Workspace {...props} /></ReactFlowProvider>;
}
