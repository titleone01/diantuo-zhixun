# 加固目标逐项完成审查

日期：2026-10-04。本轮范围按批准计划为代码修复、工具和独立环境演练；正式站切换及业务库迁移是后续维护操作，不在本次完成声明中。

本审查已读取实际代码断言及当前结果，并重新核对发布v1/v2和备份三个归档的全部文件哈希；没有仅凭绿色摘要判断完成。

交付分支与合并验收副本的84个运行源码/配置/测试文件逐字节相同。合并副本十步及交付分支七步均退出0，453个离线测试中452通过、1后台条件跳过；真实后台25、浏览器29、容量9组通过。

| 计划要求 | 状态 | 完成证据覆盖 | 实现/断言来源 |
|---|---|---|---|
| 1 发布与恢复准备 | 通过（隔离环境） | 版本包和源码/锁定/产物哈希；备份/WAL/私有目录；新目录业务及附件校验；真实start:release；开发源码变更隔离 | `scripts/release-tools.mjs`、`scripts/test-recovery.mjs`、`scripts/test-persistence.mjs` |
| 2 图纸并发保护 | 通过 | 两槽独立version；同媒体标题竞争；替换/删除/重建拒绝旧请求；428/409；0006遗留记录保持不变 | `tests/backend-drawing-versions.test.mjs`、`tests/backend.integration.test.mjs`、`db/migrations/0006_training_drawing_versions.sql` |
| 3 安全与代码质量 | 通过；保留剩余风险 | 25项逐条处置，最终11项/7high/4moderate；fflate兼容补丁与ZIP64回归；lint零错误、11警告逐条说明 | `architecture/dependency-audit-2026-10-03.md`、`architecture/lint-warning-snapshot-2026-10-03.md`、`tests/dependency-zip-regression.test.mjs` |
| 4 持续检查与迁移核对 | 通过（本机）；远端CI未运行 | 完整十步/交付分支七步；14表6迁移；候选不直接执行；GitHub Actions无生产秘密和数据依赖 | `scripts/check-project.mjs`、`scripts/check-schema.mjs`、`drizzle.config.ts`、`.github/workflows/check.yml` |
| 5 十课与容量验收 | 通过（隔离环境） | 十课正负例；真实拖线/移动/缩放/保存重载；双账号/迟到导入/409/配额；29浏览器及9容量组；20原图40次哈希、20实际显示 | `e2e/acceptance.spec.mjs`、`e2e/feedback-routing.spec.mjs`、`scripts/test-capacity.mjs` |
| 接口与数据规则 | 通过 | 读取兼容新增version；所有项目内修改携带expectedVersion；追加迁移；不覆盖非空恢复目录；回退保留最新业务状态 | `app/server/training-projects.ts`、`app/simulator/TrainingProjects.tsx`、`scripts/import-training-drawings.mjs`、`tests/release-tools.test.mjs` |
| 文档和交付 | 通过；功能对话Git收尾独立进行 | README/AGENTS/结构/运行/测试/错误/债务/五项后续/长期三问题、逐文件加固清单；不改生产或历史数据 | `README.md`、`AGENTS.md`、`architecture/project-hardening-report-2026-10-04.md`、`architecture/hardening-change-list-2026-10-04.md` |

## 当前证据位置

- 合并副本：`E:\vibecoding\diantuo-combined-XURP9k\.local\acceptance-public\`，包含check/recovery/browser/capacity/goal-completion脱敏JSON。
- 交付分支：`C:\Users\admin\.codex\worktrees\simulator-feedback\电拓智训\.local\acceptance-public\check.json`。
- 原图独立验收：交付分支`.local/feedback-evidence/formal-drawings.json`与`formal-browser-views.json`；10课20原图，40次成员读取、20次匿名拒绝，20次显示完整且媒体ID一致。
- 详细失败及截图保留在测试专属私有/ignored目录，不上传CI或放入公开素材目录。

## 不属于已验证结论的事项

正式0006迁移、业务备份恢复/版本化切换、公网验收、远端GitHub Actions未执行，必须另行维护。已有本机ProxyWorker偶发500记录未被消除；最终通过不代表长期稳定。写入失败不自动重试，先回读状态。

完整问题、文件、测试、剩余风险和下一步见[最终报告](project-hardening-report-2026-10-04.md)。
