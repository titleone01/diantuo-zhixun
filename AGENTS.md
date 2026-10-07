# 电拓智训项目协作约束

## 接手入口与当前运行边界 2026 年 10 月 4 日

先读本文件、`architecture/3d-wiring.md`、`architecture/simulator-2d.md`、`architecture/local-runbook.md`。先检查 `git status --short` 和端口/PID，保留全部已有修改；多个 Agent 明确文件范围，构建、依赖安装和运行服务由一名负责人协调。

当前产品是二维邀请成员站：新建入口仅提供十个电机课程。四个早期课程和18张原站参考图仅用于历史草稿、作品、媒体和评估兼容，不再提供新建入口。当前范围见 `architecture/ten-course-consolidation-2026-10-07.md`。`app/simulator/core/` 保存共享文档/器件/电气/课程契约，`editor/` 管画布与仿真会话，`SimulatorApp.tsx` 管账号及工作区，`app/server/` 管权限和 API，`worker/local.ts` 是本机入口，`db/migrations/` 是实际迁移来源。详细目录和维护债务见 `architecture/project-maintenance.md`，本轮证据见 `architecture/project-health-report-2026-10-03.md`。

2026-09-30 后已存在固定公网 Tunnel 入口，见运行手册。下方“先本地验收、不部署公网”是实施权限边界，不表示现网不存在：日常修复不要另建站点、切换域名、启动第二个生产源站或自动执行远程部署。端口 3000 监听 loopback，隧道与本机共用唯一业务库。

- 不读取或输出 `.dev.vars`、`.local/` 中的真实秘密、密码、会话和令牌；只核对变量名/存在性。不要提交这些目录或把私有图纸放入 `public/`。
- 不删除 `.wrangler/state/`、`.local-training/`、历史源码/模型/用户数据。数据库备份须一致性处理 WAL；恢复演练与真实环境分开。迁移只新增文件，不改已应用的历史 SQL。
- `start:local` 空闲时会迁移/构建/初始化，`build:local` 会更新运行页面；二者不是只读检查。运行中 Wrangler 可能热加载源码，不能将“未重启”写成“运行实例完全未变化”。
- API 以服务端会话为准，不信客户端 ownerId/role/通过结果。保留 revision/writeId 并发保护、不可变发布快照和私有媒体授权。
- 异步文件/网络结果写回工作区前，验证账号会话、文档与仿真代数；超时后不得自动重试保存、注册或发布。
- 持久化恢复记录若损坏，保留原始内容后才允许覆盖；存储空间不足要报告，不得默默删除旧记录。
- 运行、安全诊断、评分独立；错误保护接线不得用强制停机掩盖。十课必须按逐课契约测试，不能用四个基础示例替代。
- 本项目没有 LLM/Agent 业务运行链，不应为重构加入模型调用。现有 `chatgpt-auth.ts` 是历史托管认证工具，不是当前成员认证或 AI 推理入口。

### 验证顺序

每组小修复先读 diff、执行相关回归。最终执行 `npm run typecheck`、`npm run lint`、`npm run build`、`npm run build:pages`、`node --test tests/*.test.mjs`，再执行 `npm run test:backend`。Pages 应先构建再跑最终产物测试。合并副本lint已达到零错误，剩余图片、字幕及遗留导航警告逐条记录；不得全局关闭规则伪造通过，修改后须重新核对。

后台测试默认隔离临时 Worker/D1/R2；`npm run test:backend -- --keep` 保留独立证据。针对既有站点的 `--url` + `--admin-file` 模式会写测试数据，必须有该环境的写入验收授权。`test-persistence` 须明确本次产物目录、管理员路径和地址，见运行手册；无变量时仍读取旧 `.local` 证据。它和 `test-training-drawings` 都不是无副作用的只读检查，不混用不同数据库的凭据/证据。

浏览器必须真实拖线并验证移动、缩放、重载后的世界端点，区分自动引擎十课、真实浏览器课程及双账号 API/浏览器权限证据。未执行的内容明确标记未验证。保留原始生产数据，不为验收覆盖正式图纸。

### 当前优先债务

最新实施状态见`project-hardening-report-2026-10-04.md`；原`project-health-report-2026-10-03.md`及初始加固报告保留阶段历史。下一步优先正式维护窗口的业务备份恢复/发布切换、剩余间接依赖补丁、首次远端CI、长期浏览器容量与附件保留策略。不要为了消除长函数一次性重写引擎或编辑器。

### 加固工具与接手入口

新增事实见`architecture/project-hardening-report-2026-10-03.md`、`architecture/releases-and-recovery.md`及依赖台账，原报告保留历史结果。日常`npm run check`，完整隔离`check:extended`；单项`check:schema`、`test:recovery`、`test:browser`、`test:capacity`。Chromium单worker，CI只上传acceptance-public脱敏结果。

- 图纸每槽version，PUT/DELETE强制expectedVersion（空槽null），缺失428/冲突409，不能删除条件绕过。0006正式迁移另行维护。
- 发布与state分离；start:release不迁移/构建；回退保持最新state，跨迁移集合拒绝。激活和启动均用目标产物的校验器/器件端子字段契约检查草稿及作品，缺契约、损坏或新增不支持的数据拒绝回退。备份恢复先读手册，不覆盖非空目录。
- test:recovery临时修改当前隔离副本worker/local.ts再finally恢复，禁止其他Agent同时修改该源码。构建/安装/恢复仍由一人协调。
- db:generate仅输出.local/migration-candidates候选；SQL只追加db/migrations，保留旧drizzle目录及历史SQL。
- 双对话声明目录/文件归属、交付增量和哈希；共享界面按差异合并，合并后再验证。剩余重点为生产真实恢复/切换、间接依赖、CI远端执行、课程负例、容量与附件生命周期。

## 2026-09-30 已确认的新主产品（优先于下方历史三维约束）

用户已明确批准切换为独立的二维仿真整站。新实现位于 `app/simulator/`，采用 React Flow 二维器件、稳定端子 ID 与独立离散电气引擎；支持点动、自锁启停、单控及双控照明。新主产品不受下方单一 R3F Canvas、DIN 布局和真实 GLB 外形约束，二维元件是教学示意，不宣称厂家真实型号或安装精度。保留全部旧三维代码、模型、未提交改动和存档，不自动转换旧数据。

用户随后提供20张原理图/布局图，确认十套电机课程为主要训练目标；范围与逐课契约见 `architecture/training-project-requirements.md`、`architecture/ten-motor-lessons.md`。四门早期课程的通过不能替代十课验收。原站SVG与原图优先于自绘素材，必要扩展明确教学模型，用户图纸存储在受成员权限保护的本机R2中。

新元件资产定义与场景实例仍须分离；端点由二维世界坐标推导，禁止保存 DOM 像素作为电气事实。运行状态、安全诊断、课程判定必须分离；不得通过强制停止电机掩盖错误保护接线。多用户后台采用邀请制，先本地验收，不部署公网。任何源站后台行为未经实测必须标记待验证。详细新架构见 `architecture/simulator-2d.md`（实施过程中创建）。

下方三维规则继续约束遗留三维模块及真实厂商模型。`docs/` 生成目录限制和所有构建/测试要求继续适用。新浏览器验收改为真实二维端子拖线，验证移动、缩放、重载后世界端点一致，并完成双账号权限及课程运行验收。

修改本项目之前，必须先阅读 `architecture/3d-wiring.md`。

涉及新增或调整真实元器件时，还必须阅读 `architecture/component-calibration.md`，并按其中的证据门禁执行。

涉及接线板布局、安装方式或电气接线时，还必须阅读 `architecture/real-panel-baseline.md`。若训练目标回路未明确，先向用户确认，不得自行补成某一种电路。

`docs/` 是 GitHub Pages 的生成目录，`npm run build:pages` 会重建它。长期文档、源代码和人工维护的文件禁止放入 `docs/`。

## 历史三维第一版范围

- 第一版训练目标已确认是“完整的三相电机直接启动回路”最小闭环：真实器件放置 → 主回路与控制回路接线 → 线槽整理 → 断路器合闸 → 启动/停止 → 接触器、热过载继电器和电机状态联动。
- 第一版允许且需要的基础对象是进/出线端子、PE 端子、三相断路器、交流接触器、匹配的过载继电器、启动按钮、停止按钮和三相电机/电机接口。其他器件仍不得未经需求确认加入。
- 第一版只实现支撑上述训练闭环所需的离散状态和拓扑安全逻辑，不模拟真实电磁、热或机械瞬态；`app/circuit-analysis.ts` 继续作为独立拓扑安全模块保留。

## 遗留三维不可破坏的架构规则

1. 接线板只有一个 React Three Fiber `Canvas`。器件、端子、导线、导轨和线槽必须处于同一三维世界坐标。
2. 不要重新使用“每个器件一个 WebGL Canvas + React Flow/SVG 导线”的方案，也不要用图片卡片代替已经存在的真实 GLB。
3. 器件资产定义与场景实例必须分离：资产放在 `app/training/component-library/`，实例和导线只保存在 Zustand 场景状态中。
4. 导线端点只能由 `器件实例变换 × 端子局部三维坐标` 得出；禁止保存屏幕百分比、DOM 像素或手调 SVG 坐标作为电气端点。
5. 默认相机保持俯视，不提供脱离接线板的任意 360° 旋转。器件必须遵守该型号的官方安装方式：DIN 导轨器件吸附到对应导轨；螺钉安装器件固定到安装板，禁止把所有器件一律吸附到 35 mm DIN 导轨。
6. 新器件必须提供端子 ID、局部三维坐标、出线方向、电气属性和安装方式。没有这些信息的模型只能进入“待标定”，不能用于正式接线。
7. 保留原始 STEP 文件；Web 端使用经过清理和优化的 GLB。不要覆盖 `E:\电气模型库` 中的原始下载文件。
8. 厂商官网、官方尺寸图、官方 STEP/STP 和实物安装结构是器件外形、比例与方向的唯一首选依据。不得仅凭包围盒、截图观感或经验推断安装朝向、尺寸、端子位置和操作机构。
9. 任何关键事实不清楚时，必须先检索厂商官网和官方技术资料；官方资料仍无法确认时，停止实现并向用户说明不确定点、现有证据和待确认选项，禁止自行猜测后直接落地。
10. DIN 导轨器件的正式朝向必须由背面的 35 mm DIN 卡扣/挂钩、正面标识、上下端子和官方安装示意共同验证。仅完成坐标轴变换或包围盒对齐，不算安装方向已确认。
11. 开关手柄、推杆、按钮、旋钮等可动原件必须来自官方模型可分离部件，或严格依据官方尺寸和转轴标定重建。未经用户明确同意，不得用主观自绘的几何体覆盖官方模型并将其当作正式原件。

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
