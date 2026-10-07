# 十课收敛与最新原图核对 · 2026-10-07

新建训练只保留点动、连续运行、点动与连续运行、接触器互锁正反转、双重联锁正反转、自动往返、顺序控制、延时起动、Y–△降压起动、双速电机控制。自由接线和元器件百科继续保留。

## 实现与历史保护

- `LESSONS` 仅包含 `motor-course-01` 至 `10`，默认第01课示范；`LEGACY_LESSONS` 独立保留四个早期课程，`getLesson` 和评估继续兼容。
- 课程下拉、图纸集、浮窗入口与 Pages 使用同一十课目录。原站18图、四个基础课不再创建新练习。旧深链不替换工作区。
- 旧草稿、作品、恢复记录、referenceDiagramId 和图片不转换、不重排；打开显示“历史练习”，允许编辑、保存、恢复和评估。
- Pages 显示十张课程卡，支持查看示范和创建练习，提示原图需要成员站权限。私有 PNG 不进入公开构建。
- 公共 API、文档 schema、数据库迁移不变；图纸 PUT/DELETE 的 expectedVersion 保护不变。

## 最新20张原图

来源：用户桌面 `电气控制技术课程图纸10/电气控制技术课程图纸10`。一课一张原理图和一张布置图；文件名、字节数、像素、课程映射与完整 SHA-256 见 [原图清单](course-drawings-2026-10-07.json)。原文件未改写，20张私有副本逐字节核对。此前哈希记录中19张不变，仅第06课布局更新。

06最新布局图为 `自动往返控制电路布局图.png`，756×616，87270字节，SHA-256 `406a681c18ea41c7b5e0090736f1d8f9a75886f78870a57ea61e8b5b0854adbb`，与本次QQ附件相同。现有模板已满足QF/FU1/FU2顶层、KM1/KM2中层、FR下层、底部XT1；右侧竖向XT2、其右SQ1–SQ4竖排、按钮在下方。新增布局关系回归，不为旧文档重新排版。XT1/XT2保持既有16位端子契约，不根据示意圆圈数量减端子。

原理图与模板的静态核对保留以下已确认差异：04/05布局标QS，按原理图采用QF；09原理图只使用SB1/SB2；用户随后在并行对话明确确认，按布置图保留SB3并标为“预留不接线”，不扩展原理图控制功能。本轮按该最新确认集成。07自锁和顺序联锁需要各自独立辅助NO，不共用一组端子。教学示意和原图不冒充厂家实体标定。

## 私有06单槽更新

私有副本位于实施工作树 `.local/ten-courses-20261007/drawings/`。新增配对选项 `--project` 和 `--kind`，单槽导入只要求对应一个PNG；其余槽位不上传、不替换。每次导入先读取当前版本再条件写入，超时仅读回，不自动重试写入。旧媒体继续供历史草稿及不可变作品读取。

```powershell
node scripts/import-training-drawings.mjs --directory "<最新原图私有目录>" --project project-06 --kind layout --replace --url "http://127.0.0.1:<隔离端口>" --admin-file "<本次临时管理员JSON>" --artifact-dir "<本次独立证据目录>"
```

正式更新使用同一命令的原站loopback地址与该环境管理员凭据，并先完成停写备份、恢复验证及新发布包核验。禁止将隔离环境凭据或manifest用于正式环境。

## 两个对话与Git保护

本轮从 `44e7be4` 建立独立工作树及 `codex/ten-courses-only-20261007` 分支。主目录原有领先main的13个提交保留。修改前完整Git bundle位于 `E:/vibecoding/电拓智训备份/ten-courses-20261007/before-ten-courses.bundle`，`git bundle verify`通过，SHA-256 `689FFAEBFCDF3640E2316276A87508C421D8FB5C394EE819173D37F8094971DC`。

另一对话“增加端子排上下互通接线”负责主目录、端子/走线及其器件显示修复；本轮在独立树修改课程入口和相关验收。先只读复制14个声明范围的修复文件并记录SHA-256，在独立树回归；再纳入对方正式提交 `4c29aeb`，核对应用/脚本/测试/Pages与已验收快照一致。该对话完成、主目录干净后才合并main和切换正式服务，同时纳入其交付记录 `24e3410`。构建与隔离服务使用本轮目录；正式唯一state和Tunnel保留。最新用户授权已包含直接上线。

## 验证与交付状态

阶段验收已完成：typecheck、lint（0错误）、build、build:pages通过；Node 625通过、0失败、1条件跳过（后台组另行执行），隔离真实后台25/25通过。十课入口、四种历史草稿的原文档/服务端评估/保存/旧深链恢复，以及实际 Pages 无私有API请求等6项浏览器用例通过。单槽隔离验收确认19槽不变、缺版本428、过期409、成员写入403、旧作品与旧媒体仍可读取。证据位于 `.local/ten-courses-20261007/` 和 `.local/acceptance-public/`，含凭据的临时运行目录不公开。

首次浏览器旧深链用例误用了18（参考图数量）作为ID，实际属于无效链接，未出现有效入口停用提示；改为已有ID32后4种历史课程均通过。最初lint发现本轮3处问题（effect内同步setState、未使用兼容参数、测试变量module），均修复后重跑通过；不关闭规则。

剩余10条既有lint警告逐条保留：CourseLibrary图片、DrawingViewer图片、LessonSchematic图片、历史ReferenceDrawingPicker图片、DeviceArtwork两处图片、ReferenceVideoPlayer字幕、旧3D ProjectPanel图片、TrainingCanvas导航、workspace-api导航。

最终集成验收已按规定顺序通过：

| 检查 | 本轮结果 |
| --- | --- |
| typecheck | 通过 |
| lint | 0错误，10条已列警告 |
| build、build:pages | 均通过 |
| Node全量 | 630通过、0失败、1条件跳过（隔离后台另行执行） |
| 隔离后台 | 25通过、0失败、0跳过 |
| Chromium单worker | 77通过、0失败、0跳过，含十课正常/错误/保护动作、真实拖线、移动/旋转/缩放/保存重载端点、双账号隔离、20原图权限、历史恢复与Pages |
| 20图映射与06单槽替换 | 全部SHA-256匹配；19槽保持；428/409/403与旧媒体/作品快照保留通过 |
| Pages私有原图隔离 | 17张公开PNG中无任何私有原图哈希；自动回归通过 |
| Schema与恢复回退 | 14表/6迁移匹配；独立账号、草稿、作品、附件与权限、最新state回退及真实start:release入口演练通过 |

第一次全量浏览器检查有3项旧页签定位超时，改为十课入口和双图弹窗后相关7项及最终77项全部通过。并行提交只有两处集成冲突：生成的Pages入口及浏览器runner；保留已验收十课产物，runner同时保留原图预核验、静态Pages、历史草稿与单槽替换验收。未改变应用功能源码。历史报告不改写为本次结果。

真实物理接线和长期容量浸泡不属于本轮已执行验收。

## main与正式上线

2026-10-07 14:31（Asia/Shanghai）已启动十课正式发布包，继续使用 `https://train.titleone.space/`、loopback 3000、原 `.wrangler/state`、原私有配置和原Tunnel。没有新建源站、业务库或域名。当前发布ID为 `c8b22ffd73886d773d46c4c38b424d4c718619e2b02311f83835c301c8eba3a7`，不可变产物在 `C:/Users/admin/diantuo-production/20261007-ten-courses/release`。包源码为 `b9f470e`；随后main集成 `11ba5e7` 只追加另一对话的交付文档，应用/脚本/媒体/Pages均无差异。本节后续CI修复只调整测试的换行兼容，不修改运行代码和产物。

- 主目录main与origin/main首次推送均为 `11ba5e77596305586d1eaaf9d24f42d320af28ae`；`44e7be4`及另一对话 `24e3410` 均已验证为祖先，完整保留此前13个提交。合并后再次保存并验证 `E:/vibecoding/电拓智训备份/ten-courses-20261007/merged-before-production.bundle`，SHA-256 `397E760C0F191BCF2FD94778A910462CB49E8584943729D9E73713EF37A2986B`。
- 停写前核对原发布指针、lease、父子PID及唯一3000监听；只停止原发布主管41736及其子进程，Tunnel及其他对话/项目进程保持。启动时工具策略拒绝后台启动命令，改用工具托管终端会话65572启动同一 `start-release.mjs`。新主管7416、Wrangler33288、3000监听22624；启动记录在本次私有 `service-launch.json`。
- 停写完整备份在上述发布目录的 `backup/`，包含原state全部D1/R2及WAL/SHM、私有运行配置和完整 `.local`；恢复到独立空 `restore-check/`，111个state文件逐字节核验、SQLite quick_check/foreign_key_check和业务行哈希全部通过。原正式目录未被恢复副本覆盖。
- 上线后既有42个账号、57份草稿、46个作品、315条评测、87条媒体及87份原对象全部保留；既有业务行和其他19图槽位的哈希未变。登录核验使用该正式环境已有管理员，未创建测试账号/草稿/作品。
- 正式20图导入预核验全部与最新原PNG相同：0上传、20保留。06单槽命令亦为0上传、1保留，因为另一对话已经恢复原图并导入了本次06最新版；没有再次换图或推进槽版本。现有20槽与源目录完整SHA-256相符，旧媒体仍存在。
- 本机与公网 `/`、`app-L32AAIHR.js`、`app-2RFUTYXP.css` 全部200且逐资源SHA-256与发布包一致；会话200且匿名user为空，两处各22个业务/私有图片匿名请求401，Tunnel `/ready` 200。真实公网匿名Chromium登录页渲染，无页面错误。
- GitHub Pages 已部署本轮 `index-UP74BPN4.js` / `index-YNE72MNM.css`。远端HTML仅Git换行不同，统一LF后SHA-256相等；JS/CSS字节一致。真实远端Chromium确认十个课程选项、十张课程卡、第06课示范65条线、0私有API请求、0页面错误。成员原图仍只在受权限保护的成员站读取。

本次受限目录中的 `business-before.json`、`business-restored.json`、`business-after.json`、`production-smoke.json`、`pages-smoke.json`、`drawing-verify/`、`drawing-import/` 保存完整交付证据。含私有配置的backup/恢复副本不得公开。

## 远端CI修复

首次main的Pages工作流成功；[Project checks 37581223225](https://github.com/titleone01/diantuo-zhixun/actions/runs/37581223225) 在Linux Node阶段为629通过、1失败、1条件跳过。唯一失败是辅助NO资产记录原始CRLF SVG哈希，而Linux checkout将原SVG改为LF。修正测试以两种换行编码验证同一来源，仍保留原路径、尺寸、螺丝、NO文字及不得夹带其他触点的全部结构断言；原SVG和图纸不改写。独立LF/CRLF副本均通过，随后本机全量重新为630通过、0失败、1条件跳过。修复及本次交付文档继续提交main并推送；最终远端状态以对应GitHub Actions运行结果为准。
