# 2026-10-08 HTTP / HTTPS 登录修复记录

## 已恢复的现网登录

用户报告原 `test01`–`test05` 密码无法登录。现网页面及匿名 `/api/session` 为 200，但 HTTPS 登录 POST 返回 `403 ORIGIN_REQUIRED`；本机五个成员账号均有效，未重置密码或重建账号。

本机 Wrangler 4.147.0 的 ProxyWorker 将同主机的绝对 URL 请求头改成内部 HTTP 来源，原适配器只恢复 `request.url` 的 HTTPS 协议，导致 URL 与 Origin 不一致。修复仅在固定公网 Host、`X-Forwarded-Proto: https`、被改写的同主机 HTTP Origin 和浏览器 `Sec-Fetch-Site: same-origin` 同时成立时恢复 HTTPS Origin。其他来源、缺失元数据、同站跨来源、跨站请求、伪造 Host 和公网初始化仍拒绝。

首轮已激活登录修复包（最终切换前的验证）：

- 代码提交 `352382d`；发布 ID `1d747b55fd3058a3a526e422517117e49a8de5f30f9aa34097531723d68717a5`。
- 路径 `C:\Users\admin\diantuo-production\20261008-login-repair\release`。
- 原业务状态 `E:\vibecoding\电拓智训\.wrangler\state`，原固定 Tunnel 和域名保持使用。
- 五个原成员在 `http://localhost:3000` 和 `https://train.titleone.space` 均通过登录、服务端会话身份/角色、十课二十图列表、管理员接口 403、退出后会话清空、再次登录及再次退出。
- HTTPS 登录 Cookie 的 Secure、HttpOnly、SameSite=Lax 均通过；本机 HTTP Cookie 的 HttpOnly、SameSite=Lax 通过。
- 两个入口的实际 JS/CSS 文件名和字节哈希与发布包匹配。
- 用户已实际刷新 HTTPS 页面并确认 `test01` 可以正常登录。浏览器自动化多次超时，未宣称自动 UI 登录通过。
- 脱敏证据 `C:\Users\admin\diantuo-production\20261008-login-repair\live-login-before-final.json`。

## 最终 HTTP / HTTPS 版本：已上线并验证

首轮实测还发现公网 HTTP 首页返回 200、API 导航的 308 Location 被 Wrangler 改回 HTTP，因此继续修复了公网 HTTP 导航。

最终代码提交 `22c222e` 已把本机资产路由改为 `run_worker_first: true`，使首页和静态文件也经过 HTTPS 门禁。跳转 Location 使用同一 DNS 主机名的大写文本，保持相同域名/端口/路径/查询，避开当前代理按大小写敏感文本触发的协议改写；浏览器 URL 解析后仍是原 HTTPS 域名。该兼容处理由真实安装版本的代理回归覆盖，升级 Wrangler 时必须重新执行测试。

- 最终发布 ID `9c30ea2b61274d2fc297c5b174d3c6336c5519f82eb36c15bf63093433f0a34e`。
- 已验证包 `C:\Users\admin\diantuo-production\20261008-login-repair\release-final`。
- 用户手动执行后于 `2026-10-08T13:14:26.491Z` 激活，仍使用原 `.wrangler/state`。当前 Worker 主管 PID 38828、服务主管 PID 33208、3000 监听 PID 20308，均限于原项目；Tunnel metrics 监听 PID 28340。
- 真实 Wrangler 测试确认首页、JS、带查询页面和 API 的公网 HTTP 导航 308 到正确 HTTPS 地址；本机 HTTP 和公网 HTTPS 页面仍为 200；HTTP 写入拒绝。
- 自动审批曾拦截停止/重启现有生产服务，仅返回 `blocked by policy`。用户再次明确授权后，执行工具仍拒绝；交由用户手动执行，没有通过另一工具绕过拦截。
- 用户已执行 `.local/apply-login-repair-20261008.ps1` 完成切换。该入口按 PSScriptRoot 解析中文目录，并在 Windows PowerShell 完成只读路径/进程/发布包验证；仅停止已核对的两棵项目进程树，停写备份最新 state/WAL/私有配置/`.local`，独立恢复验证，再激活并恢复原服务。不要重跑本次固定 PID、固定备份目录的维护脚本，后续维护应重新核对进程并选空新目录。
- 最终现网 `http://train.titleone.space/` 为 308，Location 解析为原 HTTPS 地址；无代理 curl 跟随一次跳转最终为 200。`http://localhost:3000` 与公网 HTTPS 均再次通过五账号登录、会话、退出、再次登录及十课二十图列表；HTTPS Cookie 标志正常，JS/CSS 文件名及字节哈希与最终包一致。
- 最终脱敏证据 `live-access.json`、`live-access-final.log`、`state-retention.json` 均位于上述交付目录。UI 的人工证据是用户此前明确确认 HTTPS 登录；浏览器自动化仍未通过。

## 启动检查与回归

新增 `scripts/site-readiness.mjs` 和 `check-site-access.mjs`，统一用于本机启动、已有 Tunnel 检查和桌面启动器。检查页面 HTML、会话 JSON 契约、匿名同源 POST `/api/session` 能否到达 `401 AUTH_REQUIRED`；原故障虽有两个 GET 200，仍会被判为未就绪。探针不带凭据/Cookie，不注册账号、不保存业务数据。

现网重复执行启动探针时发现 Node 24 的 Windows libuv 断言，发生在健康检查后强制 `process.exit()` 的退出阶段。提交 `a93c1ac` 改为启动入口自然返回、失败仅设置 exitCode，避免强制退出仍有异步网络句柄的进程；已补独立真实进程测试。主目录重复执行 `start-local.mjs` 实际退出 0、无断言，`start-tunnel.mjs` 正常识别既有连接，两者不重启服务、不构建或初始化。此修改仅更新启动脚本，不替换已激活 Worker 包。

最终代码按顺序执行：

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 0 错误，10 项既有警告 |
| `npm run build` | 通过 |
| `npm run build:pages` | 通过 |
| `node --test tests/*.test.mjs` | 636 通过，0 失败，1 跳过 |
| `npm run test:backend` | 独立 Worker/D1/R2，25 全部通过 |
| 桌面 PowerShell 语法及实际 Test-Site 函数 | 本机/公网 readiness 均 true |

普通测试集合跳过的后台集成入口随后已在独立后台验收运行。新增真实 Wrangler 回归没有生产库、R2 或凭据，仅使用随机隔离端口和合成资产。

既有 lint 警告逐项保留：CourseLibrary:22、DrawingViewer:95、LessonSchematic:7、ReferenceDrawingPicker:79、DeviceArtwork:24 和 26、旧 ProjectPanel:97 的 img 警告；ReferenceVideoPlayer:30 的字幕警告；旧 TrainingCanvas:23、workspace-api:12 的导航警告。未关闭规则。

## 备份、恢复与边界

维护前完整 Git bundle 与修复后 bundle 均验证包含完整历史。停写备份 `C:\Users\admin\diantuo-production\20261008-login-repair\backup` 含 state/WAL/SHM、运行配置及全部 `.local`。恢复至新的 `restore-check` 目录，111 个状态文件通过字节哈希、SQLite quick_check 和外键检查，恢复副本的全部表计数及已选业务内容/R2 哈希与原状态完全一致。原库未被恢复副本覆盖。

原状态有 42 用户/42 认证账号、57 草稿、46 发布作品、87 媒体/R2 对象、20 课程图纸、315 评估、36 点赞，保留六项已应用迁移。登录验收会正常更新会话和限流记录，不能据此要求整个数据库文件不变。

最后切换前新增了一项评估，最新备份及切换后均为 316。已逐行哈希确认最初 315 项评估全部原样保留；其余草稿、作品、媒体、图纸、点赞及关系表哈希保持一致，87 个原附件字节哈希一致。最后停写备份 `backup-final`（111 状态文件、WAL/SHM及私有目录完整）恢复至新 `restore-final`，全部数据库完整性/外键和恢复前表计数/业务哈希一致；最终切换前后的最新业务哈希一致。没有用首轮备份覆盖这项新评估。

维护中的原固定源站仍监听 127.0.0.1:3000；未远程部署、改域名或新建源站。密码、令牌和会话值不进入本记录或 Git。未来代码回退应停写并用现有发布工具激活已验证包，保留最新 state；不得用旧业务备份覆盖现网。未执行长期在线、多运营商、物理接线及本次浏览器拖线验收，本次未改动器件、课程或画布。

依据：[Wrangler ProxyWorker 源码](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/templates/startDevWorker/ProxyWorker.ts)、[Fetch Metadata 标准](https://www.w3.org/TR/fetch-metadata/)、[Cloudflare Worker 与资产路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)。本次根因及修复结论以安装版本的真实代理测试和现网证据为准。
