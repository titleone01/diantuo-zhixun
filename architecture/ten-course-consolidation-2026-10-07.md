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

另一对话“增加端子排上下互通接线”负责主目录、端子/走线及其器件显示修复；本轮在独立树修改课程入口和相关验收。仅在对话结束、主目录干净后集成其最新提交，再合并main、推送与切换正式服务。构建与隔离服务使用本轮目录；正式唯一state和Tunnel保留。最新用户授权已包含直接上线。

## 验证与交付状态

阶段验收已完成：typecheck、lint（0错误）、build、build:pages通过；Node 625通过、0失败、1条件跳过（后台组另行执行），隔离真实后台25/25通过。十课入口、四种历史草稿的原文档/服务端评估/保存/旧深链恢复，以及实际 Pages 无私有API请求等6项浏览器用例通过。单槽隔离验收确认19槽不变、缺版本428、过期409、成员写入403、旧作品与旧媒体仍可读取。证据位于 `.local/ten-courses-20261007/` 和 `.local/acceptance-public/`，含凭据的临时运行目录不公开。

首次浏览器旧深链用例误用了18（参考图数量）作为ID，实际属于无效链接，未出现有效入口停用提示；改为已有ID32后4种历史课程均通过。最初lint发现本轮3处问题（effect内同步setState、未使用兼容参数、测试变量module），均修复后重跑通过；不关闭规则。

剩余10条既有lint警告逐条保留：CourseLibrary图片、DrawingViewer图片、LessonSchematic图片、历史ReferenceDrawingPicker图片、DeviceArtwork两处图片、ReferenceVideoPlayer字幕、旧3D ProjectPanel图片、TrainingCanvas导航、workspace-api导航。

最终集成验收进行中：纳入另一对话最新器件/布局修复后按 typecheck → lint → build → build:pages → Node全量 → 隔离后台 → 浏览器执行，再记录main/远端/CI与正式发布、数据保留证据。历史报告不改写为本次结果。
