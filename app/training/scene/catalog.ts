import tb1506 from "../component-library/chint/tb-1506.json";
import nxb125 from "../component-library/chint/nxb-125.json";
import nc10910 from "../component-library/chint/nc1-0910.json";
import type { ComponentAsset, ComponentTerminal, DeviceInstance, Vec3 } from "./types";

const assets = [tb1506, nxb125, nc10910] as unknown as ComponentAsset[];

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

export const worldTerminalPosition = (instance: DeviceInstance, terminal: ComponentTerminal): Vec3 => [
  instance.position[0] + terminal.position[0],
  instance.position[1] + terminal.position[1],
  instance.position[2] + terminal.position[2],
];

export const terminalExitPosition = (instance: DeviceInstance, terminal: ComponentTerminal): Vec3 => {
  const world = worldTerminalPosition(instance, terminal);
  const lead = 0.46;
  return [
    world[0] + terminal.exitDirection[0] * lead,
    0.72,
    world[2] + terminal.exitDirection[2] * lead,
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
  { id: "instance-qf1", assetId: "chint.nxb-125-3p", reference: "QF1", position: [-2.5, 0.35, -4.7], rotationY: 0 },
  { id: "instance-km1", assetId: "chint.nc1-0910", reference: "KM1", position: [-1.7, 0.35, -1.55], rotationY: 0 },
  { id: "instance-xt1", assetId: "chint.tb-1506", reference: "XT1", position: [0, 0.75, 4.7], rotationY: 0 }
];
