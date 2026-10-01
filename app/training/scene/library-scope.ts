export type LibraryScopeEntry = {
  id: string;
  name: string;
  description: string;
  assetIds?: string[];
  status?: "pending" | "board" | "interface";
};

// A requested category is not a calibrated asset. Pending entries deliberately
// contain no asset ID and cannot reach the scene's add/drag handlers.
export const libraryScope: LibraryScopeEntry[] = [
  { id: "supply", name: "交流电源 L1 L2 L3 N PE", description: "现有 DOL 通过 X1 三相入口供电；五线电源端子待标定。", status: "pending" },
  { id: "qf", name: "断路器 QF（3P）", description: "三极断路器", assetIds: ["chint.nxb-63-3p"] },
  { id: "fu", name: "熔断器 FU", description: "RT28 候选；底座极数、熔断体电流及端子待标定。", status: "pending" },
  { id: "km", name: "交流接触器 KM（380V）", description: "保留配套热过载继电器 FR，完成 DOL 保护链路。", assetIds: ["chint.nc1-0910-nre8-25"] },
  { id: "kt", name: "时间继电器 KT（380V）", description: "NTE8 候选；延时模式、范围及端子待标定。", status: "pending" },
  { id: "sq", name: "行程开关 SQ", description: "YBLX-ME 候选；触头机构及端子待标定。", status: "pending" },
  { id: "motor", name: "三相异步电动机", description: "当前使用 M1 外部电机接口及运行反馈；完整电机模型待标定。", status: "interface" },
  { id: "sb", name: "复合按钮 SB", description: "复合触点型号待标定；下列独立启停按钮供当前 DOL 开发预览。", status: "pending", assetIds: ["chint.np2-ba31", "chint.np2-ba42"] },
  { id: "xt", name: "端子排 XT", description: "三相端子与专用 PE 端子分开添加。", assetIds: ["chint.jcuk-5n-3p-row", "chint.jcuk-5jd"] },
  { id: "duct", name: "线槽", description: "接线板已配置三维线槽，可整理导线、切换线槽盖。", status: "board" },
];
