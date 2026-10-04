# 电拓智训项目维护说明

本文用于后续开发接手。当前事实以源码、最新验收和实际运行配置为准，历史验收记录按日期保留。修改前仍须读取根 `AGENTS.md` 和 `3d-wiring.md`。

## 从需求到验证

先确定需求属于二维主产品、账号后台、运行工具还是遗留三维。阅读对应模块及测试，记录现有 Git 修改和运行进程。将可复现问题写成回归，实施小组修复，检查 diff 并运行相关测试，再运行 README 中的完整验证命令。不要用静态 Pages 代替成员站验收，也不要因四个旧示例通过就省略十课。

| 需求 | 首读源码 | 测试与契约 |
| --- | --- | --- |
| 电气状态或课程结果 | core/engine、motor-course-assessment、motor-courses、types、catalog | simulator-engine、ten-motor-lessons、electrical-rules、ten-motor-lessons 文档 |
| 拖线与编辑状态 | editor/SimulatorEditor、geometry、simulation-session、DeviceNode、WireEdge | reference-editor、editor-session、preview、validation |
| 保存、恢复、账号切换 | SimulatorApp、workspace-session、api | simulator-session、simulator-api、reference-entry |
| 草稿和作品权限 | app/server/content、api、两个 list 模块 | circuit-snapshot、circuit-list、gallery、真实 backend 集成 |
| 图纸与附件 | TrainingProjects、DrawingViewer、PdfDrawing、server/media、training-projects | backend-media、attachments、training drawings 集成 |
| 启动与数据 | scripts/start-local、start-desktop、bootstrap-admin、worker/local | local-origin、backend-test-runner、local-runbook |
| 历史三维 | app/training/scene、server/local-server | wiring-store、scene-electrical、wire-routing；同时读厂商标定规则 |

文件名缩写在 `app/simulator/`、`tests/` 或 `architecture/` 下解析。API 详细方法、响应与并发契约见 `app/server/README.md`。

## 状态职责

资产目录描述器件，电路文档保存实例、端子连接及附件引用，运行时保存开关/线圈/逻辑时钟，诊断给出电气危险或不支持原因，课程判定在副本上验证教学目标。导线的颜色与折点不能改变连接关系。

`WorkspaceBoundary` 区分账号会话与文档替换；`SimulationSession` 区分每次运行。保存只确认提交时快照，保存期间新编辑仍为 dirty。列表各自持有请求序号以丢弃旧结果。新异步功能必须接入这些边界，不以 React 旧闭包里的状态作为最新事实。

持久化事实为 D1 行与私有 R2 对象；浏览器恢复记录只是独立的临时恢复来源。作品快照不随草稿变化。媒体关联的读写须与对应版本一致。不要通过公开静态目录绕过 API 权限。

## 数据库与生成产物

实际迁移目录是 `db/migrations/`，按SQL顺序应用。`db/schema.ts`同步表和索引；`db:generate`只输出`.local/migration-candidates/`，历史Drizzle保留。候选人工审核为新增迁移后运行`check:schema`和隔离后台，未经对照/演练不执行生产迁移。结构核对不覆盖CHECK全部语义，历史TEXT主键非空差异归一化。

`0005_publication_lookup_indexes.sql` 只追加作品互动与附件反向查找索引，不改业务记录。运行中复用的本机服务不会自动应用迁移；本轮没有主动迁移生产库。正常维护重启前先备份并核对待执行迁移。

`docs/` 是版本控制中的 Pages 产物；生成后要连同新哈希文件与 index 一起审查。`public/sim-assets/pdfjs/` 由已锁定的 pdfjs-dist 同步，保留许可证；不要人工改 vendor 文件解决应用问题。`.local/app/` 保留旧哈希包以降低旧标签页失效风险，后续需要有保留期的发布管理，不能无条件清空。

## 验证证据如何解读

- 离线测试包含内存 SQLite、纯引擎及部分通过 esbuild 转换的真实组件回调。它们不是完整 DOM、输入事件、Cookie 或浏览器网络测试。
- 后台隔离验收启动真实 Worker/D1/R2 与 Better Auth，覆盖两成员权限、并发版本、不可变快照、附件和十课服务器重算。它不复制现有生产数据，不能证明真实备份可恢复。
- 重启验收通过 `DIANTUO_TEST_ARTIFACT_DIR`、`DIANTUO_TEST_ADMIN_PATH` 和 `DIANTUO_TEST_URL` 选择同一临时库的凭据/证据；不设变量会沿用历史 `.local`，不能混用。本轮临时库同目录重启与哈希/权限已验证，完整备份恢复另行演练。
- 浏览器验收记录实际拖线、移动、缩放、保存/重载与运行操作。双账号 API 验收与双账号浏览器切换是两类证据，应分别报告。
- 合并副本`npm run lint`已达到零错误；图片、字幕及遗留导航警告逐条保留说明，见lint快照。保留规则，不为获得绿色状态关闭大类检查。
- 数据库只读 `quick_check` 和 `foreign_key_check` 仅检查所读文件结构和关系，不证明每个 R2 blob 与课程内容正确，也不替代停写备份/恢复演练。

## 常见故障

| 现象 | 优先检查 |
| --- | --- |
| 3000已占用、启动器退出 | 检查 PID/项目归属与 `/api/session`，不要按程序名结束其他进程 |
| 修改前端后页面仍旧 | 本机站读取 `.local/app`；构建前确认更新运行页面的影响，单纯 `npm run build` 不更新它 |
| 草稿409 | 保留当前接线，回读服务器新版或另存副本，禁止去掉 revision 规避冲突 |
| 请求超时 | 先确认服务状态；保存/注册/发布可能已到服务器，回读后再重试 |
| 恢复记录无效或空间不足 | 导出当前电路、检查当前账号键；保留 unreadable 备份，不清全站 localStorage |
| 新空库课程图纸待上传 | 正式20图是私有对象，不随 Git/静态构建分发；使用管理员正式导入流程 |
| Pages没有登录/广场数据 | 这是静态演示设计，应使用完整成员站入口 |
| 隔离后台命令超时 | 查看本次保留临时目录及阶段日志，不改为测试生产库来绕过失败 |
| build成功但服务未更新 | 构建、迁移、运行实例、外网入口是不同验收对象，逐项确认 |

## 既有合理设计与待办

继续保留纯引擎与图形分层、稳定端点、一次性邀请事务、revision/writeId、账号命名空间、独立发布快照、私有媒体和旧三维隔离。不要把全部元件按同一种物理安装方式处理，不自动转换旧存档。

发布隔离、合成数据完整恢复/回退、强制图纸版本和迁移结构核对已有工具与回归。优先债务转为正式业务维护演练、上游依赖安全补丁、远端CI首次验证与更长时间的浏览器负载。引擎与编辑器中的长函数可随具体规则拆分，不另建一套框架替换有效实现。附件配额及可恢复清理须先测量和定义保留策略。

下一阶段工具已实现并在独立副本验证，见[加固报告](project-hardening-report-2026-10-03.md)。发布/恢复由release-tools和start-release管理；图纸强制expectedVersion；统一check与schema核对；Chromium十课正负例及容量基线。正式库与公网尚未切换，最终分支仍须核对合并结果。依赖剩11项/7high传播条目，保留台账与本机代理偶发连接中断记录。

项目没有 LLM 请求、System Prompt、Tool Calling 或 Agent 循环；无需增加模型供应商抽象。未来若加入 AI 讲解，其输出不得直接成为电气事实或课程通过结论，仍须独立输入验证和电气引擎判定。
