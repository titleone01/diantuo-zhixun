import { CATALOG, DUCT_MAX_SIZE, DUCT_MIN_SIZE, isWireDuct } from "./catalog";
import { getReferenceDrawing } from "./reference-drawings";
import type { CircuitDocument } from "./types";

export type DocumentValidation = { valid: boolean; errors: string[]; document?: CircuitDocument };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;
const point = (value: unknown) => record(value) && typeof value.x === "number" && Number.isFinite(value.x) && Math.abs(value.x) <= 1_000_000 && typeof value.y === "number" && Number.isFinite(value.y) && Math.abs(value.y) <= 1_000_000;
const mediaType = (value: unknown) => typeof value === "string" && ["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(value);

/** Shared, non-mutating boundary for imports, persistence and server assessment. */
export function validateDocument(input: unknown): DocumentValidation {
  const errors: string[] = [];
  if (!record(input)) return { valid: false, errors: ["电路文件必须是 JSON 对象"] };
  if (input.schemaVersion !== 1) errors.push("不支持的电路文件版本");
  if (!text(input.title, 160)) errors.push("电路标题须为 1–160 个字符");
  if (input.lessonId !== undefined && !safeId(input.lessonId)) errors.push("课程标识无效");
  if (input.referenceDiagramId !== undefined) {
    if (typeof input.referenceDiagramId !== "number" || !Number.isInteger(input.referenceDiagramId) || !getReferenceDrawing(input.referenceDiagramId)) errors.push("参考图纸标识不在已确认目录中");
    if (["drawingMediaId", "drawingMediaType", "drawingKind", "projectDrawings", "trainingProjectId"].some(key => input[key] !== undefined)) errors.push("参考图纸不能与私有附件或训练项目图纸混用");
  }
  if (input.drawingMediaId !== undefined && !safeId(input.drawingMediaId)) errors.push("图纸文件标识无效");
  if (input.drawingMediaType !== undefined && !mediaType(input.drawingMediaType)) errors.push("图纸文件类型无效");
  if (input.drawingKind !== undefined && input.drawingKind !== "schematic" && input.drawingKind !== "layout") errors.push("图纸种类无效");
  if (input.projectDrawings !== undefined) {
    if (!record(input.projectDrawings)) errors.push("项目图纸快照无效");
    else for (const [kind, attachment] of Object.entries(input.projectDrawings)) {
      if (kind !== "schematic" && kind !== "layout") errors.push("项目图纸快照包含未知种类");
      if (!record(attachment) || !safeId(attachment.mediaId) || !mediaType(attachment.type) || Object.keys(attachment).some(key => key !== "mediaId" && key !== "type")) errors.push(`项目图纸 ${kind.slice(0, 30)} 的附件无效`);
    }
  }
  if (input.trainingProjectId !== undefined && !safeId(input.trainingProjectId)) errors.push("训练项目标识无效");
  if (!Array.isArray(input.components) || input.components.length > 200) return { valid: false, errors: [...errors, "元件列表无效或超过 200 个"] };
  if (!Array.isArray(input.wires) || input.wires.length > 1000) return { valid: false, errors: [...errors, "导线列表无效或超过 1000 根"] };
  const ports = new Map<string, Set<string>>();
  for (const [index, component] of input.components.entries()) {
    if (!record(component) || !safeId(component.id)) { errors.push(`第 ${index + 1} 个元件标识无效`); continue; }
    if (ports.has(component.id)) errors.push(`元件标识重复：${component.id}`);
    // Invalid JSON fields may shadow toString/valueOf. Do not coerce untrusted
    // objects while constructing a validation error or checking a type.
    const type = typeof component.type === "string" ? component.type : undefined;
    const definition = CATALOG.find((entry) => entry.type === type);
    if (!definition) errors.push(`未知元件类型：${type?.slice(0, 80) ?? "类型必须为字符串"}`);
    if (!text(component.label, 80)) errors.push(`元件 ${component.id} 的名称无效`);
    if (!point(component.position)) errors.push(`元件 ${component.id} 的世界坐标无效`);
    if (component.size !== undefined && (type === undefined || !isWireDuct(type) || !record(component.size) || Object.keys(component.size).some(key => key !== "width" && key !== "height") || ![component.size.width, component.size.height].every(value => typeof value === "number" && Number.isFinite(value) && value >= DUCT_MIN_SIZE && value <= DUCT_MAX_SIZE))) errors.push(`元件 ${component.id} 的线槽长宽须为 ${DUCT_MIN_SIZE} 至 ${DUCT_MAX_SIZE} 个世界单位`);
    if (component.linkedTo !== undefined && (component.type !== "auxiliary-no" || !safeId(component.linkedTo))) errors.push(`元件 ${component.id} 的辅助触点机械绑定无效`);
    if (component.settings !== undefined && (component.type !== "timer380" || !record(component.settings) || Object.keys(component.settings).some(key => key !== "delayMs") || typeof component.settings.delayMs !== "number" || !Number.isFinite(component.settings.delayMs) || component.settings.delayMs < 1 || component.settings.delayMs > 3_600_000)) errors.push(`元件 ${component.id} 的延时设置须为 1 至 3600000 毫秒`);
    ports.set(component.id, new Set(definition?.terminals.map((terminal) => terminal.id) ?? []));
  }
  for (const component of input.components) {
    if (!record(component) || !safeId(component.id) || component.type !== "auxiliary-no" || component.linkedTo === undefined) continue;
    const owner = input.components.find(candidate => record(candidate) && candidate.id === component.linkedTo);
    if (!record(owner) || typeof owner.type !== "string" || !["contactor220", "contactor380", "relay380"].includes(owner.type)) errors.push(`辅助触点 ${component.id} 必须绑定有效的接触器或中间继电器`);
  }
  const wireIds = new Set<string>();
  const connected = new Set<string>();
  for (const [index, wire] of input.wires.entries()) {
    if (!record(wire) || !safeId(wire.id)) { errors.push(`第 ${index + 1} 根导线标识无效`); continue; }
    if (wireIds.has(wire.id)) errors.push(`导线标识重复：${wire.id}`);
    wireIds.add(wire.id);
    const endpoints: string[] = [];
    for (const name of ["from", "to"] as const) {
      const ref = wire[name];
      if (!record(ref) || !safeId(ref.componentId) || !safeId(ref.terminalId) || !ports.get(ref.componentId)?.has(ref.terminalId)) errors.push(`导线 ${wire.id} 的 ${name} 端子不存在`);
      else endpoints.push(`${ref.componentId}::${ref.terminalId}`);
    }
    if (endpoints.length === 2) {
      if (endpoints[0] === endpoints[1]) errors.push(`导线 ${wire.id} 不能连接端子自身`);
      const key = endpoints.sort().join("|");
      if (connected.has(key)) errors.push(`导线 ${wire.id} 与已有连接重复`);
      connected.add(key);
    }
    if (typeof wire.color !== "string" || !/^#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?$/i.test(wire.color)) errors.push(`导线 ${wire.id} 颜色须为十六进制颜色`);
    if (wire.style !== undefined && wire.style !== "duct" && wire.style !== "orthogonal" && wire.style !== "straight" && wire.style !== "curve") errors.push(`导线 ${wire.id} 样式无效`);
    if (wire.routing !== undefined && wire.routing !== "duct") errors.push(`导线 ${wire.id} 自动走线模式无效`);
    if (wire.waypoints !== undefined && (!Array.isArray(wire.waypoints) || wire.waypoints.length > 256 || !wire.waypoints.every(point))) errors.push(`导线 ${wire.id} 折点无效`);
  }
  if (input.roles !== undefined) {
    if (!record(input.roles)) errors.push("课程角色绑定无效");
    else for (const [role, componentId] of Object.entries(input.roles)) {
      if (!safeId(role) || !safeId(componentId) || !ports.has(componentId)) errors.push(`课程角色 ${role.slice(0, 80)} 指向无效元件`);
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true, errors: [], document: input as CircuitDocument };
}
