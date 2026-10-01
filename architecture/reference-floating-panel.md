# 原站接线图 / 教学视频浮窗证据

核查日期：2026-09-30。目标是记录可追溯的公开前端证据，指导电拓智训的独立实现；本记录不代表两站运行效果已经一致。

## 取证范围与资源

通过 HTTP 读取 [原站公开首页](https://elesim.jcpeixun.com/)，再下载该 HTML 实际引用的 51 个 JS/CSS 资源。没有猜测资源地址，没有登录、读取或保存登录 token，没有请求图纸业务接口，也没有运行下载的源站 JavaScript。只对文本做静态格式化、AST 与 CSS 解析。

原始 HTML 在 `.local/reference/public-index.html`，资源地址与文件清单在 `.local/reference/site-public/manifest.json`，相关模块的静态格式化副本与 `layout-css-evidence.json` 在同一目录。这些是忽略提交的取证缓存。

关键公开资源：

| 资源 | 模块 / 作用 |
| --- | --- |
| [3707 chunk](https://elesim.jcpeixun.com/_next/static/chunks/3707-57a08fe2bcde9a7d.js) | 53707：主浮窗、图纸选择与页面使用位置；49725：图纸接口；62363：视频播放器；1247：Tabs 默认样式 |
| [7523 chunk](https://elesim.jcpeixun.com/_next/static/chunks/7523-c884954beed06182.js) | 21540：拖动、位置重置、整窗缩放 |
| [4846 chunk](https://elesim.jcpeixun.com/_next/static/chunks/4846-38af020397f7eb69.js) | 24733：Card、CardContent、CardFooter 默认样式；30447：Button 尺寸 |
| [5685 chunk](https://elesim.jcpeixun.com/_next/static/chunks/5685-2071c628ecc4d226.js) | 42102：HTTP 客户端与 API base URL |
| [全站 CSS](https://elesim.jcpeixun.com/_next/static/css/68b6e344b7b6db01.css) | 间距、字体断点、浮窗展开/收起动画、缩放原点、组件池动画 |

## 尺寸与分层

原站外层是绝对定位浮窗，右侧与底部各留 `5 × --spacing`，z-index 为 30，transform-origin 为右下角。内层 Card 有圆角、1px 边框与轻阴影；Card 本身没有额外 padding。

CSS 定义 `--spacing: .25rem`。HTML 使用 `text-sm xl:text-base`：通常浏览器默认字号下，1280px 以下根字号为 14px，1280px 起为 16px。下表的 px 数值均按 **16px 根字号、缩放 1** 换算，不是浏览器实测尺寸。

| 区域 | 公开类名 / 默认值 | 换算结果 |
| --- | --- | --- |
| 外层 | `bottom-5 right-5 origin-bottom-right` | 右、下各 20px；整窗以右下角缩放 |
| Header | `p-2 border-b`；内部 TabsList 默认 `h-10`，其 padding 覆盖为 0 | 四边 padding 8px；Tab 行高 40px；Header 约 57px，含分隔线 |
| Content | `py-4 px-8`，覆盖 CardContent 默认 padding | 上下 16px、左右 32px |
| 标题与媒体间距 | TabsContent 默认 `mt-2` | 媒体框上方 8px |
| 图纸 / 视频框 | `w-80 h-56 md:w-100 md:h-64` | md 起 400×256px；md 以下按 80×56 个间距单位 |
| Footer | `px-4 py-2 justify-between` | 上下 8px、左右 16px；左侧选图、右侧缩放 |
| Footer 小按钮 | `size=sm` → `h-9 px-3`；第二个缩放按钮 `ml-2` | 高 36px、左右 padding 12px；两缩放按钮间距 8px |

据此可推导桌面浮窗外宽为 **466px = 400 + 32×2 + 1×2**。源码没有声明固定的整窗高度；标题行、内容、Footer 共同撑开。不要把此推导误写为不同视口下均固定 466px，或直接用上传截图尺寸替代布局规则。

主窗为“接线图 / 教学视频”两个 Tab。图纸来自 Next Image 的 `image_path`，使用固定媒体框与 fill；该调用没有额外声明 `object-fit: contain`。主窗源码中没有独立大图查看控件。

## 拖动、收起和缩放

- **拖动已绑定到主窗。** 模块 53707 将 `dragRef` 放在整个 Card、`targetRef` 放在外层。当存在 `diagram` 查询参数或上传的 `imageUrl` 时，effect 调用 `onDraggable()`。
- 模块 21540 在整个 Card 上监听 pointerdown，并根据 pointerType 使用 pointermove/pointerup 或 touchmove/touchend。拖动开始时读取 getBoundingClientRect 和文档视口宽高，对偏移量作上下左右 clamp，使卡片位于当时的视口边界内。
- 位置与大小通过外层 `translate(offsetX, offsetY) scale(scale)` 实现。没有看到边缘或角部 resize 手柄；解除拖动绑定时会重置偏移和 scale。
- **±缩放整个浮窗**，包含 Header、标题、媒体与 Footer。初始 scale 为 1，步长 0.1，最小 0.5、最大 2；端点按钮禁用。它不是仅缩放图纸。
- **收起保留 Header。** Content 与 Footer 同处 `toggle-animate` 容器；切换 close/open 后，CSS 用 overflow:hidden 和 height 动画折叠这部分。展开为 `.3s ease-in`，收起为 `.3s ease-out forwards`，最终高度为 0。源码使用预设动画高度，不能据此反推所有内容的实际自然高度。

## 图纸与教学视频数据来源

模块 49725 定义 GET `/diagram/list`、`/diagram/:id` 与 `/diagram/stats/categories`；模块 42102 的 API base 是 `https://elesim.qqslyx.com/api`。

浮窗保存 `{id, name, image_path, video_url}`。URL 的 `?diagram=...` 触发图纸详情读取；选图弹窗使用列表接口，每页 9 项，并移除 category/difficulty 过滤参数。上传图片则生成本地记录 `id=-1`，`video_url` 为空。

教学视频 src 直接来自图纸记录的 `video_url`；没有该字段时显示“暂无视频”。播放器包装代码包含 playsInline、播放/暂停/重播、前后跳转 10 秒、进度拖动、播放速度、音量与全屏；此处没有传入 autoplay。

最初只确认前端具备视频Tab。后续已从实际图纸接口取得18条记录（15条有视频），完成匿名访问与32号浏览器实播，详见 `reference-videos.md`；不是所有课题都有视频，也未逐一完成解码及全部控制项验收。

## 电拓智训保留的必要差别与验收边界

1. 工作台底部保留本地**检查按钮**，用于本项目独立电气引擎的诊断与课程评估；原站公开浮窗源码没有对应按钮。浮窗为此预留底部空间，放大时约束内容区高度，保留缩放控件可达性。
2. 本地仅允许通过**标题区域拖动**，并排除按钮等交互元素，避免操作图纸、视频与缩放控件时误拖整窗。这是有意的交互差别；原站拖动监听覆盖整个 Card。
3. 保留原图的**独立大图查看**，供细看用户课程原理图与布局图；该能力与主浮窗整窗缩放分别验收。

后续浏览器验收需确认：初始位置与尺寸、标题拖动边界、收起后 Header 可恢复、整窗缩放端点、检查按钮、图纸大图、无视频状态与真实视频交互。本轮只是公开代码取证，未证明本地运行行为已与原站一致。
