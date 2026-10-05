# 线槽入口折返修复（2026-10-05）

用户截图中的顶部、底部横槽出现入槽后折返，视觉上像打结。原因是稳定导线偏移后的槽内路径与端子引线拼接时保留了中心线锚点：先走到中心，再退回同一直线上的偏移转弯点。

`core/duct-routing.ts` 在完成路径拼接后统一简化同轴段，消除重复路程；两端世界端点和独立校验的槽内 trunk 保留。不会修改文档、端子引用、线色、课程电气拓扑或用户手工折点。两条外部引线共用一个零长度槽内点时，消除往返该点的支线。测试按线段与线槽矩形的交集核验入口，不依赖冗余中心线顶点。

## 本次验证

- 十个电机课程全部示范导线 × 九种稳定偏移：无同轴折返、无自身垂直交叉，槽内段覆盖、端点、JSON 重载一致；路由不写回文档。
- 定向路由回归：33/33。
- typecheck、build、build:pages 通过。
- lint：0 错误、11 条既有警告。CourseLibrary:20、DrawingViewer:95、LessonSchematic:7、ReferenceDrawingPicker:79、ReferenceDrawings:19、DeviceArtwork:24/28、ProjectPanel:97 为图片规则；ReferenceVideoPlayer:30 为字幕；TrainingCanvas:23、workspace-api:12 为历史导航规则。未关闭规则。
- Pages 构建后的完整回归：568 项，567 通过、0 失败、1 后台环境条件跳过。
- 独立临时 Worker/D1/R2 后台：25/25，通过十课服务端判定、双成员权限及附件契约。
- Chromium 单 worker 定向四项全部通过：真实端子拖线、元件移动/缩放/保存重载后的世界端点；双账号草稿隔离；自动槽路线真实拖动、断槽/撤销、尺寸/保存重载；连续运行课所有 SVG 入槽路径无折返。
- 脱敏浏览器结果及画布截图：隔离工作树 `.local/acceptance-public/browser.json`、`duct-entry-fixed.png`。

## 交付边界

原工作目录开始时 Git 干净，基线 `a49a2498bb744c7327aea0902c0d3598bc35e0d0`。修改在附加隔离工作树进行，备份 bundle 位于 `E:/vibecoding/电拓智训备份/duct-entry-20261005/before.bundle`，已 verify。

当前正式站由 `.wrangler/active-release.json` 指向锁定发布包，端口 3000 原监听 PID 为 31152。因此源码修改和隔离通过不代表正式页面已更新。新包准备后，正式停写、完整 state/WAL/私有配置备份、兼容核验、激活及重启按 `releases-and-recovery.md` 执行；没有修改现网账号、图纸、草稿或数据库，没有远程部署或另建公网入口。

本次未执行十课全部浏览器运行、生产切换、生产备份恢复或长期容量验收。不能用四项定向浏览器结果替代这些门禁。

## 并行计时器改动整合

交付前发现原工作目录由另一个聊天推进到 `codex/timer-controls-layout` / `d2528b0`，且该聊天正在执行用户授权的正式更新。本轮拒绝覆盖或变更其工作目录，正式服务仍由该聊天负责。

在隔离分支 `codex/duct-entry-fix-20261005` 合入 `d2528b0`，重新构建 Pages，并重跑 typecheck、lint、build、全回归、隔离后台，结果仍为 567 通过/1 条件跳过、后台 25/25、lint 0 错误/11 警告。Chromium 增加计时器紧凑布局验收后共五项全部通过。

单项修复提交为 `ace4282`；先前单项发布包 `C:/Users/admin/diantuo-production/20261005-duct-entry-fix/release` 不包含并行计时器改动。应交付合并后新包 `C:/Users/admin/diantuo-production/20261005-duct-entry-fix-combined/release`，不要直接激活旧包覆盖计时器更新。两个版本均不含生产数据或秘密。

## 正式统一发布补充

用户随后授权“把两项修复统一上线”。2026-10-05 17:57 由「优化设置时间区域遮挡」聊天统一发布，源码和原发布记录已合并；合并包 ID 为 `ad1e338ca2999f55d805a0c548a82ed5e153a338caa90c9891616eb3a23e5ef8`。主目录再次完成完整检查及上述五项浏览器验证。最新业务库停写备份、独立恢复核验、兼容检查后激活同一业务状态，公网与本机资源哈希一致，原业务记录及 66 份附件均保留。此处补充正式切换证据，不扩大为十课全部正式账号浏览器运行或长期容量验收。详细路径及脱敏结果见 [正式发布记录](production-release-2026-10-05.md) 的最新章节。
