import { CATALOG } from "../core/catalog";
import type { ComponentType } from "../core/types";

// Match the reference pool order without registering unmodelled electrical devices.
const household: ComponentType[] = ["switch1", "switch2", "lamp", "breaker1", "breaker3"];
const industrial: ComponentType[] = ["breaker1", "breaker3", "fuse", "fuse3", "push-nc", "push-latching-red", "push-no", "push-latching-green", "limit-switch", "knife-switch3", "contactor220", "contactor380", "motor", "motor-star-delta", "overload", "relay380", "timer380", "motor-dahlander"];
const helpers: ComponentType[] = ["supply", "terminal", "pe-terminal", "auxiliary-no", "wire-duct", "wire-duct-vertical"];
export const poolLabel: Partial<Record<ComponentType, string>> = {
  switch1: "单开单控", switch2: "单开双控", lamp: "灯泡（220V）", breaker1: "空气开关（1P）", breaker3: "空气开关（3P）", fuse: "熔断器（FU）",
  fuse3: "三联熔断器（FU）", "knife-switch3": "刀开关（QS）",
  "push-nc": "复合复位（SB）\n（红色）", "push-no": "复合复位（SB）\n（绿色）", "push-latching-red": "自锁开关（SB）\n（红色）", "push-latching-green": "自锁开关（SB）\n（绿色）", "limit-switch": "限位开关（复合）",
  contactor220: "交流接触器（KM）\n（220V）", contactor380: "交流接触器（KM）\n（380V）",
  motor: "三相异步电动机\n（380V）", "motor-star-delta": "六端子电机\n（Y / Δ）", "motor-dahlander": "双速电机\n（Δ / YY 教学）",
  overload: "热继电器（FR）", relay380: "中间继电器（KA）\n（380V 教学）", timer380: "时间继电器（KT）\n（380V 教学）",
};
export function poolGroups(category: "all" | "industrial" | "lighting", search: string) {
  const definitions = new Map(CATALOG.map(item => [item.type, item]));
  const groups = [
    { id: "lighting", title: "家庭电路组件", types: category === "industrial" ? [] : household },
    { id: "industrial", title: "工业电路组件", types: category === "lighting" ? [] : industrial },
    { id: "helpers", title: "接线辅助", types: helpers },
  ];
  return groups.map(group => ({ ...group, items: group.types.flatMap(type => {
    const item = definitions.get(type);
    return item && `${item.name}${item.description}${poolLabel[type] ?? ""}`.includes(search.trim()) ? [item] : [];
  }) })).filter(group => group.items.length);
}
