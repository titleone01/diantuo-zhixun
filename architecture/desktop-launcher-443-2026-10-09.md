# 桌面完整启动与网络恢复验收 2026-10-09

用户要求桌面一键入口在不同网络下完整启动现有成员站。修复前，桌面脚本仅启动本机源站和旧Tunnel，并在旧Tunnel就绪前等待最多90秒；它不启动已接入原域名的新443连接器。这会把旧Tunnel故障误报为整个启动流程失败。

## 当前启动方式

桌面“启动电拓智训”及Windows登录启动项统一调用`scripts/start-desktop.ps1`。桌面打开本机网页并显示检查结果，登录启动使用`-NoOpen -NoDialog`。旧私有登录包装脚本保留为兼容入口并转调同一脚本。

`scripts/desktop-services.mjs`检查公开启动配置及加密凭据文件存在性，不读取凭据明文。源站未运行时通过`start-release.mjs`启动`.wrangler/active-release.json`指定的不可变产物及原state；不构建、迁移、初始化新库或管理员。已有3000监听但页面、会话或同源检查失败时保留现有进程并报错。

源站就绪后先启动或复用443连接器，再处理备用Tunnel，不以旧Tunnel健康状态作为443启动前提。项目启动Mutex协调桌面和登录入口，连接器和Tunnel的命名管道锁识别正在等待网络的进程。重复启动复用健康或暂时离线的owner。网页提示完成后释放启动锁，避免结果对话框一直挡住后续启动。

短时间不能访问公网时，返回`waiting-for-public-access`及`publicReady:false`，保留后台连接器等待恢复；不会把暂时断网写成公网已可用，也不会要求再次双击才能重连。网络切换逻辑沿用当前连接器的动态网卡、可信DNS、现有loopback代理及TLS验证，不改变系统DNS、代理或防火墙。

## 已执行的验收

- Windows PowerShell真实启动脚本及中文路径、同时启动防重回归通过；桌面流程14项（含现有3项站点就绪检查）全部通过。
- 443自适应网络5项通过，包括物理路径失败选用代理、网卡/代理变化先关闭旧连接、临时检测失败保留工作连接、初始离线后恢复连接及拒绝fake-IP。
- 20:58调用桌面脚本：本机页面、会话及同源请求正常，443 owner为connected，原域名检查通过，`started:[]`，复用所有进程。
- 21:00核验已知自有443进程PID52508的脚本路径及创建时间、备用Tunnel健康后，仅停止该连接器；桌面脚本自动启动新连接器PID28624，`started:["relay"]`。启动检查最初返回等待状态；随后21:00:21连接器日志确认connected/system，独立公网页面、会话及同源请求全部通过。未结束业务源站或其他Node进程。
- 21:02调用旧登录包装入口：原域名检查通过、`started:[]`，源站PID17420及443 PID28624继续复用。
- 已更新原桌面快捷方式，并把现有登录快捷方式改为直接调用公共脚本；已通过保存的登录快捷方式实际执行。原启动文件、公开配置及两个快捷方式备份在`.local/desktop-launcher/backup-20261009/`。
- 启动前后`.wrangler/active-release.json`的SHA-256保持`714AB64D9C4D85FCD091C52600B80621B9060EC26C90AC535674064608BCA4B9`。源站监听始终为`127.0.0.1:3000`，业务state、成员和原图纸未迁移。

最终项目检查及现场复核结果保存在`.local/desktop-launcher/validation-20261009/`和`acceptance-20261009.json`，以实际日志为准。

21:04–21:05按项目顺序完成`npm run typecheck`、`npm run lint`、`npm run build`、`npm run build:pages`、`node --test tests/*.test.mjs`及`npm run test:backend`，全部退出0。Node回归672通过、1跳过；跳过项为需要独立临时后台的D1/R2套件，随后在`test:backend`实际执行25项并全部通过。Pages产物测试在构建后执行；仅生成本地产物，未发布Pages。

lint为0错误、10条已有警告，未全局关闭规则。逐条为`CourseLibrary.tsx:22`、`DrawingViewer.tsx:95`、`LessonSchematic.tsx:7`、`ReferenceDrawingPicker.tsx:79`、`DeviceArtwork.tsx:24`及`:26`、`ProjectPanel.tsx:97`的图片规则；`ReferenceVideoPlayer.tsx:30`的字幕规则；`TrainingCanvas.tsx:23`及`workspace-api.ts:12`的遗留导航规则。

21:07三次原域名页面、会话及同源检查均正常，443 owner持续connected，发布指针哈希保持一致。这是短时间现场观察，不代替长时间稳定性验收。

## 验收边界

本次没有注销或重启Windows，没有人为切换真实机场、国内直连、手机热点或物理路由器，也没有关闭网卡测试。网络变更和初始离线属于注入故障回归；现场验收是当前网络下启动、自动建立443及公网功能检查。源站从完全关闭状态的现场冷启动、所有十课浏览器功能及长时间稳定性仍未执行。

电脑必须开机、已登录Windows、联网且不休眠；不要移动项目或删除私有转发程序、加密凭据和原state。采用当前免费公网转发入口，能访问互联网并不保证能访问该入口，无法承诺所有运营商或机场节点永远可用。后续验收应记录具体网络、启动日志和另一台电脑的登录/训练/保存结果。
