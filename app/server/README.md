# 成员站后端

业务路由共用 `handleApi`：vinext 入口为 `app/api/[...path]/route.ts`，直接 Worker 本地入口为 `worker/local.ts`。Better Auth 负责密码校验、Cookie 和会话；Drizzle 定义认证表；D1 保存业务数据；R2 保存私有附件。

## 本地初始化

```powershell
node scripts/bootstrap-admin.mjs --prepare
npx wrangler d1 migrations apply DB --local --config wrangler.local.jsonc
npx wrangler dev --config wrangler.local.jsonc --ip 127.0.0.1 --port 3000 --persist-to .wrangler/state
```

直接 Worker 需要先生成 `.local/app/index.html` 和前端资源。它与 vinext 使用同一份 D1/R2 本地状态。服务启动后，在另一个终端执行：

```powershell
node scripts/bootstrap-admin.mjs
node scripts/test-multiuser.mjs
```

管理员随机密码只保存在忽略提交的 `.local/admin-access.json`。成员测试账号只保存在 `.local/test-accounts.json`。`--prepare` 只补充缺失秘密，不覆盖已有秘密。默认地址为 `http://localhost:3000`，修改地址时需要同步 `.dev.vars` 的 `APP_ORIGIN`。

重启 Worker 后执行 `node scripts/test-persistence.mjs`，会重新验证三个账号登录、草稿和 PNG/PDF 的 SHA-256、另一成员对私有草稿的拒绝访问。证据保存在 `.local/backend-acceptance.json` 和 `.local/persistence-acceptance.json`。

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
| GET/POST `/api/circuits` | 列表 `{items}` 不含 document；创建 `{title,document,mediaIds?}` 返回 `{circuit}` |
| GET/PUT/DELETE `/api/circuits/:id` | 仅所有者；PUT `{title,document,revision,mediaIds?}`；DELETE `{revision}` |
| POST `/api/circuits/:id/publish` | `{revision,description?}`，返回不可变 `{publication}`，相同版本幂等 |
| GET `/api/publications` | 成员广场，`?filter=mine\|favorites\|liked&q=...`；列表不含 document |
| GET `/api/publications/:id` | 完整 `{publication}`，含 document、mediaIds、author、赞/收藏状态 |
| POST `/api/publications/:id/fork` | `{}`，创建当前成员的独立私有草稿 |
| POST `/api/publications/:id/like`、`/favorite` | `{active:boolean}`，幂等；DELETE 同路径取消 |
| GET/PATCH `/api/me` | GET `{user,stats,assessments}`；PATCH `{name?,bio?}` |
| POST `/api/media` | multipart 字段 `file`，最大 20 MiB，返回 `{media:{id,url,name,type,size}}` |
| GET `/api/media/:id` | 授权后流式读取，支持 Range；PDF 同源 inline 预览 |
| GET `/api/training-projects` | `{items}`，十个项目，无关联的项目始终为 pending |
| PUT `/api/training-projects/:id` | 管理员 `{mediaId,title?}`，仅能关联自己上传的 PDF/PNG/JPEG/WebP，最大 12 MiB |
| DELETE `/api/training-projects/:id` | 管理员解除图纸关联，项目回到 pending |
| POST `/api/assess` | `{document,lessonId?}`；服务器调用同一引擎计算 `{assessment,id,createdAt,documentHash}` |

保存、删除和发布带最新 `revision`。冲突返回 HTTP 409 `REVISION_CONFLICT`，客户端必须保留当前编辑内容并提示重新载入，不能静默覆盖。快照在 D1 事务中连同媒体授权复制，后续改动或删除私有草稿不会改变已发布快照。

附件默认仅上传者可读。被发布快照、共享训练图纸或成员自己的草稿明确关联后，按关联授权读取。R2 不提供公开对象地址。十个项目的图纸仅由管理员上传真实文件后变为 uploaded，测试不会保留临时图纸关联。

`/api/bootstrap` 只在用户表为空且一次性本地初始化秘密匹配时创建管理员；注册接口永远关闭。发布到远程需另行配置真实 D1/R2、正式域名和秘密，本地配置未执行远程部署。
