# 电拓智训项目协作约束

修改本项目之前，必须先阅读 `architecture/3d-wiring.md`。

`docs/` 是 GitHub Pages 的生成目录，`npm run build:pages` 会重建它。长期文档、源代码和人工维护的文件禁止放入 `docs/`。

## 当前产品范围

- 当前只建设“器件库 → 放置到接线板 → 螺丝端子接线 → 线槽自动整理”的最小闭环。
- 上电、评分和电路仿真暂不显示在界面中；`app/circuit-analysis.ts` 继续作为独立拓扑安全模块保留。
- 当前基础器件是端子排、断路器、交流接触器。不要未经需求确认重新加入电动机、按钮、熔断器等复杂界面。

## 不可破坏的架构规则

1. 接线板只有一个 React Three Fiber `Canvas`。器件、端子、导线、导轨和线槽必须处于同一三维世界坐标。
2. 不要重新使用“每个器件一个 WebGL Canvas + React Flow/SVG 导线”的方案，也不要用图片卡片代替已经存在的真实 GLB。
3. 器件资产定义与场景实例必须分离：资产放在 `app/training/component-library/`，实例和导线只保存在 Zustand 场景状态中。
4. 导线端点只能由 `器件实例变换 × 端子局部三维坐标` 得出；禁止保存屏幕百分比、DOM 像素或手调 SVG 坐标作为电气端点。
5. 端子排保持无盖，器件固定/吸附到 35 mm DIN 导轨；默认相机保持俯视，不提供脱离接线板的任意 360° 旋转。
6. 新器件必须提供端子 ID、局部三维坐标、出线方向、电气属性和安装方式。没有这些信息的模型只能进入“待标定”，不能用于正式接线。
7. 保留原始 STEP 文件；Web 端使用经过清理和优化的 GLB。不要覆盖 `E:\电气模型库` 中的原始下载文件。

## 入口与验证

- 统一三维场景：`app/training/scene/WiringScene.tsx`
- 器件目录：`app/training/scene/catalog.ts`
- 器件资产 JSON：`app/training/component-library/`
- 三维自动布线：`app/training/scene/routing.ts` 与 `app/training/scene/Wire3D.tsx`
- 状态：`app/training/scene/store.ts`

提交前至少运行：

```powershell
npm run typecheck
node --test tests/*.test.mjs
npm run build
npm run build:pages
```

浏览器验收必须实际完成一次“从一个螺丝拖到另一个螺丝”，并验证导线状态中的两个世界坐标与对应端子坐标完全一致。若用户要求打开测试页，要将 `http://localhost:3000/` 可见地留在浏览器中。
