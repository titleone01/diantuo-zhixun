# 电拓智训

面向职业院校的二维电气接线训练成员站。当前主产品位于 `app/simulator/`：邀请登录后，学员选择课程或参考图纸，在 React Flow 画布放置器件、连接端子、操作离散仿真、检查课程、保存私有草稿或发布成员可见的独立快照。

主要训练范围是十套电机控制课程，另保留点动、自锁、单控和双控照明四个基础示例。目录包含 29 种可放置对象（27 种电气器件、2 种线槽）。这是教学模型，不计算真实电磁、热或机械瞬态，不代表厂家安装尺寸或实际设备安全认证。

旧三维模块、原始素材和历史存档独立保留，不自动转换为二维数据。项目仍处于试运行阶段，自动测试通过不等于所有接法、设备或网络验收完成。

## 访问与启动

既有公网入口为 [电拓智训成员站](https://train.titleone.space/)，由本机 Worker 经 Cloudflare Tunnel 提供；主机须开机、联网且不休眠。源码构建不代表已更新部署或验证公网可用性。

[GitHub Pages](https://titleone01.github.io/diantuo-zhixun/) 是静态演示，仅在当前浏览器保存电路，不提供成员认证、私有 R2 或真实广场后台。

新环境需 Node.js >=22.13，建议使用已验证的 Node.js 24；依赖版本由 `package-lock.json` 固定。

```powershell
npm ci --include=dev
npm run start:local
```

打开 `http://localhost:3000/`。启动器先检查端口：已有健康成员站则复用；空闲时才补充秘密、应用本地迁移、构建 `.local/app`、启动 loopback Worker 并初始化或核验管理员。迁移和初始化是有写入的操作，已有数据应先按运行手册备份。

首次管理员随机凭据位于被 Git 忽略的 `.local/admin-access.json`，终端不输出密码。管理员在个人中心创建邀请，成员通过邀请注册。不要清空数据库解决登录问题。

已配置既有隧道时，在另一个终端执行 `npm run start:tunnel`。完整步骤、桌面快捷方式、停止与恢复见 [本地运行手册](architecture/local-runbook.md)。`npm run dev` 保留 vinext 开发方式；本项目 Windows 上曾有依赖优化资源问题，稳定试运行入口是 `start:local`。

## 环境与数据

`.dev.vars.example` 只列变量名及占位值。`node scripts/bootstrap-admin.mjs --prepare` 为缺失项生成随机秘密；不要将示例占位值当作可用秘密。

| 变量 | 用途 |
| --- | --- |
| `BETTER_AUTH_SECRET` | 会话和认证秘密，已有环境不要随意更换 |
| `BOOTSTRAP_SECRET` | 空库管理员初始化，只允许本机入口 |
| `APP_ORIGIN` | 本机完整 origin，默认 `http://localhost:3000` |
| `APP_PUBLIC_ORIGIN` | 可选固定 HTTPS origin，精确匹配，不使用通配符 |

| 位置 | 内容与保护要求 |
| --- | --- |
| `.wrangler/state/` | D1/R2 全部本机数据，含 WAL 等辅助状态；不得删除或只复制活动 SQLite 主文件 |
| `.dev.vars`、`.local/` | 秘密、管理员/隧道凭据、运行记录、构建及验收证据；不提交或公开 |
| `.local-training/` | 独立的历史三维数据，不能合并账号和库 |
| 浏览器 localStorage | 按账号隔离的恢复记录、静态演示草稿；未保存到服务器的内容不在服务器备份中 |
| `db/migrations/` | 实际应用的 SQL 迁移；只追加，不重写已经应用的迁移 |

十课的 20 张用户图纸位于私有 R2，新建空库不会自动附带。原站公开参考图与这组私有图纸是不同资料。素材正式使用前仍需核对许可。

## 结构与交互

| 目录 | 职责 |
| --- | --- |
| `app/simulator/core/` | 文档契约、器件目录、独立引擎、14个课程定义与判定 |
| `app/simulator/editor/` | 世界坐标编辑、导线渲染、仿真会话、导入导出和只读预览 |
| `app/simulator/` 的 gallery/profile 等 | 成员界面、账号工作区、图纸与列表请求状态 |
| `app/server/` | API、认证权限、草稿版本、发布快照、私有媒体与服务端评测 |
| `worker/local.ts` | 当前本机 Worker 入口、Host/HTTPS 校验及静态资源 |
| `worker/index.ts`、`app/api/` | 保留的 vinext/Worker 构建路径 |
| `db/`、`shared/` | 数据结构/SQL迁移、十项目名称目录 |
| `app/training/`、`server/` | 历史三维场景与独立旧服务器 |
| `public/` | 公开素材、旧 GLB、PDF.js 运行资源；不放用户私有文件 |
| `scripts/`、`tests/` | 构建/运行/验收脚本与离线、集成回归 |
| `architecture/` | 长期架构、课程、运行、验收和维护文档 |
| `docs/` | `build:pages` 重建的 Pages 产物，禁止手工维护文档 |

浏览器保存器件世界位置及稳定端子引用，几何层计算显示端点。仿真运行、安全诊断和课程判定独立。浏览器使用共享引擎预览，服务器 `/api/assess` 重新计算；草稿通过 `revision` 比较更新，发布保存不可变快照，媒体权限由数据库关联决定。详见 [二维架构](architecture/simulator-2d.md)、[后台 API](app/server/README.md)、[项目维护说明](architecture/project-maintenance.md)。

## 测试与构建

```powershell
npm run typecheck
npm run lint
npm run build
npm run build:pages
node --test tests/*.test.mjs
npm run test:backend
```

`rendered-html.test.mjs` 检查 `docs/` 实际产物，因此前端修改后先重新 `build:pages`，再运行最终测试。`npm test` 执行生产构建和离线测试，不包含 Pages 重建和实际后台集成。

`test:backend` 默认使用临时 Worker/D1/R2、随机测试管理员和独立端口，不读取生产凭据。`-- --keep` 保留本次证据；失败默认保留。显式验收现有站点必须同时提供 `--url` 与 `--admin-file`，会创建业务数据，详见后台文档。普通离线测试中的后台组跳过不计作通过。

浏览器验收须实际端子拖线，检查移动、缩放、重载后世界端点一致，并覆盖课程与双账号权限；自动组件测试不能替代这些交互。

`npm run build:local` 会更新当前本机站的 `.local/app`，不是无影响的检查命令。Worker 开发进程也可能自动加载后台源码；长期运行需将开发目录和发布目录分离。

## 当前维护边界

已增加版本产物、停写备份/恢复、代码回退及严格图纸版本条件，见[发布恢复手册](architecture/releases-and-recovery.md)。正式迁移与源站切换仍须安排维护窗口。

日常执行`npm run check`：类型、lint、schema、生产构建、Pages、离线与隔离后台。`npm run check:extended`追加恢复、Chromium和容量验收。先执行`npx playwright install chromium`；Linux CI加`--with-deps`。单项命令是`check:schema`、`test:recovery`、`test:browser`、`test:capacity`。单worker浏览器使用新建测试账号，只有`.local/acceptance-public/`脱敏结果可上传，临时凭据、状态和失败上下文不公开。

`db/migrations/`是唯一执行来源。`db:generate`输出`.local/migration-candidates/`，人工审核为新增SQL后执行`check:schema`与隔离迁移；历史`drizzle/`保留。比对表、列、默认值、主键、索引和外键，历史TEXT主键非空声明差异归一化；CHECK约束不在自动比对范围。

浏览器脱敏结果保留在`acceptance-public/browser-history/`；详细失败只写测试专属私有目录，不能上传。隔离运行器关闭Wrangler版本提示，避免其未取消的网络更新检查阻塞本地命令退出；仍使用锁文件指定版本。

剩余依赖处置见[安全台账](architecture/dependency-audit-2026-10-03.md)，本轮合并副本证据见[加固报告](architecture/project-hardening-report-2026-10-04.md)。最终分支合并后仍须核对文件哈希与验收结果。

本轮修复、验证、未决问题和下一步见 [项目优化报告](architecture/project-health-report-2026-10-03.md)。历史验收保留原日期，不能当作当前实时上线状态。

2026-10-04 聊天反馈功能、备份回退点及最终隔离验收见 [反馈交付报告](architecture/feedback-implementation-2026-10-04.md) 和 [逐项脱敏记录](architecture/feedback-acceptance-2026-10-04.json)。十课新练习自动预排器件、双联 FU2、16 位端子排和线槽；初始无导线，允许编辑、复制和接线。本轮交付功能分支，正式源站切换按维护窗口执行。
