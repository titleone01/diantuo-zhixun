export type Vec3 = [number, number, number];
export type WireKind = "main" | "control" | "earth";

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
  category: "terminal-block" | "circuit-breaker" | "contactor";
  referencePrefix: "XT" | "QF" | "KM";
  mounting: { type: "din-rail"; rail: "35mm" };
  geometry:
    | {
        kind: "gltf";
        path: string;
        modelScale: number;
        sourceUnit: string;
        sourceFormat: string;
        coverPolicy?: string;
      }
    | { kind: "procedural"; shape: "breaker-3p" | "contactor" };
  footprint: { width: number; depth: number; height: number };
  properties: Record<string, string | number | boolean>;
  terminals: ComponentTerminal[];
};

export type DeviceInstance = {
  id: string;
  assetId: string;
  reference: string;
  position: Vec3;
  rotationY: number;
};

export type SceneWire = {
  id: string;
  from: string;
  to: string;
  kind: WireKind;
};

export const terminalId = (instanceId: string, terminalKey: string) => `${instanceId}::${terminalKey}`;

