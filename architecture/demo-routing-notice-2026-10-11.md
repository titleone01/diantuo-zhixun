# 示范接线的自动走线提示修复

2026-10-11 16:05:14北京时间最新交付：用户已授权上线并追加浅色线槽，两项均已在原固定入口发布。正式源码使用现网 `a3b16f6` 基线，而非尚未合并现网新功能的主目录。最终记录见 `C:/Users/admin/.codex/worktrees/demo-routing-color-20261011/电拓智训/architecture/demo-routing-light-production-2026-10-11.md`。下面的主目录验收与“未激活”描述保留为早期阶段证据。

用户反馈：使用系统示范接线时仍出现“42 根导线需要整理 / 请加宽线槽”，要求提前整理或取消该提示。本次采用取消显示密度提醒的方案。

## 原因和行为

十课示范的所有导线均可生成完整自动路径。第10课的42根、第09课的46根，以及04–06课各20根提示，来自线槽内显示间距低于建议值的 `capacityWarning`，并非寻路失败。既有路由器已经根据线槽宽度压缩平行分道。

`SimulatorEditor.tsx` 的画布提示现在仅统计路由状态为 `missing`、`blocked` 或 `disconnected` 的导线。成功走线的显示密度不再提示用户加宽或手动整理。路由计算、线槽尺寸、电气端子关系和安全诊断继续沿用原实现。

## 本次验证

- `npm run typecheck`、`npm run lint`、`npm run build`、`npm run build:pages`：通过。
- 三组相关走线测试：62通过，0失败。
- 全量 Node 测试首次默认并发：689通过、1失败、1条件跳过。失败为现有 `tunnel-network.test.mjs` 的50毫秒 DNS 回退用例；单文件复核10/10通过。
- 全量 Node 测试以 `--test-concurrency=1` 复核：690通过、0失败、1条件跳过。未调整网络实现或其测试。
- `npm run test:backend`：临时 Worker/D1/R2 中25/25通过。
- `npm run test:browser -- --grep 'ten blank courses|three automatic wires|real terminal drag'`：Chromium 单 worker，4/4通过。十课示范逐课载入、全部路由成功且无提示；缺槽与断槽提示；端子拖线、器件和电机移动、缩放、保存重载及世界端点一致均通过。

浏览器为本次隔离账号和数据库；没有将上述证据扩大为十课所有人工动作或生产浏览器验收。结果存于 `.local/demo-routing-checkpoint-20261011-154105/`，原文件及哈希可用于恢复。

## 现有 lint 警告

本次0错误、11条现有警告，未关闭规则：

- 图片规则：`CourseLibrary.tsx:22`、`DrawingViewer.tsx:96`、`LessonSchematic.tsx:7`、`ReferenceDrawingPicker.tsx:79`、`DeviceArtwork.tsx:25,28,30`、`app/training/ProjectPanel.tsx:97`。
- 媒体字幕：`reference-video/ReferenceVideoPlayer.tsx:30`。
- 遗留导航：`app/training/TrainingCanvas.tsx:23`、`app/training/workspace-api.ts:12`。

## 运行边界

本次完成源代码及本地构建验收，未激活生产发布。验证后3000端口仍为loopback、PID9020，会话接口HTTP200，发布ID仍为 `9e984547ede11825a26248b30e5f98e2be223d2d66cbd3acd5373e92b3c0aee6`。正式切换须按项目约束取得授权并执行备份及发布流程。
