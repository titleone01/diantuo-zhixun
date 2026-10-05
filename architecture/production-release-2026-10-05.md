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
