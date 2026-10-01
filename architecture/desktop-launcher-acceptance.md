# 桌面启动器验收（2026-09-30）

用户要求电脑重启后双击启动，并继续使用已经配置的互联网固定网址。桌面创建 `启动电拓智训.lnk`，调用 Windows PowerShell 的 `scripts/start-desktop.ps1`。路径及工作目录已回读核对，脚本使用UTF-8 BOM兼容Windows PowerShell 5.1。

## 实际验证

- 已有服务状态：本机API、隧道ready与固定HTTPS API全部通过；没有重复启动。
- 冷启动：按PID、子进程项目路径和专属cloudflared路径核实所有权后停止原两组服务，再运行与快捷方式相同的脚本（测试加`-NoOpen -NoDialog`）。新的本机服务和隧道均启动，管理员初始化校验成功，固定网址`https://train.titleone.space/api/session`返回正确会话结构。
- 再次运行：启动器PID列表前后相同（41244、41656），仍成功，不重复创建后台进程。
- 使用操作系统互斥锁阻止同项目并发启动；错误通过提示框与`.local/desktop-launcher/`日志报告，不按进程名或端口强制结束未知进程。
- `launcher-typecheck.log`、`launcher-build.log`、`launcher-pages.log`均成功。生成产物后`launcher-tests.log`共345项，344通过、0失败、1后台组跳过；`launcher-diff-check.log`通过。

## 证据边界

本次没有实际关机重启电脑，没有自动操作桌面提示框；使用真实脚本的无提示框模式验证服务停止后的启动和重复启动。启动后其他物理设备访问结果沿用既有互联网部署记录，没有宣称本次新增第二台设备测试。公网检查来自本机HTTPS请求。

未添加开机自动运行项、未放行局域网端口或调整防火墙。关闭浏览器不关闭后台进程；关机、休眠或断网会使网页不可用，恢复后可再次双击快捷方式。
