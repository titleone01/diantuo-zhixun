import type { ComponentRuntime } from "../core/types";

const LABELS: Record<string, string> = {
  on: "电源接通", off: "电源断开", fault: "故障中止", engaged: "已吸合", released: "已释放",
  lit: "亮", dark: "灭", running: "运行", stopped: "停止", tripped: "已过载动作", ready: "保护就绪",
  pressed: "已按下", closed: "已合闸", open: "已分闸", connected: "已连接", "throw-1": "连接 L1", "throw-2": "连接 L2",
  timing: "延时中", done: "延时完成", unsupported: "暂不支持", star: "星形", delta: "三角形", "double-star": "双星形", low: "低速", high: "高速",
  forward: "正转", reverse: "反转",
};
export const runtimeLabel = (state?: string): string => LABELS[state ?? ""] ?? state ?? "未得电";
export const runtimeSummary = (result?: ComponentRuntime): string => [runtimeLabel(result?.state), ...[result?.direction, result?.connection, result?.speed].filter(value => !!value).map(runtimeLabel)].join(" · ");
