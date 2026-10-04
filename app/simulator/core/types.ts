export type Point = { x: number; y: number };
export type ComponentSize = { width: number; height: number };
export type DrawingKind = "schematic" | "layout";
export type DrawingMediaType = "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
export type DrawingAttachment = { mediaId: string; type: DrawingMediaType };
export type ComponentType = "supply" | "breaker3" | "breaker1" | "knife-switch3" | "fuse" | "fuse3" | "contactor220" | "contactor380" | "overload" | "push-no" | "push-nc" | "push-latching-red" | "push-latching-green" | "switch1" | "switch2" | "lamp" | "motor" | "terminal" | "pe-terminal" | "auxiliary-no" | "relay380" | "timer380" | "limit-switch" | "motor-star-delta" | "motor-dahlander" | "wire-duct" | "wire-duct-vertical";
export type TerminalRef = { componentId: string; terminalId: string };
export type CircuitComponent = { id: string; type: ComponentType; label: string; position: Point; size?: ComponentSize; linkedTo?: string; settings?: { delayMs: number } };
export type WireStyle = "duct" | "orthogonal" | "straight" | "curve";
export type CircuitWire = { id: string; from: TerminalRef; to: TerminalRef; color: string; waypoints?: Point[]; style?: WireStyle };
export type CircuitDocument = {
  schemaVersion: 1;
  title: string;
  lessonId?: string;
  components: CircuitComponent[];
  wires: CircuitWire[];
  roles?: Record<string, string>;
  /** Public catalog reference; never an assessment claim or a private media ID. */
  referenceDiagramId?: number;
  drawingMediaId?: string;
  drawingMediaType?: DrawingMediaType;
  projectDrawings?: Partial<Record<DrawingKind, DrawingAttachment>>;
  drawingKind?: DrawingKind;
  trainingProjectId?: string;
};
/** Every attachment belongs to the saved snapshot, including the inactive drawing tab. */
export function documentMediaIds(document: CircuitDocument): string[] {
  return [...new Set([document.drawingMediaId, document.projectDrawings?.schematic?.mediaId, document.projectDrawings?.layout?.mediaId].filter((id): id is string => !!id))];
}
export type Terminal = { id: string; label: string; x: number; y: number; side: "top" | "bottom" | "left" | "right"; electrical?: "phase" | "neutral" | "earth" | "contact" | "coil" | "load" };
export type ContactDefinition = { id: string; terminals: [string, string]; control: "switch" | "push" | "coil" | "overload" | "timer"; normallyClosed?: boolean; throw?: boolean };
export type ComponentDefinition = { type: ComponentType; name: string; category: "power" | "industrial" | "lighting" | "terminals"; width: number; height: number; terminals: Terminal[]; description: string; fixedConnections?: [string, string][]; contacts?: ContactDefinition[]; load?: { kind: "coil" | "lamp" | "motor"; terminals: string[]; ratedVoltage: 220 | 380; motorModel?: "three-lead" | "star-delta" | "dahlander" } };
export type Potential = "L1" | "L2" | "L3" | "N" | "PE" | "floating" | "conflict";
export type TimerRuntime = { energized: boolean; startedAt: number | null; elapsedMs: number; done: boolean };
export type Runtime = { powerOn: boolean; switches: Record<string, boolean>; pressed: Record<string, boolean>; overloads: Record<string, boolean>; contactors: Record<string, boolean>; faultLatched: boolean; latchedDiagnostics?: Diagnostic[]; timeMs?: number; timers?: Record<string, TimerRuntime> };
export type SimulationAction = { type: "power"; enabled: boolean } | { type: "toggle" | "press" | "release" | "trip-overload" | "reset-overload"; componentId: string } | { type: "reset-fault" } | { type: "advance-time"; ms: number };
export type Diagnostic = { code: string; severity: "error" | "warning" | "info"; message: string; componentIds: string[]; terminalIds: string[]; wireIds: string[]; event?: string; expected?: string; actual?: string; actionSequence?: SimulationAction[] };
export type ComponentRuntime = { active: boolean; state: string; voltage?: number; phases?: string[]; direction?: "forward" | "reverse"; connection?: "star" | "delta" | "double-star"; speed?: "low" | "high"; elapsedMs?: number; remainingMs?: number };
export type TerminalState = { netId: string; potential: Potential; energized: boolean };
export type SimulationResult = { runtime: Runtime; components: Record<string, ComponentRuntime>; terminals: Record<string, TerminalState>; diagnostics: Diagnostic[]; energizedWireIds: string[]; supported: boolean };
export type LessonCheck = { id: string; label: string; passed: boolean };
export type LessonTrace = { event: string; action?: SimulationAction; powerOn: boolean; faultLatched: boolean; components: Record<string, ComponentRuntime>; diagnosticCodes: string[] };
export type LessonAssessment = { status: "passed" | "incomplete" | "failed" | "unsupported"; passed: number; total: number; checks: LessonCheck[]; diagnostics: Diagnostic[]; trace?: LessonTrace[] };
export type LessonDefinition = { id: string; title: string; category: "industrial" | "lighting"; description: string; objective: string; componentTypes: ComponentType[] };
export const terminalKey = (ref: TerminalRef) => `${ref.componentId}::${ref.terminalId}`;
