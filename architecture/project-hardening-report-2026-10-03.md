# 项目优化报告：下一阶段加固

> 本文保留初始隔离副本的阶段记录。最终合并副本的结果、剩余风险和下一步以[2026-10-04最终验收报告](project-hardening-report-2026-10-04.md)为准；下文的中间测试计数不代表最终结果。

日期：2026-10-03。实施目录`E:\vibecoding\diantuo-hardening-7iSp2N`，基于全部既有成果的快照；与功能对话分工，原目录、业务库及Tunnel未由本对话修改。功能对话负责Git回退点与最终合并，基准提交`f173825458a2cdcb0890b5a3d335840f28cd4688`。本报告不把独立副本结果当作合并或上线结果。

## 1. 当前状态与合理设计

产品仍是邀请制二维实训整站：十个主要电机课程、四个基础课程、原站图纸/视频、成员私有草稿、不可变发布、私有附件与后台重算。纯电气引擎、运行/诊断/评分分离、稳定世界端点、revision/writeId、权限及三维历史成果保留。没有LLM业务链，不增加AI调用或Agent框架。

本轮把版本产物与state分离，建立完整恢复及代码回退工具、强制图纸版本、schema核对、CI与可重复Chromium/容量验收。正式库0006迁移、生产切换、公网验收未执行。双对话合并后的lint及最终构建由功能对话协调，仍须核实。

## 2. 问题、优先级与修复

| 优先级 | 实际问题 | 实施结果 |
|---|---|---|
| P0 | 活动SQLite单文件复制会遗漏WAL；旧备份覆盖新写入会丢进度 | 完整state+私有运行备份、复制前后哈希、空目录恢复、拒绝活写入；回退仅改代码指针 |
| P1 | 相同SQL迁移不代表旧版本能读取新增器件、端子或导线字段 | 发布包保留实际校验器和字段/器件契约；激活及启动前逐条核对草稿/作品，拒绝不兼容回退 |
| P1 | 修改开发源码可能热加载到运行Worker | 带哈希的独立UI/编译Worker版本包，显式start:release入口，运行state分开 |
| P1 | 相同媒体的并发标题修改、删除再重建可被旧请求覆盖 | 每槽opaque version、强制expectedVersion，428/409；API/UI/导入脚本同步，追加0006 |
| P1 | 隔离服务共用名称/注册表，旧no_bundle组合反复503 | 随机Worker/D1/R2及正确WRANGLER_REGISTRY_PATH；采用已验证的编译包配置 |
| P1/P2 | 新安全公告25项、18high | 兼容升级后14项、7high、7moderate；未强制升级/降级，逐条台账保留未修项 |
| P2 | Drizzle描述遗漏既有SQL索引，生成迁移来源混淆 | 补schema索引、候选隔离，14表/6迁移结构比对；不重写历史SQL |
| P2 | 外围同步effect重置、render ref、modal键盘/焦点问题 | keyed边界、提交后ref同步、请求键状态、共用Modal；共享编辑器由功能对话按差异处理 |
| P2 | 十课/恢复/容量缺少持续可复核入口 | check/check:extended、GitHub Actions、Chromium单worker、脱敏结果；远端CI待首次实际运行 |

## 3. 修改文件与目的

| 范围 | 主要文件 | 原因 |
|---|---|---|
| 发布恢复 | scripts/release-tools、start-release、isolated-fixture、test-recovery、backend-test-runner、build-local-app、prepare-pdf-assets、test-persistence | 产物隔离、完整恢复/回退、进程归属、附件/快照检查 |
| 图纸 | app/server/training-projects.ts、TrainingProjects.tsx、import-training-drawings、db/schema.ts、0006、后台与版本测试 | 严格CAS及遗留记录保留 |
| 外围界面 | Modal、DrawingViewer、PdfDrawing、ReferenceDrawingPicker、ReferenceDrawings、CourseLibrary、Gallery、ProfileLibrary、ChangePassword、ShortCircuitAlert、遗留ProjectPanel及相关CSS/测试 | 状态边界、焦点/键盘和lint真实修复 |
| 质量与验收 | check-project、check-schema、test-browser、test-capacity、test-fixtures、e2e/、playwright.config、schema-consistency测试、.github/workflows/check.yml | 单命令、迁移一致、持久浏览器和容量基线 |
| 依赖与文档 | package/lock、eslint.config、drizzle.config、.gitignore、README/AGENTS、架构手册/台账 | 锁定补丁、保留警告、明确执行与维护边界 |

完整逐文件哈希与增量清单由交付清单记录，生成Pages由最终合并负责人重建，不能用旧副本生成包覆盖新功能。

## 4. 测试证据

- 类型检查、生产构建、Pages构建通过。全离线最新406通过、1跳过：后台集成组在没有测试环境时明确跳过，实际后台单独执行25/25通过。
- schema：14表、6迁移一致；丢索引、额外列及外键变化回归通过。归一化历史TEXT主键not-null声明，未声称比对CHECK约束或全部SQL语义。
- 回退契约回归通过：未知器件、缩减端子、新导线字段、损坏作品及不同迁移均拒绝，原指针与最新业务内容保持不变。此门禁不是电气算法语义等价证明。
- 图纸回归：同文件并发标题仅一方成功；两槽独立；替换/删除/重建拒绝旧请求；缺版本428、非法类型400；遗留数据初始化不丢字段。真实后台25项通过。
- Chromium：26通过、1明确跳过。十课每课标准操作/服务端判定及缺PE负例共20项；真实拖线、器件移动、缩放、保存重载端点一致；两账号浏览器拒绝私有草稿；损坏恢复/配额失败保留字节；双窗口保存冲突；迟到JSON读取；图纸选择焦点隔离。复制快捷键由并行功能分支提供，本副本没有按钮，因此跳过；合并后必须实际通过。不是截图中全部历史失效场景已经复现。
- 最新完整演练`diantuo-recovery-HizPp7/recovery-result.json`通过：账号、草稿、作品、PNG/PDF哈希及权限、v2→v1保留逻辑状态、空恢复门禁、私有目录真实恢复、实际worker/local.ts开发变更隔离，以及真实start:release入口。只使用测试专属数据。
- GitHub Actions配置已经落地，未在远端运行。公网及正式图纸真实数据验收未执行。

## 5. 容量基线

本机Windows、Node24.16、独立版本Worker/D1/R2。30个邀请成员，分别复用1/10/30人；每人创建、读取核对、修订保存，无自动重试。每请求单独HTTP连接，避免Node客户端复用过期连接影响测量；与真实浏览器连接复用不是同一负载模型。资源摘要包含客户端RSS/CPU及本次Worker进程树，不能外推生产容量。

| 文档 | 大小 | 1人p95 | 10人p95 | 30人p95 | 最新失败率 |
|---|---|---|---|---|---|
| 小教学电路 | 3648字节 | 49ms | 309ms | 773ms | 0 |
| 可保存1000线/32折点样例 | 586099字节 | 206ms | 1336ms | 3399ms | 0 |
| 原1000线/256折点样例 | 3722099字节 | 66ms | 405ms | 1379ms | 0，均按预期413拒绝 |

原样例适用于5MB本地导入/预览回归，超过后台750KB保存限制。本轮不提高限制或牺牲可读性优化。早期复用连接测试大量TypeError，改为每请求新连接后一次30人大文档仍出现Wrangler ProxyWorker“Network connection lost”500（1/30）；后一次完整九组通过。保留这一失败，不能把单次通过当稳定性证明，也不能自动重试写入。后续用真实浏览器持续负载及更长时间重复基线定位。

## 6. 清理与剩余风险

删除未使用eslint-config-next依赖，直接声明现有eslint配置实际使用的插件。新增test-results/playwright-report忽略规则。没有删除历史三维、原始素材、用户图纸、旧drizzle、.local-training、生产state或未知脚本；这些内容不能只凭旧日期判定无用。

剩余14项安全传播风险分为braces、Drizzle旧esbuild、vinext OG的fflate三条链，见逐条台账。workers-types5.x是唯一编译期跨主peer升级，类型/构建通过，仍需合并后验证。哈希不是签名、停写端口不是全环境锁、同schema版本回退不是跨schema回退、Windows文件mode不是ACL。正式库恢复必须有维护窗口、完整私有目录和真实业务核对。

## 7. 下一阶段最值得做的5个任务

1. 合并后完成零lint错误、全部浏览器（含复制）及check:extended；核验首次远端CI。
2. 正式维护窗口完成真实业务备份/新目录恢复/版本化切换，保留单一Tunnel源站。
3. 等上游兼容安全补丁并复核三条残余链，避免审计建议的倒退版本。
4. 扩展逐课错误保护/互锁/时序负例以及长时间真实浏览器30人容量，定位代理失败。
5. 定义附件配额、孤立对象保留/可恢复清理与换机迁移流程，先测量再实施。

## 如果长期维护2年，最想解决的3个问题

1. 发布、迁移、恢复和业务状态缺少正式维护闭环：工具已有，但必须在真实维护中验证责任与操作过程。
2. 开发工具链安全债与框架升级兼容：需要小批升级、自动回归及稳定运行产物，避免被迫倒退或频繁不可审查重写。
3. 课程/编辑器边界测试与可观测性不足：用真实交互与错误接线矩阵保护教学正确性，记录可复核但不含私密内容的失败上下文。
