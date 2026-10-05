# 2026-10-05 正式发布记录

用户在功能交付后明确授权“直接推送到正式版本”。此前功能及隔离验收见 [实施报告](feedback-implementation-2026-10-05.md)。

## 发布前核对

- 正式端口 3000 和 Tunnel 健康端口 20251 均无监听；独立测试页 55230 已通过其管理进程的专用停止标记关闭，测试数据保留。
- 正式业务状态仍位于项目 `.wrangler/state/`，42 个账号、57 份草稿、46 份不可变发布作品、20 张课程图纸、66 份媒体，SQLite 完整性及外键检查通过。
- 正式库已应用 0001–0006。本次没有新增迁移，也没有执行正式数据库迁移。
- 原 D1/R2、WAL/SHM、私有配置及完整 `.local/` 已停写备份到 `C:\Users\admin\diantuo-production\20261005-170103\backup`。该目录限制为当前用户、SYSTEM、Administrators 访问；真实秘密未输出或提交。
- 同一备份恢复到新的 `restore-verification` 目录，90 个状态文件逐字节匹配，全部 SQLite 完整性和外键检查通过。验证副本不会接到正式 Tunnel。

## 启动入口

正式发布运行目录采用原 `.wrangler/`，直接复用原 `.wrangler/state/`，不迁移到另一份业务库。桌面快捷方式保留，`start:local` 检测激活指针后转交 `start:release`；其启动只核验并加载编译产物。指针损坏时拒绝启动，禁止静默重建开发源码或重新初始化管理员。

新增两个启动回归分别验证原状态路径的传递，以及激活指针损坏时不进入 bootstrap/build 流程。

## 执行结果

备份及恢复核验已完成。加入正式启动入口后，按要求顺序重新执行 typecheck、lint、build、build:pages、全部 Node 测试和隔离后台测试：均成功，Node 测试 566 通过、1 条条件跳过，后台 25/25；lint 0 错误、11 条已记录警告。功能浏览器证据沿用实施报告的 61 个场景最新有效结果，没有将其表述为正式账号人工验收。

功能提交 `c87a21f9f6dff06a2e6f4977a5fb1b0f3c892fdb` 已快进合并并推送到远端 `main`，同时保留 `codex/feedback-20261005` 分支。该提交以干净工作区生成 272 个文件的发布包，产物 ID 为 `02bf801e7cfdee6a46da87a4bd3679455e992805ed4d1af022cb156c16040204`，目录为 `C:\Users\admin\diantuo-production\20261005-170103\release`。正式启动前，新契约逐条校验原库及恢复副本中的草稿、作品、端子及迁移集合，均通过。

17:04 左右通过原 `start:local` 入口启动 `.wrangler/active-release.json` 指向的新产物，正式地址继续为 <https://train.titleone.space/>，本机只监听 `127.0.0.1:3000`。随后启动已有固定 Tunnel；没有新建域名或源站，没有将恢复副本接入公网。

- 本机与固定 HTTPS 首页、JS、CSS 均返回 200，响应字节哈希与不可变发布包一致。
- 本机与公网 `/api/session` 返回 200；匿名 `/api/circuits`、`/api/training-projects` 均返回 401，访问控制保留。
- Tunnel `/ready` 返回 200，最终检查有 4 条就绪连接。初始个别边缘连接发生重连，随后就绪；此结果不等同于长期所有网络可用性。
- 实际浏览器显示新名称、登录表单及参考图，见 [正式页面](acceptance-2026-10-05/production-login.png)。没有读取正式密码或会话，没有替用户执行正式账号登录或写测试草稿；正式账号登录后的人工使用仍由用户验证。
- 运行后与停写备份的恢复副本比较：42 个账号、57 份草稿、46 份作品、20 张课程图纸及关联记录保持；草稿、作品、媒体、图纸槽、关联、评测与互动记录哈希一致，66 份附件字节全部一致。
- 再次执行启动入口直接复用已有正式服务和 Tunnel，没有创建第二个生产进程或业务库。

脱敏证据：[接口与产物核验](acceptance-2026-10-05/production-smoke.json)、[业务数据保持核验](acceptance-2026-10-05/production-preservation.json)。运行 PID 只作本次诊断：入口 32360、Wrangler 27480、3000 监听 31152、Tunnel 管理 37852、cloudflared 35384；后续维护必须重新核对归属，不可直接按历史 PID 停服务。

功能提交的远端 [Project checks](https://github.com/titleone01/diantuo-zhixun/actions/runs/37287544122) 与 [GitHub Pages 工作流](https://github.com/titleone01/diantuo-zhixun/actions/runs/37287542949) 均成功。Project checks 在 Linux 执行完整 `check:extended`，包含检查、隔离后台、恢复、Chromium 和容量验证；本机要求的全部检查及独立浏览器/恢复证据也已完成。后续提交只补充本发布记录与脱敏证据，正式运行的应用代码仍对应上述 `c87a21f` 产物。

## 回退边界

备份用于灾难恢复，不能覆盖上线后的新增写入。代码回退必须停写后用 `release activate` 保留最新 state，并通过目标产物的字段、器件、端子及迁移契约；不支持 rotation、din-rail、新 KA/KT 的旧版本拒绝回退。原备份、恢复副本和历史源码均保留。

## 同日 17:35 调时界面修复发布

用户明确授权“更新正式站”。应用代码提交为 `d2528b0a6428b0f8be4b8d45b5e1f4c09632851d`：时间继电器的增减及设置按钮改为紧凑单行，精确输入框仅点击设置后在器件右侧展开，可关闭，不因选中器件自动遮挡数码屏。新旧 KT 均完成真实浏览器验证，三个针对场景通过；完整检查为 Node 566 通过、1 条条件跳过，隔离后台 25/25，lint 0 错误、11 条既有警告。

本次先按当前进程归属停止原服务及 Tunnel，将完整 D1/R2、WAL/SHM、私有配置和 `.local/` 停写备份到 `C:\Users\admin\diantuo-production\20261005-173231-timer-layout\backup`，恢复至独立空目录核对 90 个状态文件及 SQLite 完整性/外键，并比较业务记录和附件。目录继续限制当前用户、SYSTEM、Administrators 访问。没有新增或执行数据库迁移，没有覆盖业务库。

新发布包位于同一受限目录的 `release`，ID 为 `8511ec7c91be1501187644524c653efc94218596d0e4e95e9ee999080209cb80`；旧发布包与旧指针副本保留。通过原激活门禁切换 `.wrangler/active-release.json` 后，用原 `start:local` 和 `start-tunnel` 入口重启，仍复用原 `.wrangler/state/`、`127.0.0.1:3000` 与固定域名。

17:37–17:38 核验：本机及公网首页、JS、CSS 均 200，字节哈希与新发布包一致；匿名会话 200，草稿及课程图纸接口仍 401；Tunnel `/ready` 为 200。真实 Chromium 显示公网登录页且无页面脚本错误；未使用正式密码登录或创建测试数据。重启后 42 个用户、57 份草稿、46 份作品、20 张课程图纸、66 份媒体，以及业务记录哈希和全部附件字节，与停写恢复副本一致。

脱敏证据：[新版接口及资源](acceptance-2026-10-05/timer-layout-production-smoke.json)、[业务数据保持](acceptance-2026-10-05/timer-layout-production-preservation.json)。上述新包已在正式站运行，后续文档提交不改变应用产物来源；本次未推送 Git 远端。

## 同日 17:57 两项修复统一发布

在「修复线槽内导线打结」聊天中，用户明确要求“把两项修复统一上线”。本聊天读取该聊天的原始用户消息核对授权，成为唯一正式服务切换负责人。源码分支 `codex/duct-entry-fix-20261005`（`aa1dded06b5ffd8f4dba061fa06c37320957ede9`）通过合并提交 `9170062` 整合到当前分支，保留计时器修复、此前发布记录与全部证据。应用代码、测试及依赖文件与已验证合并包的源码一致；Pages 按合并源码重建并提交 `545c433`。

合并后的主目录再次执行完整检查：typecheck、lint、build、build:pages、Node 回归、隔离后台全部通过；Node 567 通过、1 条后台环境条件跳过，后台 25/25，lint 0 错误/11 条既有警告。再次执行 Chromium 五项检查全部通过：紧凑计时器布局、上下槽入口无折返、真实拖线及元件移动/缩放/保存重载的世界端点、线槽移动/尺寸/断槽撤销、双账号隔离。检查均使用独立测试数据。

停写前核对当前进程链，停止原服务和原 Tunnel。完整最新 state/WAL/SHM、私有配置和 `.local/` 备份到 `C:\Users\admin\diantuo-production\20261005-175500-combined-fixes\backup`；该目录限制当前用户、SYSTEM、Administrators 访问。恢复到新的独立 `restore-verification` 目录，90 个状态文件逐字节核验通过，数据库完整性、外键、业务行哈希及附件字节与停写前一致。没有恢复旧业务库，没有新增或执行迁移。

通过目标版本文档与迁移兼容门禁后，17:57 激活 `.wrangler/active-release.json` 指向 `C:\Users\admin\diantuo-production\20261005-175500-combined-fixes\release`。发布 ID 为 `ad1e338ca2999f55d805a0c548a82ed5e153a338caa90c9891616eb3a23e5ef8`；代码源为 `aa1dded`，同时包含 `d2528b0` 计时器和 `ace4282` 线槽修复。所有旧发布包、指针副本与备份保留。用原 `start:local` / `start-tunnel` 入口启动，业务状态仍为 `E:\vibecoding\电拓智训\.wrangler\state`。

17:58–17:59 检查本机及固定公网入口：首页、`/assets/app-E3F6APXD.js`、`/assets/app-E4OPTFZL.css` 全部 200，字节哈希与合并包一致。JS SHA-256 为 `c2b53d430523fe148b2c81ff1503fad2bdbd126b84ba62c5085eeda4261c8d7f`；CSS SHA-256 为 `211642b296d6f3a707900740e9ad66134bbcc0e4877aee833268004b654c4a92`。匿名 `/api/session` 为 200，草稿和课程图纸接口为 401；Tunnel `/ready` 为 200。真实 Chromium 公网登录页正常且无页面脚本错误，未读取正式密码、替用户登录或写入测试数据。

运行后与本次停写恢复副本比较，42 个用户、57 份草稿、46 份作品、20 张课程图纸、66 份媒体均保留；业务表内容哈希及全部附件字节一致，所有 SQLite 完整性及外键检查通过。当前诊断 PID 为入口 14456、Wrangler lease 35380、3000 监听 39860、Tunnel 管理 39496、cloudflared 35184；只用于此次证据，后续操作必须重新核对。

脱敏证据：[合并检查](acceptance-2026-10-05/combined-fixes-check.json)、[五项浏览器验证](acceptance-2026-10-05/combined-fixes-browser.json)、[实际正式资源](acceptance-2026-10-05/combined-fixes-production-smoke.json)、[数据保留](acceptance-2026-10-05/combined-fixes-production-preservation.json)。本次未推送 Git 远端；正式运行产物的应用代码来源保持为已验收的 `aa1dded`。
