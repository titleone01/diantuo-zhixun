"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { Background, BackgroundVariant, ConnectionMode, ConnectionLineType, ControlButton, Controls, ReactFlow, ReactFlowProvider, useReactFlow, useStore, useStoreApi, type Connection, type EdgeChange, type NodeChange } from "@xyflow/react";
import { CheckCheck, ChevronLeft, ChevronRight, FileImage, Maximize2, PanelRightClose, Play, Search, ShieldCheck, Square, X } from "lucide-react";
import { CATALOG, componentSize, DUCT_MAX_SIZE, DUCT_MIN_SIZE, getDefinition, transformedTerminal, isWireDuct, isLayoutObject, isTimer, isRelay, canRotate, rotateComponent, canMirror, mirrorComponent, equivalentComponentType, isTerminalStrip } from "../core/catalog";
import { courseRequirements, bindCourseRole, addCourseComponent } from "../core/course-roles";
import { initialRuntime, simulate } from "../core/engine";
import { setTerminalLabel } from "../core/terminal-labels";
import WireNumberToolbar from "./WireNumberToolbar";
import TerminalLabelsPanel from "./TerminalLabelsPanel";
import type { CircuitComponent, CircuitDocument, ComponentSize, ComponentType, Diagnostic, AssessmentReports, Point, SimulationAction, SimulationResult } from "../core/types";
import { getWireColorGroups, normalizeAutomaticControlWireColors, resolveConnectionColor } from "../core/wire-colors";
import { connectionWireNumber, getWiringNets, setWiringNetNumber, wireNumberNotices } from "../core/wire-nets";
import { presentDiagnostics } from "./diagnostic-presentation";
import WireTracePanel from "./WireTracePanel";
import DeviceArtwork from "./DeviceArtwork";
import DeviceNode, { type ElectricalNode } from "./DeviceNode";
import WireEdge, { type ElectricalEdge } from "./WireEdge";
import { deviceNodeGeometry } from "./node-geometry";
import { terminalColor } from "./geometry";
import { runtimeSummary } from "./labels";
import { createSimulationSession } from "./simulation-session";
import DrawingViewer, { type DrawingZoom } from "../DrawingViewer";
import type { DrawingPreview } from "../drawing-preview";
import FloatingSchematic from "./FloatingSchematic";
import { referenceVideoForDocument } from "../reference-video/catalog";
import { getReferenceDrawing, referenceDrawingImageUrl } from "../core/reference-drawings";
import { poolGroups, poolLabel } from "./library-presentation";
import ShortCircuitAlert from "./ShortCircuitAlert";
import { shortCircuitDiagnostic, shortCircuitNoticeKey } from "./short-circuit-notice";
import { ductWireRoute } from "./duct-routing";
import { arrangeTrainingDucts, putWiresInDucts } from "../core/duct-layout";
import "../reference-layout.css";
import "@xyflow/react/dist/style.css";
import "./editor.css";

export type SimulatorEditorProps = {
  document: CircuitDocument;
  documentKey?: string;
  onDocumentChange: (document: CircuitDocument) => void;
  onSave?: () => Promise<void> | void;
  onPublish?: () => Promise<void> | void;
  onAssess?: (document: CircuitDocument) => Promise<AssessmentReports>;
  onImportDrawing?: (file: File) => Promise<{ id: string; url: string }>;
  drawingUrl?: string;
  drawingType?: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  renderSchematic?: ReactNode | ((drawingPreview: ReactNode, selectionRevision: number, viewerControls: DrawingZoom, preview: DrawingPreview | null) => ReactNode);
  onDrawingPreviewChange?: (preview: DrawingPreview | null) => void;
  onOpenDrawingWindow?: () => void;
  referenceVideoAllowed?: boolean;
  onChooseCourse?: () => void;
  readOnly?: boolean;
  onRunningChange?: (running: boolean) => void;
};

const nodeTypes = { electrical: DeviceNode };
const edgeTypes = { electrical: WireEdge };
const COLORS = ["#e7b000", "#20b963", "#f04452", "#3478f6", "#56616f", "#659f2f"];
const LABELS: Record<ComponentType, string> = { supply: "电源", breaker3: "QF", breaker1: "QF", breaker2: "QF", fuse: "FU", fuse3: "FU", fuse2: "FU", "terminal-strip10": "XT", "terminal-strip16": "XT", "terminal-strip20": "XT", "knife-switch3": "QS", contactor220: "KM", contactor380: "KM", overload: "FR", "push-no": "SB", "push-nc": "SB", "push-latching-red": "SB", "push-latching-green": "SB", switch1: "S", switch2: "S", lamp: "EL", motor: "M", terminal: "XT", "pe-terminal": "PE", "auxiliary-no": "NO", relay380: "KA", timer380: "KT", "limit-switch": "SQ", "motor-star-delta": "M", "motor-dahlander": "M", "wire-duct": "WD", "wire-duct-vertical": "WD", "din-rail":"DR", "relay380-jzc1-22":"KA", "timer380-8pin":"KT" };
const clone = (value: CircuitDocument) => JSON.parse(JSON.stringify(value)) as CircuitDocument;
type EditorWireStyle = "orthogonal" | "straight" | "curve" | "duct";

function Workspace(props: SimulatorEditorProps) {
  const { document: circuit, onDocumentChange, onSave, onPublish, onAssess, onImportDrawing, renderSchematic, onRunningChange, readOnly = false } = props;
  const flow = useReactFlow<ElectricalNode, ElectricalEdge>();
  const flowStore = useStoreApi<ElectricalNode, ElectricalEdge>();
  // The same XYFlow state owns both clicks and the visible starting terminal.
  const pendingTerminal = useStore(state => state.connectionClickStartHandle);
  const cancelConnection = useCallback(() => {
    flowStore.setState({ connectionClickStartHandle: null });
    flowStore.getState().cancelConnection();
  }, [flowStore]);
  const docRef = useRef(circuit);
  useLayoutEffect(()=>{docRef.current=circuit;},[circuit]);
  const [category, setCategory] = useState<"all" | "industrial">("all");
  const [search, setSearch] = useState("");
  const [pendingRole,setPendingRole]=useState<string | null>(null);
  const requirements=useMemo(()=>courseRequirements(circuit.lessonId),[circuit.lessonId]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [colorAnchor, setColorAnchor] = useState({left:0,top:0});
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedWires, setSelectedWires] = useState<string[]>([]);
  const [traceMode, setTraceMode] = useState<"single" | "net">("single");
  const [showWireNumbers, setShowWireNumbers] = useState(true);
  const [color, setColor] = useState(COLORS[0]);
  const [colorOverride, setColorOverride] = useState(false);
  const [wireStyle, setWireStyle] = useState<EditorWireStyle>("duct");
  const [colorsOpen, setColorsOpen] = useState(false);
  const [colorHost,setColorHost]=useState<HTMLDivElement | null>(null);
  const [running, setRunning] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [session] = useState(createSimulationSession);
  const sessionGeneration = session.generation;
  const [assessmentReports, setAssessment] = useState<AssessmentReports | null>(null);
  const assessment = assessmentReports?.assessment ?? null;
  const workmanship = assessmentReports?.workmanship ?? null;
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"runtime" | "safety" | "lesson" | "workmanship">("runtime");
  const [localDrawing, setLocalDrawing] = useState({ documentKey: props.documentKey, source: props.drawingUrl, url: props.drawingUrl ?? '' });
  // Forget a local override when its source changes, including an undo back to an earlier source.
  if (localDrawing.documentKey !== props.documentKey || localDrawing.source !== props.drawingUrl) {
    setLocalDrawing({ documentKey: props.documentKey, source: props.drawingUrl, url: props.drawingUrl ?? '' });
  }
  const drawing = localDrawing.documentKey === props.documentKey && localDrawing.source === props.drawingUrl ? localDrawing.url : props.drawingUrl ?? '';
  const setDrawing = (url: string) => setLocalDrawing({ documentKey: props.documentKey, source: props.drawingUrl, url });
  const [drawingZoom, setDrawingZoom] = useState(1);
  const drawingSelectionEpoch = useRef(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [focusedDiagnostic, setFocusedDiagnostic] = useState<Diagnostic | null>(null);
  const resizing = useRef<{ id: string; before: CircuitDocument; documentKey?: string } | null>(null);
  const [dismissedShort, setDismissedShort] = useState('');
  const shortDiagnostic = running ? shortCircuitDiagnostic(simulation) : null;
  const shortKey = shortDiagnostic ? shortCircuitNoticeKey(sessionGeneration, shortDiagnostic) : '';
  if (!shortKey && dismissedShort) setDismissedShort('');
  const shortAlert = shortKey !== dismissedShort ? shortDiagnostic : null;
  const [currentDocument, setCurrentDocument] = useState(props.documentKey);
  if (currentDocument !== props.documentKey) {
    setCurrentDocument(props.documentKey); setPendingRole(null); setDismissedShort('');
    setRunning(false); setSimulation(null); setAssessment(null); setSelectedNodes([]); setSelectedWires([]); setFocusedDiagnostic(null);
  }
  const assessmentRequest = useRef(0);
  const board = useRef<HTMLDivElement | null>(null);
  const editorElement = useRef<HTMLDivElement | null>(null);
  const diagramPanel = useRef<HTMLDivElement | null>(null);
  const drawingInput = useRef<HTMLInputElement | null>(null);
  const frozen = running || readOnly;
  useLayoutEffect(() => { cancelConnection(); }, [props.documentKey, frozen, cancelConnection]);
  useLayoutEffect(() => {
    if (pendingTerminal && !circuit.components.some(component => component.id === pendingTerminal.nodeId && getDefinition(component.type).terminals.some(terminal => terminal.id === pendingTerminal.id))) cancelConnection();
  }, [circuit.components, pendingTerminal, cancelConnection]);
  const initial = useMemo(() => initialRuntime(circuit, false), [circuit]);
  const frameInitialView = useCallback(() => {
    const components = docRef.current.components;
    if (!components.length) { void flow.setViewport({ x: 50, y: 85, zoom: 0.78 }); return; }
    const minX = Math.min(...components.map(component => component.position.x));
    const minY = Math.min(...components.map(component => component.position.y));
    const maxX = Math.max(...components.map(component => component.position.x + componentSize(component).width));
    // These DOM sizes only frame the viewport; electrical endpoints remain in document coordinates.
    const boardWidth = board.current?.clientWidth ?? 1000;
    const diagramWidth = diagramPanel.current?.classList.contains("is-collapsed") ? 0 : diagramPanel.current?.offsetWidth ?? 332;
    const diagnosticsWidth = board.current?.querySelector<HTMLElement>(".sim-diagnostics")?.offsetWidth ?? 0;
    const usableWidth = Math.max(240, boardWidth - Math.max(diagramWidth, diagnosticsWidth) - 70);
    const maxY = Math.max(...components.map(component => component.position.y + componentSize(component).height + 45));
    const usableHeight = Math.max(240,(board.current?.clientHeight ?? 650)-160);
    const zoom = Math.max(0.22, Math.min(0.9, (usableWidth - 30) / Math.max(1, maxX - minX),usableHeight / Math.max(1,maxY-minY)));
    void flow.setViewport({ x: 35 + (usableWidth - (maxX - minX) * zoom) / 2 - minX * zoom, y: 85 - minY * zoom, zoom }, { duration: 180 });
  }, [flow]);

  useEffect(() => { onRunningChange?.(running); }, [running, onRunningChange]);
  useEffect(() => () => { onRunningChange?.(false); }, [onRunningChange]);

  useLayoutEffect(() => {
    assessmentRequest.current++;
    session.clear();
    resizing.current = null;
    const timer = setTimeout(frameInitialView, 80);
    return () => clearTimeout(timer);
  }, [props.documentKey, frameInitialView, session]);
  useEffect(() => () => session.clear(), [session]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(""), 4500); return () => clearTimeout(timer); }, [message]);

  const changed = useCallback((next: CircuitDocument) => {
    if (frozen) return;
    const previous = docRef.current;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    cancelConnection();
    setAssessment(null); setSimulation(null); setFocusedDiagnostic(null);
    docRef.current=next;onDocumentChange(next);
  }, [frozen, onDocumentChange, cancelConnection]);

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

  const hasTimers = circuit.components.some(component => isTimer(component.type));
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

  const addComponent = (type: ComponentType, point?: Point, role?: string) => {
    if (frozen) return;
    const bounds = board.current?.getBoundingClientRect();
    const position = point ?? flow.screenToFlowPosition({ x: (bounds?.left ?? 300) + (bounds?.width ?? 900) * 0.4, y: (bounds?.top ?? 120) + (bounds?.height ?? 600) * 0.4 });
    const prefix = LABELS[type];
    let index = 1;
    while (circuit.components.some(component => component.label === `${prefix}${index}`)) index++;
    const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
    const required=role&&requirements.find(item=>item.role===role);
    const component: CircuitComponent={ id, type, label: required?required.component.label:`${prefix}${index}`, position: { x: Math.round(position.x / 8) * 8, y: Math.round(position.y / 8) * 8 }, ...(required ? {rotation:required.component.rotation,mirrored:required.component.mirrored,pePositions:required.component.pePositions,settings:required.component.settings,linkedTo:required.component.linkedTo?docRef.current.roles?.[required.component.linkedTo]:undefined}: {}) };
    try{changed(role?addCourseComponent(docRef.current,role,component):{...docRef.current,components:[...docRef.current.components,component]});setPendingRole(null);}catch(error){setMessage((error as Error).message);return;}
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
    const colorChoice = resolveConnectionColor(circuit, from, to, colorOverride || !sourceComponent || !sourceTerminal ? color : terminalColor(transformedTerminal(sourceComponent, sourceTerminal)));
    const newColor = colorOverride ? color : colorChoice.color;
    // Automatic routing is an explicit style; manual styles remain manual.
    const automatic = wireStyle === "duct";
    const numberChoice = connectionWireNumber(circuit, from, to);
    changed(normalizeAutomaticControlWireColors({ ...circuit, wires: [...circuit.wires, { id: `wire-${crypto.randomUUID().slice(0, 10)}`, from, to, color: newColor, colorMode: colorOverride ? "manual" : "auto", ...(numberChoice.wireNumber ? { wireNumber: numberChoice.wireNumber } : {}), style: wireStyle === "duct" ? "orthogonal" : wireStyle, routing: automatic ? "duct" : undefined }] }));
    if (numberChoice.conflict) setMessage("连接的两组线号不同，原线号已保留，请核对后设置整组线号。");
    if (colorChoice.conflict) setMessage("同一导通组存在不同线色。选中任一导线，再选择颜色，可统一整组。");
    if (colorChoice.sourceConflict) setMessage("不同电源相接入了同一导通组，请检查接线；统一颜色不能消除电气冲突。");
  };
  const onWaypoints = useCallback((id: string, points: Point[]) => changed({ ...docRef.current, wires: docRef.current.wires.map(wire => wire.id === id ? { ...wire, waypoints: points } : wire) }), [changed]);
  const configure = useCallback((id: string, patch: Pick<CircuitComponent, "linkedTo" | "settings">) => changed({ ...docRef.current, components: docRef.current.components.map(component => component.id === id ? { ...component, ...patch } : component) }), [changed]);
  const beginResize = useCallback((id: string) => {
    if (frozen || !isLayoutObject(docRef.current.components.find(component => component.id === id)?.type ?? "")) return;
    resizing.current = { id, before: clone(docRef.current), documentKey: props.documentKey };
  }, [frozen, props.documentKey]);
  const resize = useCallback((id: string, bounds: Point & ComponentSize, finish = false) => {
    const gesture = resizing.current;
    if (frozen || !gesture || gesture.id !== id || gesture.documentKey !== props.documentKey || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return;
    const rail = docRef.current.components.find(c=>c.id===id)?.type === "din-rail";
    const size = { width: Math.max(DUCT_MIN_SIZE, Math.min(DUCT_MAX_SIZE, bounds.width)), height: rail ? 24 : Math.max(DUCT_MIN_SIZE, Math.min(DUCT_MAX_SIZE, bounds.height)) };
    const next = { ...docRef.current, components: docRef.current.components.map(component => component.id === id ? { ...component, position: { x: bounds.x, y: bounds.y }, size } : component) };
    onDocumentChange(next); setAssessment(null); setSimulation(null); setFocusedDiagnostic(null);
    if (finish) {
      resizing.current = null;
    }
  }, [frozen, props.documentKey, onDocumentChange]);
  const cancelResize = useCallback(() => {
    const gesture = resizing.current; resizing.current = null;
    if (gesture && gesture.documentKey === props.documentKey && !frozen) onDocumentChange(gesture.before);
  }, [frozen, props.documentKey, onDocumentChange]);
  const linkedComponents = useMemo(() => circuit.components.filter(component => component.type === "contactor220" || component.type === "contactor380" || isRelay(component.type)).map(({ id, label }) => ({ id, label })), [circuit.components]);

  const diagnostics = useMemo(() => focusedDiagnostic ? [focusedDiagnostic] : simulation?.diagnostics ?? [], [focusedDiagnostic, simulation]);
  const terminalColors = useMemo(() => Object.fromEntries(getWireColorGroups(circuit).filter(group => group.colors.length === 1 && group.sourcePotentials.length <= 1).flatMap(group => group.terminalIds.map(id => [id, group.colors[0]]))), [circuit]);
  const wiringNets = useMemo(() => getWiringNets(circuit), [circuit]);
  const numberNotices = useMemo(() => wireNumberNotices(wiringNets), [wiringNets]);
  const traceNet = wiringNets.find(net => net.wireIds.includes(selectedWires.at(-1) ?? ""));
  const targetWire = circuit.wires.find(wire => wire.id === selectedWires.at(-1));
  const numberTarget = targetWire && traceNet ? `${circuit.components.find(c => c.id === targetWire.from.componentId)?.label} → ${circuit.components.find(c => c.id === targetWire.to.componentId)?.label} · ${traceNet.wireIds.length}根线` : "先选择导线";
  const tracedWireIds = useMemo(() => traceMode === "net" ? traceNet?.wireIds ?? [] : selectedWires, [traceMode, traceNet, selectedWires]);
  const tracedTerminalIds = useMemo(() => traceMode === "net" ? traceNet?.terminalIds ?? [] : circuit.wires.filter(wire => selectedWires.includes(wire.id)).flatMap(wire => [`${wire.from.componentId}::${wire.from.terminalId}`, `${wire.to.componentId}::${wire.to.terminalId}`]), [traceMode, traceNet, circuit.wires, selectedWires]);
  const terminalWireNumbers = useMemo(() => showWireNumbers ? Object.fromEntries(wiringNets.filter(net => net.numbers.length > 0).flatMap(net => net.terminalIds.map(id => [id, net.numbers.join(" / ")]))) : {}, [wiringNets, showWireNumbers]);
  const clearTrace = () => { setSelectedWires([]); cancelConnection(); };
  const applyWireNumber = (number: string) => {
    if (frozen || !traceNet) return;
    try { changed(setWiringNetNumber(docRef.current, traceNet.wireIds[0], number)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "线号设置失败。"); }
  };
  const nodes = useMemo<ElectricalNode[]>(() => circuit.components.map(component => ({ id: component.id, type: "electrical", className: isLayoutObject(component.type) ? "sim-duct-flow-node" : undefined, zIndex: isLayoutObject(component.type) ? 0 : 2, position: component.position, selectable: !running, selected: selectedNodes.includes(component.id), ...deviceNodeGeometry(component), style: componentSize(component), data: { component, document: circuit, selectedWireIds: tracedWireIds, tracedTerminalIds, wireNumbers: terminalWireNumbers, pendingTerminalKey: pendingTerminal ? `${pendingTerminal.nodeId}::${pendingTerminal.id}` : undefined, running, runtime: simulation?.runtime ?? initial, result: simulation?.components[component.id], terminalStates: simulation?.terminals ?? {}, terminalColors, diagnostics, action, readOnly, linkedComponents, configure, beginResize, resize, cancelResize } })), [circuit, selectedNodes, tracedWireIds, tracedTerminalIds, terminalWireNumbers, pendingTerminal, running, simulation, initial, terminalColors, diagnostics, action, readOnly, linkedComponents, configure, beginResize, resize, cancelResize]);
  const edges = useMemo<ElectricalEdge[]>(() => circuit.wires.map(wire => ({ id: wire.id, type: "electrical", zIndex: 1, source: wire.from.componentId, target: wire.to.componentId, sourceHandle: wire.from.terminalId, targetHandle: wire.to.terminalId, selected: selectedWires.includes(wire.id), data: { document: circuit, wire, running, readOnly, traced: tracedWireIds.includes(wire.id), highlighted: diagnostics.some(diagnostic => diagnostic.severity !== "info" && diagnostic.wireIds.includes(wire.id)), energized: simulation?.energizedWireIds.includes(wire.id) ?? false, onWaypoints } })), [circuit, selectedWires, tracedWireIds, running, readOnly, diagnostics, simulation, onWaypoints]);

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
    if (selectedWires.length) changed({ ...circuit, wires: circuit.wires.map(wire => selectedWires.includes(wire.id) ? { ...wire, color: next, colorMode: "manual" } : wire) });
  };
  const setStyle = (next: EditorWireStyle) => {
    if (frozen) return;
    setWireStyle(next);
    if (selectedWires.length) changed({ ...circuit, wires: circuit.wires.map(wire => selectedWires.includes(wire.id) ? { ...wire, style: next === "duct" ? "orthogonal" : next, routing: next === "duct" ? "duct" : undefined } : wire) });
  };
  const hasDucts = circuit.components.some(component => isWireDuct(component.type));
  const selectedStyles = [...new Set(circuit.wires.filter(wire => selectedWires.includes(wire.id)).map(wire => wire.routing === "duct" ? "duct" : wire.style ?? "orthogonal"))];
  const displayedWireStyle = selectedStyles.length > 1 ? "mixed" : selectedStyles[0] ?? wireStyle;
  const selectedComponent = selectedNodes.length === 1 ? circuit.components.find(component => component.id === selectedNodes[0]) : undefined;
  const pendingComponent = pendingTerminal && circuit.components.find(component => component.id === pendingTerminal.nodeId);
  const pendingTerminalLabel = pendingComponent && getDefinition(pendingComponent.type).terminals.find(terminal => terminal.id === pendingTerminal?.id)?.label;
  const arrangeDucts = () => {
    if (frozen) return;
    try {
      changed(putWiresInDucts(arrangeTrainingDucts(docRef.current)));
      setWireStyle("duct");
      setMessage(hasDucts ? "已切换自动走线；未入槽的导线会持续显示提示。" : "已按课程布局预布线槽，接线后自动入槽。");
      if (!hasDucts) setTimeout(frameInitialView, 80);
    } catch (error) { setMessage(error instanceof Error ? error.message : "线槽布置失败。"); }
  };
  const perform = async (key: string, callback?: () => Promise<void> | void) => {
    if (!callback || busy) return;
    setBusy(key);
    try { await callback(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败，请重试。"); } finally { setBusy(""); }
  };
  const checkCircuit = async () => {
    setPanelOpen(true); setPanelTab(circuit.lessonId ? "lesson" : "safety");
    setTimeout(frameInitialView, 80);
    if (!running) setSimulation(simulate(circuit, initialRuntime(circuit)));
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
  const { safety: safetyDiagnostics, runtime: runtimeInformation } = presentDiagnostics(simulation?.diagnostics ?? []);
  // Show the canvas notice only when automatic routing cannot produce a complete path.
  // Lane density is already handled by automatic routing; prompt only when a path cannot be drawn.
  const routingProblems = useMemo(() => circuit.wires.filter(wire => wire.routing === "duct").map(wire => ({ wire, route: ductWireRoute(circuit, wire) })).filter(item => item.route.status !== "routed"), [circuit]);
  const lessonDiagnostics = assessment?.diagnostics ?? [];
  const referenceDrawing = circuit.referenceDiagramId === undefined ? undefined : getReferenceDrawing(circuit.referenceDiagramId);
  const viewerControls = { zoom: drawingZoom, onZoomChange: setDrawingZoom };
  const drawingPreview = drawing ? <DrawingViewer compact src={drawing} type={props.drawingType} title="用户导入的接线图" {...viewerControls}/> : referenceDrawing ? <DrawingViewer compact src={referenceDrawingImageUrl(referenceDrawing.id, import.meta.env.BASE_URL || "/")} title={referenceDrawing.title} {...viewerControls}/> : null;
  const previewDescriptor = useMemo<DrawingPreview | null>(() => drawing
    ? { key: drawing, src: drawing, type: props.drawingType, title: "用户导入的接线图" }
    : referenceDrawing ? { key: String(referenceDrawing.id), src: referenceDrawingImageUrl(referenceDrawing.id, import.meta.env.BASE_URL || "/"), title: referenceDrawing.title }
    : renderSchematic && typeof renderSchematic !== "function" ? { key: props.documentKey ?? circuit.title, title: circuit.title, content: renderSchematic } : null,
  [drawing, props.drawingType, referenceDrawing, renderSchematic, props.documentKey, circuit.title]);
  const onDrawingPreviewChange = props.onDrawingPreviewChange;
  useEffect(() => { if (typeof renderSchematic !== "function") onDrawingPreviewChange?.(previewDescriptor); }, [previewDescriptor, renderSchematic, onDrawingPreviewChange]);
  const schematicContent = typeof renderSchematic === "function" ? renderSchematic(drawingPreview, 0, viewerControls, previewDescriptor) : drawingPreview ?? renderSchematic;

  // Delegate shortcuts from native controls inside this editor, excluding portal dialogs.
  useEffect(() => {
    const element = editorElement.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && (flowStore.getState().connectionClickStartHandle || flowStore.getState().connection.inProgress)) { event.preventDefault(); cancelConnection(); return; }
    if(event.key === "Escape" && pendingRole){event.preventDefault();setPendingRole(null);return;}
    if (event.key === "Escape" && resizing.current) { event.preventDefault(); cancelResize(); return; }
    if ((event.target as HTMLElement).matches("input,textarea,select")) return;
    if (event.key === "Escape") { event.preventDefault(); clearTrace(); setSelectedNodes([]); return; }
    if ((event.target as HTMLElement).closest('[contenteditable="true"]')) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  });
  return <div ref={editorElement} role="group" aria-label="电路编辑器" className={`sim-editor ${libraryOpen ? "" : "library-collapsed"} ${running ? "is-running" : ""}`} data-simulation-events={running ? JSON.stringify(session.trace) : undefined}>
    <aside className="sim-library">
      <div className="sim-library-heading"><h2>器件库</h2><button className="sim-search-toggle" aria-label={searchOpen ? "收起元件搜索" : "展开元件搜索"} onClick={() => { setSearchOpen(!searchOpen); if(searchOpen) setSearch(""); }}><Search size={16}/></button></div>
      <div className="sim-library-tabs" role="tablist" aria-label="元件分类"><button role="tab" aria-selected={category === "all"} className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>全部</button><button role="tab" aria-selected={category === "industrial"} className={category === "industrial" ? "active" : ""} onClick={() => setCategory("industrial")}>工业电路组件</button></div>
      {searchOpen && <label className="sim-library-search"><Search size={14} /><input placeholder="搜索元器件" aria-label="搜索元器件" value={search} onChange={event => setSearch(event.target.value)} /></label>}
      {requirements.length>0 && <details className="sim-course-checklist"><summary>课程器件清单 · {requirements.filter(r=>!!circuit.roles?.[r.role]).length}/{requirements.length}</summary><p>{pendingRole ? "点击画布空白处放置；Esc取消" : "课程器件未齐时不能合格；按位号添加器件，再自行摆放和接线"}</p>{pendingRole && <button disabled={frozen} onClick={()=>{const entry=requirements.find(r=>r.role===pendingRole);if(entry)addComponent(entry.component.type,undefined,pendingRole);}}>放到可见画布中心</button>}{requirements.map(entry=><div key={entry.role}><span><b>{entry.component.label}</b><small>{getDefinition(entry.component.type).name}</small></span><button disabled={frozen || !!circuit.roles?.[entry.role]} onClick={()=>setPendingRole(entry.role)}>{circuit.roles?.[entry.role]?"已绑定":"添加并放置"}</button></div>)}</details>}
      {requirements.length>0 && selectedNodes.length===1 && <label className="sim-role-binding">课程位号<select aria-label="绑定课程位号" disabled={frozen} value={Object.entries(circuit.roles??{}).find(([,id])=>id===selectedNodes[0])?.[0]??""} onChange={event=>{try{changed(bindCourseRole(docRef.current,selectedNodes[0],event.target.value));}catch(error){setMessage((error as Error).message);}}}><option value="">未绑定／解除绑定</option>{requirements.filter(r=>equivalentComponentType(circuit.components.find(c=>c.id===selectedNodes[0])?.type??"",r.component.type)).map(r=><option key={r.role} value={r.role} disabled={!!circuit.roles?.[r.role]&&circuit.roles[r.role]!==selectedNodes[0]}>{r.component.label}</option>)}</select></label>}
      <div className="sim-library-scroller">{selectedComponent && isTerminalStrip(selectedComponent.type) && <TerminalLabelsPanel component={selectedComponent} disabled={frozen} onLabel={(position, label) => { try { changed(setTerminalLabel(docRef.current, selectedComponent.id, position, label)); } catch (error) { setMessage((error as Error).message); } }} onClear={() => changed({ ...docRef.current, components: docRef.current.components.map(component => { if (component.id !== selectedComponent.id) return component; const next = { ...component }; delete next.terminalLabels; return next; }) })} onClose={() => setSelectedNodes([])} />}{librarySections.map(group => <section key={group.id} className="sim-library-group"><h3>{group.title}</h3><div className="sim-library-grid">
        {group.items.map(definition => <button key={definition.type} className="sim-library-item" disabled={frozen} draggable={!frozen} onDragStart={event => { event.dataTransfer.setData("application/x-diantuo-component", definition.type); event.dataTransfer.effectAllowed = "copy"; }} onClick={() => addComponent(definition.type)} title={`${definition.description} 点击或拖入画布`} aria-label={`添加${definition.name}`}><DeviceArtwork type={definition.type}/><span>{poolLabel[definition.type] ?? definition.name}</span></button>)}
      </div></section>)}{!librarySections.length && <p className="sim-empty">没有找到匹配的元件</p>}{!search && <div className="sim-pending-library"><h3>待支持</h3><div><span>PLC</span><small>暂不可接线</small></div></div>}</div>
      <p className="sim-library-note">点击添加或拖入画布<br />教学示意元件 · 端子可重复接线</p>
    </aside>
    <section className="sim-workspace">
      <div className="sim-toolbar">
        <button className={`sim-button sim-primary ${running ? "sim-stop" : ""}`} disabled={!!busy} onClick={startStop}>{running ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{running ? "结束仿真" : "开始仿真"}</button>
        <button className="sim-button sim-danger" disabled={frozen || (!selectedNodes.length && !selectedWires.length)} onClick={deleteSelected}>删除选中</button>
        <button className="sim-button sim-danger" disabled={frozen || !circuit.wires.length} onClick={() => { changed({ ...circuit, wires: [] }); setSelectedWires([]); }}>删除所有线</button>
        <div className="sim-color-control"><button className="sim-button sim-outline" disabled={frozen} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setColorAnchor({left: Math.max(8, Math.min(rect.left, window.innerWidth - 285)), top: rect.bottom + 6}); setColorHost(board.current); setColorsOpen(!colorsOpen); }}><i style={{ backgroundColor: color }} />设置导线颜色</button>{colorsOpen && colorHost && createPortal(<div className="sim-color-popover" style={{position:"fixed",left:colorAnchor.left,top:colorAnchor.top}}><div className="sim-color-swatches">{COLORS.map(item => <button aria-label={`选择导线颜色 ${item}`} key={item} style={{ backgroundColor: item }} className={color === item && colorOverride ? "active" : ""} onClick={() => { setWireColor(item); setColorsOpen(false); }} />)}<input aria-label="自定义导线颜色" type="color" value={color} onChange={event => setWireColor(event.target.value)} /></div><button className={`sim-auto-color ${!colorOverride ? "active" : ""}`} onClick={() => { setColorOverride(false); setColorsOpen(false); }}>新导线跟随起点端子颜色</button></div>, colorHost)}</div>
        <label className="sim-line-select"><span>线条样式</span><select aria-label="线条样式" disabled={frozen} value={displayedWireStyle} onChange={event => setStyle(event.target.value as typeof wireStyle)}>{displayedWireStyle === "mixed" && <option value="mixed" disabled>多种样式</option>}<option value="duct">自动走线槽</option><option value="orthogonal">自定义直角</option><option value="straight">直线</option><option value="curve">曲线</option></select></label>
        <div className="sim-trace-mode" role="group" aria-label="选线模式"><button type="button" aria-pressed={traceMode === "single"} onClick={() => setTraceMode("single")}>单根</button><button type="button" aria-pressed={traceMode === "net"} onClick={() => { cancelConnection(); setTraceMode("net"); if (selectedWires.length > 1) setSelectedWires(selectedWires.slice(-1)); }}>等电位</button></div>
        <label className="sim-show-wire-numbers"><input type="checkbox" checked={showWireNumbers} onChange={event => setShowWireNumbers(event.target.checked)} />显示线号</label>
        <button className="sim-button sim-outline" aria-label={hasDucts ? "导线全部入槽" : "预布线槽"} disabled={frozen || !circuit.components.length} onClick={arrangeDucts}>{hasDucts ? "导线全部入槽" : "预布线槽"}</button>
        {selectedComponent && canMirror(selectedComponent.type) ? <button className="sim-button" disabled={frozen} onClick={() => changed({ ...docRef.current, components: docRef.current.components.map(component => component.id === selectedComponent.id ? mirrorComponent(component) : component) })}>上下镜像</button> : <button className="sim-button" disabled={frozen || !selectedComponent || !canRotate(selectedComponent.type)} onClick={() => changed({ ...docRef.current, components: docRef.current.components.map(component => component.id === selectedComponent?.id ? rotateComponent(component) : component) })}>旋转90°</button>}
        <div className="sim-toolbar-spacer" />
        <WireNumberToolbar key={`${props.documentKey}:${traceNet?.id ?? "none"}:${JSON.stringify(traceNet?.numbers)}`} numbers={traceNet?.numbers ?? []} target={numberTarget} disabled={frozen || !traceNet} onNumber={applyWireNumber} />
      </div>
      <div className="sim-canvas" role="group" aria-label="接线工作台" ref={board} tabIndex={-1} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = frozen ? "none" : "copy"; }} onDrop={event => { event.preventDefault(); const type = event.dataTransfer.getData("application/x-diantuo-component"); if (CATALOG.some(item => item.type === type)) addComponent(type as ComponentType, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}>
        <ReactFlow<ElectricalNode, ElectricalEdge>
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={nodesChanged} onEdgesChange={edgesChanged} onConnect={connect}
          onEdgeClick={(_event, edge) => { cancelConnection(); setFocusedDiagnostic(null); if (traceMode === "net") { setSelectedWires([edge.id]); setSelectedNodes([]); } board.current?.focus(); }}
          onNodeClick={(event,node)=>{
            if(running || !(event.shiftKey || event.ctrlKey || event.metaKey))return;
            setSelectedNodes(selectedNodes.includes(node.id) ? selectedNodes.filter(id=>id!==node.id) : [...selectedNodes,node.id]);
          }}
          connectionMode={ConnectionMode.Loose} connectionLineType={wireStyle === "straight" ? ConnectionLineType.Straight : wireStyle === "curve" ? ConnectionLineType.Bezier : ConnectionLineType.Step}
          connectOnClick
          onConnectStart={(_event, params) => { board.current?.focus(); if (colorOverride) return; const component = circuit.components.find(item => item.id === params.nodeId); const terminal = component && getDefinition(component.type).terminals.find(item => item.id === params.handleId); if (component && terminal) setColor(terminalColor(transformedTerminal(component, terminal))); }}
          onClickConnectStart={() => { board.current?.focus(); setSelectedWires([]); }}
          connectionLineStyle={{ stroke: color, strokeWidth: 3, vectorEffect: "non-scaling-stroke" }}
          nodesDraggable={!frozen} nodesConnectable={!frozen} elementsSelectable
          deleteKeyCode={null} minZoom={0.22} maxZoom={2} snapToGrid snapGrid={[8, 8]} defaultViewport={{ x: 35, y: 85, zoom: 0.78 }} fitViewOptions={{ padding: 0.22, maxZoom: 0.92 }}
          onNodeDragStop={(_event, node) => {
            if (resizing.current || frozen) return;
            const finalDocument = { ...docRef.current, components: docRef.current.components.map(component => component.id === node.id ? { ...component, position: node.position } : component) };
            docRef.current = finalDocument; onDocumentChange(finalDocument);
          }}
          onEdgeDoubleClick={(event, edge) => { if (frozen) return; event.stopPropagation(); const wire = circuit.wires.find(item => item.id === edge.id); if (wire && wire.routing !== "duct" && (!wire.style || wire.style === "orthogonal")) onWaypoints(wire.id, [...(wire.waypoints ?? []), flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })]); }}
          onPaneClick={event => { board.current?.focus(); clearTrace(); setSelectedNodes([]); setFocusedDiagnostic(null); setColorsOpen(false); if(pendingRole&&!frozen){const entry=requirements.find(item=>item.role===pendingRole);if(entry)addComponent(entry.component.type,flow.screenToFlowPosition({x:event.clientX,y:event.clientY}),pendingRole);} }}
          aria-label="电路接线画布"
        ><Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#ccd4de" /><Controls showInteractive={false} showFitView={false}><ControlButton className="react-flow__controls-fitview" aria-label="适应画布" title="适应画布" onClick={frameInitialView}><Maximize2 size={16}/></ControlButton></Controls></ReactFlow>
        <button className="sim-library-toggle" aria-label={libraryOpen ? "收起器件库" : "展开器件库"} onClick={() => setLibraryOpen(!libraryOpen)}>{libraryOpen ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}</button>
        <div className="sim-canvas-heading"><span>{running ? "正在仿真" : "接线工作台"}</span><b>{circuit.title}</b>{running && <i className={simulation?.runtime.faultLatched ? "fault" : simulation?.supported === false ? "unsupported" : "live"}>{simulation?.runtime.faultLatched ? "故障中止" : simulation?.supported === false ? "此接法暂不支持" : "运行中"}</i>}</div>
        {routingProblems.length > 0 && <div className="sim-routing-notice" role="status" aria-label="自动走线提示"><b>{routingProblems.length} 根导线需要整理</b><span>{routingProblems[0].route.message ?? "未找到可用的连通线槽，请检查线槽连接和元件遮挡。"}</span></div>}
        {running && hasTimers && <div className="sim-clock" aria-label="教学仿真时钟"><span>教学时间 {((simulation?.runtime.timeMs ?? 0) / 1000).toFixed(1)} s{simulation?.supported === false ? " · 已暂停" : ""}</span><button disabled={simulation?.runtime.faultLatched || simulation?.supported === false} onClick={() => setTimerPaused(value => !value)}>{timerPaused ? "继续计时" : "暂停计时"}</button><button disabled={simulation?.runtime.faultLatched || simulation?.supported === false} onClick={() => action({ type: "advance-time", ms: 1000 })}>推进 1 秒</button></div>}
        <div className="sim-document-actions"><button className="sim-button" disabled={frozen || !!busy} onClick={() => drawingInput.current?.click()}><FileImage size={15} />上传图纸</button><button className="sim-button" disabled={!onSave || !!busy} onClick={() => perform("save", onSave)}>{busy === "save" ? "保存中…" : "保存草稿"}</button><button className="sim-button sim-primary" disabled={!onPublish || !!busy || running} onClick={() => perform("publish", onPublish)}>发布电路</button></div>
        <FloatingSchematic panelRef={diagramPanel} boardRef={board} documentKey={props.documentKey} zoom={drawingZoom} onZoomChange={setDrawingZoom} video={referenceVideoForDocument(circuit, !!drawing || !!props.drawingUrl || props.referenceVideoAllowed === false)} onChooseDrawing={props.onChooseCourse ? () => { if (!frozen) props.onChooseCourse?.(); } : undefined} onOpenDrawingWindow={props.onOpenDrawingWindow} selectionDisabled={frozen}>
          <div className="sim-diagram-scaled">{schematicContent ?? <div className="sim-diagram-empty"><FileImage size={38}/><b>参考接线图</b><p>从图纸集选择课程，或上传自己的接线图。</p></div>}</div>
        </FloatingSchematic>
        <button className="sim-check-button" disabled={!!busy} onClick={checkCircuit}><ShieldCheck size={19} />{busy === "assess" ? "正在检查…" : "检查接线"}</button>
        {traceNet && <WireTracePanel key={`${traceNet.id}:${JSON.stringify(traceNet.numbers)}`} document={circuit} net={traceNet} selectedCount={selectedWires.length} frozen={frozen} mode={traceMode} notices={numberNotices.filter(notice => notice.netIds.includes(traceNet.id))} onNumber={applyWireNumber} onLocate={id => { void flow.fitView({ nodes: [{ id }], padding: 0.7, maxZoom: 1.25, duration: 180 }); }} onClose={clearTrace}/>}
        {!traceNet && numberNotices.length > 0 && <div className="sim-wire-number-notice" role="status"><b>{numberNotices.length} 项线号标注提醒</b><span>{numberNotices[0].message}</span></div>}
        {panelOpen && <section className="sim-diagnostics" aria-label="电路检查结果"><div className="sim-diagnostics-header"><button className={panelTab === "runtime" ? "active" : ""} onClick={() => setPanelTab("runtime")}>运行状态</button><button className={panelTab === "safety" ? "active" : ""} onClick={() => setPanelTab("safety")}>安全诊断{safetyDiagnostics.length > 0 && <i>{safetyDiagnostics.length}</i>}</button><button className={panelTab === "lesson" ? "active" : ""} onClick={() => setPanelTab("lesson")}>课程判定</button><button className={panelTab === "workmanship" ? "active" : ""} onClick={() => setPanelTab("workmanship")}>端子工艺</button><button aria-label="收起检查结果" className="sim-panel-close" onClick={() => setPanelOpen(false)}><X size={16} /></button></div><div className="sim-diagnostics-body">
          {panelTab === "runtime" && <>{simulation ? <><p className="sim-panel-note">元件状态由实际接线计算；电机运行并不代表安全合格。</p><div className="sim-runtime-list">{circuit.components.filter(component => getDefinition(component.type).load || component.type === "overload").map(component => <div key={component.id}><span>{component.label} · {getDefinition(component.type).name}</span><b className={simulation?.components[component.id]?.active ? "active" : ""}>{runtimeSummary(simulation?.components[component.id])}</b></div>)}</div>{runtimeInformation.map((item, index) => <button key={item.code + index} className="sim-diagnostic-row info" onClick={() => focusDiagnostic(item)}><b>信息</b><span>{item.message}</span><ChevronRight size={14}/></button>)}{running && simulation?.runtime.faultLatched && <button className="sim-button sim-danger" onClick={() => action({ type: "reset-fault" })}>复位教学电源故障</button>}</> : <p className="sim-empty">点击「检查接线」或「开始仿真」，查看当前元件状态。</p>}</>}
          {panelTab === "safety" && <>{!simulation ? <p className="sim-empty">点击「检查接线」或「开始仿真」检查当前电路。</p> : safetyDiagnostics.length ? safetyDiagnostics.map((diagnostic, index) => <button key={`${diagnostic.code}-${index}`} className={`sim-diagnostic-row ${diagnostic.severity}`} onClick={() => focusDiagnostic(diagnostic)}><b>{diagnostic.severity === "error" ? "错误" : diagnostic.severity === "warning" ? "提醒" : "信息"}</b><span>{diagnostic.message}</span><ChevronRight size={14} /></button>) : <div className="sim-clear-state"><CheckCheck size={30} /><b>当前状态未检出安全故障</b><p>开关闭合后的故障会在运行中继续检查；完整合格结果还需通过课程动作。</p></div>}</>}
          {panelTab === "lesson" && <>{!circuit.lessonId ? <p className="sim-empty">当前是自由接线。先从图纸集选择课程，系统才能判断目标动作是否完成。</p> : assessment ? <><div className={`sim-assessment-status ${assessment.status}`}><b>{assessment.status === "passed" ? "课程通过" : assessment.status === "incomplete" ? (assessment.diagnostics.some(item=>item.code==="LESSON_ROLE_MISSING")?"课程器件未齐":"尚未完成") : assessment.status === "unsupported" ? "暂不支持此接法" : "接线未通过"}</b><span>{assessment.passed} / {assessment.total} 项动作符合要求</span></div><ul className="sim-check-list">{assessment.checks.map(check => <li key={check.id} className={check.passed ? "passed" : "failed"}><span>{check.passed ? "通过" : "未通过"}</span>{check.label}</li>)}</ul>{lessonDiagnostics.map((diagnostic, index) => <button key={`${diagnostic.code}-${index}`} className={`sim-diagnostic-row ${diagnostic.severity}`} onClick={() => focusDiagnostic(diagnostic)}><b>定位</b><span>{diagnostic.message}</span><ChevronRight size={14} /></button>)}</> : <p className="sim-empty">{busy === "assess" ? "正在按课程顺序检查合闸、启停和保护动作…" : "点击「检查接线」，系统会在副本中执行课程动作，保留当前画布。"}</p>}</>}
          {panelTab === "workmanship" && <>{workmanship ? workmanship.status === "unsupported" ? <p className="sim-empty">本课程不作十课端子排工艺判定。</p> : <><div className={`sim-assessment-status sim-workmanship-status ${workmanship.status}`}><b>{workmanship.status === "passed" ? "端子接线工艺通过" : "端子接线工艺待完善"}</b><span>工艺结果独立于电气课程判定</span></div><ul className="sim-check-list">{workmanship.checks.map(check => <li key={check.id} className={check.passed ? "passed" : "failed"}><span>{check.passed ? "通过" : "未通过"}</span>{check.label}</li>)}</ul>{workmanship.diagnostics.map((diagnostic,index) => <button key={`${diagnostic.code}-${index}`} className={`sim-diagnostic-row ${diagnostic.severity}`} onClick={() => focusDiagnostic(diagnostic)}><b>定位</b><span>{diagnostic.message}</span><ChevronRight size={14}/></button>)}</> : <p className="sim-empty">点击「检查接线」，核对端子中转、PE 与线色一致性。</p>}</>}
        </div></section>}
        {message && <div className="sim-toast" role="status">{message}<button aria-label="关闭提示" onClick={() => setMessage("")}><X size={14} /></button></div>}
        {shortAlert && <ShortCircuitAlert diagnostic={shortAlert} onClose={() => setDismissedShort(shortKey)} onLocate={() => { setDismissedShort(shortKey); setPanelOpen(true); setPanelTab("safety"); focusDiagnostic(shortAlert); }} />}
      </div>
      <footer className="sim-editor-footer"><span role="status"><i className={running ? "live" : ""} />{pendingComponent ? `接线起点：${pendingComponent.label} · ${pendingTerminalLabel}，请点击另一端子；Esc 或空白处取消` : selectedWires.length ? `已选中 ${selectedWires.length} 根导线 · ${traceMode === "net" ? `巡线节点包含 ${tracedWireIds.length} 根线` : "蓝色流动用于巡线"}，带电看端子红点` : running ? "运行中 · 接线编辑已锁定" : displayedWireStyle === "duct" ? "拖动接线 / 依次点击两个端子 · 导线自动沿连通线槽走线" : "拖动接线 / 依次点击两个端子 · 选中直角导线双击添加折点"}</span><span>{circuit.components.length} 个元件<span className="sim-footer-divider">·</span>{circuit.wires.length} 根导线<button aria-label="查看运行和诊断" onClick={() => { setPanelOpen(!panelOpen); setPanelTab(running ? "runtime" : "safety"); if (!panelOpen) setTimeout(frameInitialView, 80); }}><PanelRightClose size={15} /></button></span></footer>
    </section>
    <input ref={drawingInput} type="file" accept="image/png,image/jpeg,image/webp" className="sim-hidden-input" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file || frozen) return; const uploadEpoch = ++drawingSelectionEpoch.current, uploadDocument = docRef.current, uploadGeneration = session.generation; const stillCurrent = () => uploadEpoch === drawingSelectionEpoch.current && uploadDocument === docRef.current && uploadGeneration === session.generation; await perform("drawing", async () => { if (file.size > 10 * 1024 * 1024) throw new Error("图纸图片不能超过 10 MB。"); if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("支持 PNG、JPEG 和 WebP 图片。"); if (onImportDrawing) { const uploaded = await onImportDrawing(file); if (!stillCurrent()) throw new Error("上传期间已切换图纸或编辑电路，当前接线保持不变，请重新上传。"); setDrawing(uploaded.url); changed({ ...docRef.current, referenceDiagramId: undefined, drawingMediaId: uploaded.id, drawingMediaType: file.type as "image/png" | "image/jpeg" | "image/webp", trainingProjectId: undefined, projectDrawings: undefined, drawingKind: undefined }); } else { const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file); }); if (!stillCurrent()) return; setDrawing(dataUrl); setMessage("已打开本地图纸预览；登录后上传可随草稿保存。"); } }); }} />
  </div>;
}

export default function SimulatorEditor(props: SimulatorEditorProps) {
  return <ReactFlowProvider><Workspace {...props} /></ReactFlowProvider>;
}
