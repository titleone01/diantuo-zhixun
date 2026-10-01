import jcuk5jd from "../component-library/chint/jcuk-5jd.json";
import jcuk5nRow from "../component-library/chint/jcuk-5n-3p-row.json";
import nc10910 from "../component-library/chint/nc1-0910.json";
import np2ba31 from "../component-library/chint/np2-ba31.json";
import np2ba42 from "../component-library/chint/np2-ba42.json";
import nxb63 from "../component-library/chint/nxb-63.json";
import type { ComponentAsset, ComponentTerminal, DeviceInstance, Vec3 } from "./types";

const assets = [jcuk5nRow, jcuk5jd, nxb63, nc10910, np2ba31, np2ba42] as unknown as ComponentAsset[];

export const componentCatalog = new Map(assets.map((asset) => [asset.assetId, asset]));
export const componentLibrary = assets;

export const getAsset = (assetId: string) => {
  const asset = componentCatalog.get(assetId);
  if (!asset) throw new Error(`未知器件资产: ${assetId}`);
  return asset;
};

export const getTerminal = (instance: DeviceInstance, terminalKey: string): ComponentTerminal => {
  const terminal = getAsset(instance.assetId).terminals.find((item) => item.key === terminalKey);
  if (!terminal) throw new Error(`${instance.reference} 不存在端子 ${terminalKey}`);
  return terminal;
};

const rotateOnBoard = (vector: Vec3, rotationY: number): Vec3 => {
  const cosine = Math.cos(rotationY);
  const sine = Math.sin(rotationY);
  return [
    vector[0] * cosine + vector[2] * sine,
    vector[1],
    -vector[0] * sine + vector[2] * cosine,
  ];
};

export const worldTerminalPosition = (instance: DeviceInstance, terminal: ComponentTerminal): Vec3 => {
  const local = rotateOnBoard(terminal.position, instance.rotationY);
  return [
    instance.position[0] + local[0],
    instance.position[1] + local[1],
    instance.position[2] + local[2],
  ];
};

export const terminalExitPosition = (instance: DeviceInstance, terminal: ComponentTerminal): Vec3 => {
  const world = worldTerminalPosition(instance, terminal);
  const direction = rotateOnBoard(terminal.exitDirection, instance.rotationY);
  const lead = 0.46;
  return [
    world[0] + direction[0] * lead,
    0.72,
    world[2] + direction[2] * lead,
  ];
};

export const parseTerminalId = (id: string) => {
  const separator = id.indexOf("::");
  if (separator < 1) throw new Error(`无效端子标识: ${id}`);
  return { instanceId: id.slice(0, separator), terminalKey: id.slice(separator + 2) };
};

export const resolveTerminal = (instances: DeviceInstance[], id: string) => {
  const { instanceId, terminalKey } = parseTerminalId(id);
  const instance = instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error(`找不到器件实例: ${instanceId}`);
  const terminal = getTerminal(instance, terminalKey);
  return {
    instance,
    terminal,
    electricalId: `${instance.reference}-${terminal.key}`,
    world: worldTerminalPosition(instance, terminal),
    exit: terminalExitPosition(instance, terminal),
  };
};

export const initialDeviceInstances: DeviceInstance[] = [
  { id: "instance-x1", assetId: "chint.jcuk-5n-3p-row", reference: "X1", position: [-8, 0.2, -12.25], rotationY: 0 },
  { id: "instance-qf1", assetId: "chint.nxb-63-3p", reference: "QF1", position: [-3, 0.2, -12.25], rotationY: 0, operatingState: "open" },
  { id: "instance-km1", assetId: "chint.nc1-0910-nre8-25", reference: "KM1", position: [0, 0.2, -4], rotationY: 0 },
  { id: "instance-x2", assetId: "chint.jcuk-5n-3p-row", reference: "X2", position: [-5, 0.2, 4], rotationY: 0 },
  { id: "instance-pe1", assetId: "chint.jcuk-5jd", reference: "PE1", position: [-3, 0.2, 4], rotationY: 0 },
  { id: "instance-sb1", assetId: "chint.np2-ba42", reference: "SB1", position: [6, 0.2, 4], rotationY: 0, operatingState: "idle" },
  { id: "instance-sb2", assetId: "chint.np2-ba31", reference: "SB2", position: [9, 0.2, 4], rotationY: 0, operatingState: "idle" }
];
