# 电路布局、接线交互与正式发布 · 2026-10-10

按本轮参考图收紧十课新练习和示范布局。用户明确授权“改完之后直接上线”；已完成隔离验收、正式停写备份及恢复核验，并发布到原固定地址 https://train.titleone.space/ 。

## 实现范围

- 电源、按钮、SQ和电机的外部接线统一经过端子排，PE使用同排第5位，取消新模板独立PE排。上下端子同位连通、不同位置保持隔离，保护地误接相线或N仍独立诊断。
- 按原回路中已经相连的外部节点分配位置，不跨触点或负载合并。01至10课分别需要10、11、12、12、14、16、16、11、14、17位；01至09使用16位，10使用20位。这是教学电气节点计数，不代表实物端子的夹线容量。
- FU2输出后的控制支路自动使用黑线，包括先接支路、后接FU2的顺序；手动指定颜色和既有草稿颜色不被自动覆盖。
- 底部三相五线电源的L1、L2、L3、N、PE通过上下镜像显示在电源上方，与排上前五位对应。编辑器提供电源镜像，SQ可旋转90度，历史电源旋转字段继续可读。
- 选中导线有蓝色描边、流动虚线和两端标签，带电仍由独立状态表示；系统减少动态效果设置会关闭流动动画。巡线时取消旧点击接线起点，避免误连。
- 拖线和依次点击A/B均保留。点击起点持续高亮，支持Esc、空白处、选线和运行状态切换时取消。PE位起线使用实例端子的地线颜色；显式手动选色优先。
- 悬浮图纸压缩标题、工具行和留白，图纸占可见浮窗至少75%；缩放、拖动、双图切换、原图和私有授权保留。
- 新布局用于新练习与示范。既有草稿、作品、原图、恢复记录不自动重排或转换。未改写正式20张原始课程PNG。

## 验收

| 检查 | 最终结果 |
| --- | --- |
| typecheck | 通过 |
| lint | 0错误、11警告，未关闭规则 |
| build | 通过 |
| build:pages | 通过，之后重新执行产物测试 |
| Node全量 | 691项：690通过、0失败、1条件跳过 |
| 独立后台 | 25/25通过，临时Worker/D1/R2 |
| Chromium单worker | 85/85通过，0失败、0跳过 |
| 原图 | 双成员读取20张原PNG并核对哈希，匿名拒绝；仅隔离库执行槽位替换用例 |

浏览器覆盖十课运行、缺PE及保护动作，真实拖线与点击接线，移动、缩放、镜像、旋转、保存重载后的世界端点，巡线动画/减少动态效果，反向接入FU2后的黑线，PE默认及手动色，双账号隔离、并发保存、不可变发布、恢复损坏保护、PDF/原图权限及响应式窗口。第一轮发现旧双16位和旧电机端子编号断言，按新独立节点契约更新后重跑；没有降低世界端点、交叉或保护断言。随后补齐选线取消旧起点和PE默认色两个交互边界，再完整重跑。

最终日志在 `.local/feedback-20261010/`：`typecheck.log`、`lint.log`、`build.log`、`build-pages.log`、`node-tests-final.log`、`backend.log`、`browser-release.log`；截图在其`browser-evidence/`。最终浏览器隔离目录为 `C:/Users/admin/AppData/Local/Temp/diantuo-browser-TR2oK9`，不提交账号或私有证据。普通Node条件跳过由独立后台验收覆盖，未计为通过。

lint警告逐条记录：`CourseLibrary.tsx:22`、`DrawingViewer.tsx:96`、`LessonSchematic.tsx:7`、`ReferenceDrawingPicker.tsx:79`、`editor/DeviceArtwork.tsx:25/28/30`和`training/ProjectPanel.tsx:97`为8项图片规则；`reference-video/ReferenceVideoPlayer.tsx:30`为字幕规则；`training/TrainingCanvas.tsx:23`及`training/workspace-api.ts:12`为2项遗留导航规则。20位端子矢量图片增加一项图片警告。

## 正式发布证据

- 发布根目录：`C:/Users/admin/diantuo-production/20261010-compact-wiring-113212`。`release/`直接复制最终Chromium受测包，再验证所有归档哈希；切换前662个源码文件与受测包清单一致。
- release ID：`0ab6c51dd207f23765bd5ca8fe5bffd3d7e1e7c9cc07909d994196739cccac27`；sourceHash：`d69fba83226a328aecf39abb4df90740a5b831637db86d76a28c8bdee0997b91`。构建时Git基线为`8bdebc9d3f0218755dc87cc4b5e872cbdcd50b02`，工作区增量由manifest记录。本交付记录在发布后补写，不修改不可变发布包。
- 维护前重新检查PID、创建时间和脚本归属，只结束源站31892、Tunnel5212、443连接器28624各自进程树。没有按程序名批量结束进程。
- `backup/`包含原state、WAL/SHM、实际运行私有配置和完整`.local`，共1761个文件；受限目录ACL只授予当前用户、SYSTEM和Administrators。`restore-check/`为新的离线空目录，111个state文件字节、SQLite quick_check、外键和业务摘要一致，未运行第二正式数据源站。
- 2026-10-10 11:42:23（UTC+8）切换`.wrangler/active-release.json`，原`E:/vibecoding/电拓智训/.wrangler/state`保持不变。切换前后业务摘要均为`3518051a38bffd4e8d0b9d59f6472d735d7fec278a50914a27aa5ff0c0ea8d48`，涵盖账号、草稿、作品、评估、媒体及图纸等全部业务内容。没有迁移或回填生产数据。
- 启动及匿名验收后再次逐表、逐文件比较：业务表、媒体和文件集合均保持一致；只有观测数据库的`logs`、`spans`增加启动/请求记录，因此包含观测记录的全state摘要会变化。证据为`post-startup-preservation.json`，未将日志变化误记为业务数据丢失。
- 现有桌面入口恢复源站和连接器。本机与固定公网首页、主JS/CSS和20位端子SVG均逐字节匹配发布包。两个入口的页面、会话和同源请求门禁通过；匿名草稿、课程图纸及媒体API返回401。HTTP返回308跳转到原HTTPS域名。
- 公网真实Chromium匿名登录页可见，未捕获页面异常。443连接器`connected`；该次采样备用Tunnel `/ready`为false，未将备用隧道或网络漫游写成通过。主公网经443正常可用。详细证据为发布根目录下`activation-evidence.json`、`live-verification.json`、`maintenance.log`及`production-login.png`。

正式库只做版本、访问和匿名权限核验，没有使用正式账号写测试草稿或发布作品；上述真实成员操作来自同一发布包的隔离验收。未执行实物接线、真实网络切换或长期浸泡。回退必须先检查旧包能否识别最新文档；新增20位端子或镜像字段被保存后，旧包可能拒绝回退，不用旧备份覆盖新数据。

本轮前已有网络修复、桌面启动器及AGENTS/runbook修改均保留，未纳入本轮源码提交。改动前检查点位于`.local/feedback-20261010/prechange/`。
