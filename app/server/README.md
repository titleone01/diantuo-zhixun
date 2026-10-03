# 成员站后端

业务路由共用 `handleApi`：vinext 入口为 `app/api/[...path]/route.ts`，直接 Worker 本地入口为 `worker/local.ts`。Better Auth 负责密码校验、Cookie 和会话；Drizzle 定义认证表；D1 保存业务数据；R2 保存私有附件。

## 本地初始化

日常启动优先使用 `npm run start:local`，完整运行、备份及固定 HTTPS 入口说明见 [`architecture/local-runbook.md`](../../architecture/local-runbook.md)。下列命令用于理解初始化步骤，不能与正在运行的同一数据库服务并行执行：

```powershell
node scripts/bootstrap-admin.mjs --prepare
npx wrangler d1 migrations apply DB --local --config wrangler.local.jsonc
npm run build:local
npx wrangler dev --config wrangler.local.jsonc --ip 127.0.0.1 --port 3000 --persist-to .wrangler/state
```

直接 Worker 需要先生成 `.local/app/index.html` 和前端资源。它与 vinext 使用同一份 D1/R2 本地状态。服务启动后，在另一个终端执行：

```powershell
node scripts/bootstrap-admin.mjs
```

管理员随机密码只保存在忽略提交的 `.local/admin-access.json`。`--prepare` 只补充缺失秘密，不覆盖已有秘密。默认地址为 `http://localhost:3000`，修改地址时需要同步 `.dev.vars` 的 `APP_ORIGIN`。固定 HTTPS 入口通过 `APP_PUBLIC_ORIGIN` 与本机入口共存；本地 Worker 校验 Host/HTTPS，公网禁止初始化接口。

## 测试与数据边界

```powershell
# 默认启动临时 Worker、新 D1/R2、随机测试管理员，不读取生产秘密和账号
npm run test:backend

# 成功后也保留独立证据；失败时默认保留便于排查
npm run test:backend -- --keep
```

默认测试使用系统临时目录中的 `diantuo-backend-test-*`、随机 loopback 端口及全部 SQL 迁移；成功后清理本次临时目录。它不启动生产站、不构建或覆盖 `.local/app`、不写现有 `.wrangler/state`。保留的临时目录含测试凭据，不能公开分享。此测试验证实际 Worker API、D1、R2 和 Better Auth，不替代真实浏览器操作和重启恢复验收。

确需对一个已授权的现有站点执行有写入的验收时，必须同时指定地址与管理员文件：

```powershell
npm run test:backend -- --url http://localhost:3000 --admin-file .local/admin-access.json
```

该显式模式会在指定站点创建并保留测试账号、草稿及作品，证据仍写入独立临时目录，不覆盖已有 `.local/test-accounts.json`。测试文件通过 `DIANTUO_TEST_ADMIN_PATH` 指定管理员文件，通过 `DIANTUO_TEST_ARTIFACT_DIR` 指定输出目录；未提供这两个变量的直接旧式调用仍兼容 `.local/`，应优先使用上述 runner。每次 API 请求限时 15 秒；未设置 `DIANTUO_TEST_URL` 时，普通 `node --test tests/*.test.mjs` 将跳过真实集成测试，跳过不算通过。

离线测试覆盖 multipart 错误、文件签名、上传失败补偿、媒体 Range/授权顺序、草稿读取与并发保存/删除的快照一致性、迁移保留记录及索引查询计划。它们只使用模拟对象或内存 SQLite，不读取真实业务内容。

`node scripts/test-persistence.mjs` 支持相同的 `DIANTUO_TEST_ADMIN_PATH`、`DIANTUO_TEST_ARTIFACT_DIR` 和 `DIANTUO_TEST_URL`，用于同一隔离Worker重启后的三账号、草稿/PNG/PDF哈希和权限验收；每个请求限时15秒，证据写入选定产物目录。未设置时仍读取历史 `.local/` 文件。只使用同一目标数据库的账号与证据，设置步骤见 `architecture/local-runbook.md`。同目录重启通过不等于生产备份恢复演练通过。

## API 契约

错误统一为 `{ error: string, code: string }`。所有写请求必须带同源 `Origin`；浏览器自动附带。业务 API 默认需要有效成员会话，管理员 API 还检查服务器角色。身份和 ownerId 从会话取得。

| 方法与路径 | 输入与响应 |
| --- | --- |
| GET `/api/session` | `{user:null \| {id,name,username,role,bio}}` |
| POST `/api/auth/sign-in/username` | `{username,password}`，设置 HttpOnly 会话 Cookie |
| POST `/api/auth/sign-out` | `{}`，撤销当前会话 |
| POST `/api/auth/change-password` | Better Auth 的 `{currentPassword,newPassword,revokeOtherSessions}` |
| GET/POST `/api/invites` | 管理员；POST `{expiresInHours?}` 返回一次性 `{invite:{id,token,url,expiresAt}}` |
| DELETE `/api/invites/:id` | 管理员撤销尚未消费的邀请 |
| GET `/api/invites/preview?token=...` | 无会话可读取有效邀请期限，不返回创建者信息 |
| POST `/api/invites/accept` | `{token,username,password,name}`，原子创建成员并消费邀请；随后正常登录 |
| GET `/api/members` | 管理员，`{items:[{id,name,username,role,disabled,createdAt}]}` |
| PATCH `/api/members/:id` | 管理员，`{disabled:boolean}`；禁用撤销会话并保护最后一名管理员 |
| GET/POST `/api/circuits` | GET `?q=...&page=1&pageSize=12`，默认每页200、上限200；列表返回 `{items,page,pageSize,total,totalPages,query}`，不含 document；创建 `{title,document,mediaIds?}` 返回 `{circuit}` |
| GET/PUT/DELETE `/api/circuits/:id` | 仅所有者；PUT `{title,document,revision,mediaIds?}`；DELETE `{revision}` |
| POST `/api/circuits/:id/publish` | `{revision,description?}`，返回不可变 `{publication}`，相同版本幂等 |
| GET `/api/publications` | `?filter=mine\|favorites\|liked&q=...&page=1&pageSize=12`；默认不含 document，每页100；`includeDocument=1` 用于画廊预览，默认12、最多24；返回列表及分页字段 |
| GET `/api/publications/:id` | 完整 `{publication}`，含 document、mediaIds、author、赞/收藏状态 |
| POST `/api/publications/:id/fork` | `{}`，创建当前成员的独立私有草稿 |
| POST `/api/publications/:id/like`、`/favorite` | `{active:boolean}`，幂等；DELETE 同路径取消 |
| GET/PATCH `/api/me` | GET `{user,stats,assessments}`；PATCH `{name?,bio?}` |
| POST `/api/media` | multipart 字段 `file`，最大20 MiB；允许 PNG/JPEG/GIF/WebP/PDF/MP4/WebM，检查类型签名；损坏 multipart 返回400 `INVALID_MULTIPART`，不支持的签名返回415；返回 `{media:{id,url,name,type,size}}` |
| GET `/api/media/:id` | 授权后流式读取，支持 Range；PDF 同源 inline 预览 |
| GET `/api/training-projects` | `{items}`，十个项目，无关联的项目始终为 pending |
| PUT `/api/training-projects/:id` | 管理员 `{mediaId,title?,kind?,expectedMediaId?}`，kind为schematic或layout，默认schematic；仅能关联自己上传的 PDF/PNG/JPEG/WebP，最大12 MiB |
| DELETE `/api/training-projects/:id` | 管理员 `{kind?,expectedMediaId?}`，仅解除对应槽关联；两个槽都空时项目回到pending |
| POST `/api/assess` | `{document,lessonId?}`；服务器调用同一引擎计算 `{assessment,id,createdAt,documentHash}` |

保存、删除和发布带最新 `revision`。冲突返回 HTTP 409 `REVISION_CONFLICT`，客户端必须保留当前编辑内容并提示重新载入，不能静默覆盖。草稿读取以单条 SQL 同时取得文档、版本和附件，避免混入并发保存的另一版附件。写入仍使用 `revision` 和随机 `writeId` 将附件修改绑定到同一次成功保存。发布快照在 D1 事务中连同媒体授权复制，后续改动或删除私有草稿不会改变已发布快照。

训练图纸的 `expectedMediaId:null` 表示预期槽为空，字符串表示预期仍关联该媒体；不匹配返回409 `DRAWING_CONFLICT`。为保留旧客户端兼容性，省略该字段仍是无条件修改，新客户端与脚本必须传递预期值以获得并发保护。该条件只比较媒体 ID，不防止同一媒体的并发标题修改。

附件默认仅上传者可读。被发布快照、共享训练图纸或成员自己的草稿明确关联后，按关联授权读取。R2 不提供公开对象地址。十个项目的图纸仅由管理员上传真实文件后变为 uploaded，测试不会保留临时图纸关联。

`/api/bootstrap` 只在用户表为空且一次性本地初始化秘密匹配时创建管理员；注册接口永远关闭。发布到远程需另行配置真实 D1/R2、正式域名和秘密，本地配置未执行远程部署。

## 模块与维护边界

- `api.ts`：认证入口白名单、成员/管理员授权和业务路由；`auth.ts`：Better Auth与当前服务器身份；`registration.ts`：邀请注册、初始化和限流。
- `http.ts`：错误、同源检查、有大小上限的请求读取；`local-origin.ts`：本机/固定HTTPS入口归一化。
- `content.ts`：草稿/发布快照与附件授权；两个`*-list.ts`：有上限的分页和转义搜索；`training-projects.ts`：十课双图关联；`media.ts`：受保护上传及流式下载。
- `db/migrations/`：实际 SQL 迁移，新增迁移不重写旧迁移。`0005`只增加广场赞/收藏计数和发布附件反向查找索引；内存查询计划已验证，真实数据规模下的性能仍需单独测量。已有运行服务复用时不会自动迁移，要在计划内正常重启时应用。

后续优先事项：图纸接口的强制版本契约、上传配额及孤立对象的可恢复清理策略、错误请求ID与不含敏感内容的诊断、完整备份恢复演练。文件签名只校验类型头，不等同于完整解码或恶意内容扫描。原 `server/local-server.mjs` 与 `.local-training/` 是独立历史三维后端，不合并账号和数据。
