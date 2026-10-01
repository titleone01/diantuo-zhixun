export type Vec3 = [number, number, number];
export type WireKind = "main" | "control" | "earth";
export type WireStyle = "straight" | "curve";
export type BreakerState = "open" | "closed";
export type OperatingState = BreakerState | "idle" | "start-pressed" | "stop-pressed" | "engaged" | "tripped";

export type ComponentTerminal = {
  key: string;
  label: string;
  position: Vec3;
  exitDirection: Vec3;
  sourcePosition3d?: Vec3;
  internalGroup?: string;
};

export type ComponentAsset = {
  schemaVersion: 1;
  assetId: string;
  manufacturer: string;
  name: string;
  model: string;
  category: "terminal-block" | "circuit-breaker" | "motor-starter" | "pushbutton-station";
  referencePrefix: "X" | "QF" | "KM" | "SB" | "PE";
  mounting:
    | { type: "din-rail"; rail: "35mm" }
    | { type: "panel-screw"; holePatternMm?: Vec3 };
  geometry:
    | {
        kind: "gltf";
        path: string;
        modelScale: number | Vec3;
        modelPosition?: Vec3;
        modelRotation?: Vec3;
        materialProfile?: "chint-nxb" | "chint-white" | "chint-terminal" | "chint-pe" | "chint-np2-green" | "chint-np2-red";
        sourceUnit: string;
        sourceFormat: string;
        coverPolicy?: string;
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
      }
    | {
        kind: "composite-gltf";
        parts: Array<{
          path: string;
          modelScale: number | Vec3;
          modelPosition?: Vec3;
          modelRotation?: Vec3;
          materialProfile?: "chint-white" | "chint-terminal" | "chint-pe";
        }>;
        sourceUnit: string;
        sourceFormat: string;
      }
    | {
        kind: "gltf-array";
        path: string;
        count: number;
        spacing: Vec3;
        modelScale: number | Vec3;
        modelPosition?: Vec3;
        modelRotation?: Vec3;
        materialProfile?: "chint-terminal" | "chint-pe";
        sourceUnit: string;
        sourceFormat: string;
      };
  footprint: { width: number; depth: number; height: number };
  properties: Record<string, string | number | boolean>;
  electrical?: {
    coil: { pair: [string, string]; ratedVoltageV: number };
    mainContacts: [string, string][];
    auxiliaryNO: [string, string][];
    overload: {
      ncPair: [string, string];
      noPair: [string, string];
      resetMode: "manual-or-automatic";
      evidence: { sourceUrl: string; figures: string; behavior: string };
    };
  };
  interaction?:
    | {
        kind: "breaker-toggle";
        defaultState: BreakerState;
        contactPairs: [string, string][];
      }
    | {
        kind: "momentary-pushbutton";
        defaultState: "idle";
        action: "start" | "stop";
        contactType: "NO" | "NC";
        contactPair: [string, string];
      };
  terminals: ComponentTerminal[];
};

export type DeviceInstance = {
  id: string;
  assetId: string;
  reference: string;
  position: Vec3;
  rotationY: number;
  operatingState?: OperatingState;
};

export type SceneWire = {
  id: string;
  from: string;
  to: string;
  kind: WireKind;
  /** Display only: electrical connectivity is always determined by from/to. */
  color?: string;
  style?: WireStyle;
};

export const terminalId = (instanceId: string, terminalKey: string) => `${instanceId}::${terminalKey}`;
