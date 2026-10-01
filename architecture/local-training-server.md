# 局域网账号与图纸服务

`server/local-server.mjs` 使用 Node.js 内建 HTTP、SQLite 和密码学模块，不需要新增依赖。建议使用本次实际验证的 Node.js 24。它服务 `pages-dist/` 的站点文件，并在返回 HTML、JavaScript、GLB 和图纸字节前校验登录会话。

## 首次启动

先生成以 `/` 为资源根路径的 `pages-dist/`。GitHub Pages 的项目子路径构建不能直接作为该服务的根路径构建。

在项目根目录打开 PowerShell：

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
node server/local-server.mjs
```

在服务器本机打开 `http://127.0.0.1:3000/login`，自行设置管理员账号和密码。没有默认密码；密码至少 10 个字符。首次设置同时检查连接来自 loopback、Host 为本机地址以及同源表单校验。

管理员设置完成后，停止原进程，再开放局域网：

```powershell
$env:HOST = '0.0.0.0'
$env:PORT = '3000'
node server/local-server.mjs
```

客户端使用 `http://服务器局域网地址:3000/login`。首次未设置管理员时，`HOST=0.0.0.0` 会拒绝启动，避免由局域网访客抢先创建管理员。Windows 防火墙应由部署者按实际局域网范围开放对应端口。物理客户端连通性需在实际网络上验收。

## 数据与权限

- 默认数据库位于 `.local-training/training.sqlite`。账号、加盐 scrypt 密码摘要、会话和上传图纸存放在其中。`DATA_DIR` 可指定其他数据目录，`STATIC_DIR` 可指定静态站点目录。
- 停服后备份整个数据目录；SQLite 运行期间可能存在 `-wal`、`-shm` 文件，不能仅复制主数据库就假定备份完整。
- 管理员可以创建学员、停用/恢复学员以及上传图纸。账号创建接口固定创建 `student`，不能由请求指定管理员角色。
- 学员只能读取项目及图纸。停用立即删除学员会话；重新启用不恢复旧会话。
- 图纸每项目一份，支持 PDF/PNG/JPEG，单文件上限 12 MiB，并同时验证 MIME 与文件签名。重新上传替换当前版本；当前实现不保存图纸版本历史。
- 会话有效期为 12 小时，Cookie 使用 HttpOnly、SameSite=Strict；请求本身为 TLS 时增加 Secure。当前独立 HTTP 入口用于受控局域网；跨不可信网络使用时需要配置 HTTPS，不能把“有登录”理解成“传输已加密”。服务不信任代理传入的 `X-Forwarded-*` 头。
- 所有写操作要求同源 Origin 与会话 CSRF Token；登录和首次设置使用 `/login` 生成的短期表单校验。API 不提供开放 CORS。
- 登录前访问应用文件跳转 `/login`；登录前访问业务 API 返回 `401`。错误响应不会返回账号密码摘要或服务器绝对路径。

## 前端接口

项目目录从 `shared/training-projects.json` 读取，固定 `project-01` 至 `project-10`。列表中 `simulation` 为 `dol` 或 `pending`；缺图纸返回 `drawing: null`。

| 接口 | 权限/作用 |
| --- | --- |
| `GET /api/session` | 已登录；返回 `{ user: { id, username, role }, csrfToken }` |
| `GET /api/projects` | 已登录；返回 `{ projects }`，含图纸名称、MIME、大小和更新时间 |
| `GET /api/projects/:id/drawing` | 已登录；读取图纸字节 |
| `PUT /api/projects/:id/drawing` | 管理员；原始文件字节，`Content-Type` 指定文件类型，`X-File-Name` 为 `encodeURIComponent(filename)` |
| `GET /api/accounts` | 管理员；返回 `{ accounts: [{ id, username, role, disabled }] }` |
| `POST /api/accounts` | 管理员；`{ username, password }` 创建学员 |
| `PATCH /api/accounts/:id` | 管理员；`{ disabled: boolean }` 修改学员状态 |
| `POST /api/logout` | 已登录；撤销当前会话 |

所有写接口加 `X-CSRF-Token`。登录使用服务器提供的 `/login` 表单，其表单目标为 `POST /api/login` 或首次 `POST /api/setup`；前端无需另行实现登录页。

## 已完成的验证

`node --test tests/local-server.test.mjs` 使用临时目录和随机端口完成 11 项真实 HTTP 检查，覆盖匿名 HTML/JS/GLB/图纸访问拦截、首次 Host 限制、管理员/学员权限、CSRF 与跨源拒绝、非 ASCII 伪造 CSRF 拒绝、并发登录限流、GLB 解码需要的 WebAssembly CSP、文件类型及大小限制、停用撤销、退出登录、重启持久化与密码不以明文保存。临时数据在测试结束后删除，不创建生产管理员。

这些测试不等于实际机房设备、防火墙、HTTPS 配置或多人容量已经验收。
