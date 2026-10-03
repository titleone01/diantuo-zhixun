# 版本产物、停写备份与恢复

以下工具已经实现并在测试专属环境演练。正式停写、业务库迁移及Tunnel源站切换仍是单独维护操作，不要直接把演练命令套到生产数据。

## 发布与运行目录

发布包包含一次构建的UI、PDF资产、Worker编译入口、迁移、package/lock、runtime.json、manifest.json及目标版本的document-contract.json/document-validator.mjs；运行目录单独保存state、私有配置、注册表、lease与active-release.json。开发源码不作运行入口。

`npm run release -- build --out <全新发布目录>`生成产物；`npm run release -- verify --release <发布目录>`核对清单与SHA-256。记录Git HEAD、工作区摘要、源码哈希、Node版本，构建期间源码变化则拒绝交付。不复制真实.dev.vars、.local或业务数据。哈希检验完整性，不是数字签名；manifest和产物必须放在受控目录。

`npm run start:release -- <运行目录> <loopback端口>`只启动已激活版本，不构建、不迁移、不初始化管理员、不操作Tunnel。运行目录需具备base-config.json、.dev.vars、state与active-release.json。使用当前安装的锁定Wrangler，跨Wrangler版本兼容未被回退演练证明。

运行配置为`no_bundle:false`、`find_additional_modules:false`，仅编译版本包的已打包入口。曾复现旧`no_bundle:true`组合反复出现mid-request restart 503，不能照搬。包被改坏时重新构建新版本，不重写manifest掩盖变化。

本地子进程使用`WRANGLER_HIDE_BANNER=true`关闭版本提示：Wrangler 4.147.0的npm更新检查超时后未取消TLS请求，曾导致迁移全部成功但进程120秒仍未退出。此修复只设置子进程环境，不改全局代理、依赖源码或命令成功判定。

## 停写备份与恢复

核对全部写入者已经停止、本项目PID、loopback地址及lease。备份必须显式`--stopped`、`--origin`、`--lease`；活PID、仍接收请求、连接超时均拒绝。端口检查不能发现其他进程对同一数据库的写入，停写声明是维护人员对整个环境的确认。

下列路径是占位符，替换成明确的本次目录后执行。开发站state在`.wrangler/state/`，新版本运行目录为`state/`，不要混用。

```powershell
npm run release -- backup --state <完整state目录> --out <新备份目录> --stopped --origin http://127.0.0.1:<端口> --lease <runtime-lease.json> --private-config <.dev.vars> --runtime-config <wrangler.json> --private-directory <本次.local或私有运行目录>
npm run release -- restore --backup <备份目录> --out <全新空恢复目录>
```

复制完整D1/R2与WAL/SHM，前后及副本哈希不一致则保留失败副本，不记录成功。私有配置只复制/核验，不输出；private-directory恢复到新目录.local。CLI要求私有配置和运行配置，存在.local时必须同时指定private-directory保存管理员及历史运行记录。历史.local-training与浏览器未保存电路另行原样保存，不在D1/R2中。

工具拒绝非空、符号链接目标，以及备份位于state/私有目录内部、恢复位于原备份内部。恢复先核对离线字节，再检查SQLite quick_check与foreign_key_check。原目录及备份始终保留。

备份含真实秘密，限制访问，不提交Git或上传CI。Windows mode不代替NTFS权限，请放在受控用户目录。临时验收目录也包含测试密码，只有脱敏结果可以分享。

## 保留最新业务状态的代码回退

```powershell
npm run release -- activate --release <已核验目标版本> --runtime <运行目录> --stopped --origin http://127.0.0.1:<端口> --lease <runtime-lease.json>
npm run start:release -- <运行目录> <端口>
```

activate只原子替换代码指针，保留最新state。门禁要求版本的迁移名称集合与已应用集合相同；使用目标产物内的校验器和器件/端子/字段契约，逐条检查circuits草稿及publications不可变作品。损坏文档、未知器件/端子/新增字段或缺契约的旧包均拒绝，指针与业务状态不变。start:release在启动前再次检查，防止激活后其他写入使数据不兼容。

跨schema回退需另行审查，没有强制跳过开关。契约校验不能证明电气算法与视觉行为完全相同，仍需目标版本回归。已经接收用户新写入后，不能用旧备份覆盖业务库；新增FU2、16极端子或导线routing字段的作品存在时，不能切换到不支持这些数据的旧版本。

0006迁移、新API与新页面应在正式维护时一起切换。旧页面/脚本省略expectedVersion会得到428，必须刷新。正式库本轮尚未应用迁移。

## 自动演练与边界

`npm run test:recovery`生成独立版本、随机端口与Worker/D1/R2、测试账号，填充草稿、作品及PNG/PDF；停写备份、空新目录恢复、v2→v1回退，并调用真实start:release入口验证账号、业务内容、附件哈希和权限。它会临时修改**当前隔离开发副本**的worker/local.ts验证不会热加载，finally恢复原字节；禁止与其他Agent在同一源码目录并行运行。

离线恢复核验文件哈希；登录后比较业务内容与附件哈希，不要求整个SQLite/SHM字节不变。合成数据演练不代表真实20图或公网已经验收。

参考[Wrangler官方CLI](https://developers.cloudflare.com/workers/wrangler/commands/)与[Playwright CI说明](https://playwright.dev/docs/ci)。
