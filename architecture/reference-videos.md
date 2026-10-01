# 参考图纸教学视频

实现与访问核查日期：2026-09-30。本记录补充 [原站浮窗静态证据](reference-floating-panel.md)；前一轮仅分析公开前端资源，本轮取得了正常登录后 `/diagram/list` 两页响应中的实际 `video_url`，并对这些地址进行了匿名 HTTP 访问检查。两轮证据范围不同。

## 数据与关联边界

清洗后的原始记录保存在忽略提交的 `.local/reference/source-diagrams-response.json`。产品目录位于 `app/simulator/reference-video/catalog.ts`，共 18 条图纸记录，其中 15 条有视频、14 个不同的视频地址；图纸 19 与 20 使用同一地址。图纸 11、12、15 的视频字段为空，界面保留“暂无视频”，不借用其他图纸的视频。

图纸集预览通过精确图纸 ID 关联视频。编辑器浮窗只为以下已经明确对应的旧练习自动关联：

| 练习 ID | 原图纸 ID | 视频状态 |
| --- | --- | --- |
| `motor-jog` | 13 | 有视频 |
| `motor-self-hold` | 14 | 有视频 |
| `lighting-two-way` | 12 | 暂无视频 |
| `lighting-single` | 11 | 暂无视频 |

用户提供的十个正式电机课程 `motor-course-01` 至 `motor-course-10` 没有已确认对应的视频，因此不根据近似名称绑定参考站视频。视频存在也不代表电气规则、用户正式图纸或整站行为已全部对齐。

文档存在上传图、`drawingMediaId`、`trainingProjectId` 或 `projectDrawings` 时，停用旧练习的自动视频关联。用户在浮窗中仅浏览另一正式项目、尚未点击“用于当前练习”时，也通过 `TrainingProjects.onPreviewContextChange` 关闭旧视频资格；待上传图纸的正式项目同样处理。返回无自定义图纸的当前旧练习后才恢复资格。

切换浮窗标签时，接线图子树保持挂载并隐藏，保留正在浏览的项目，避免切到视频时因预览状态丢失而重新关联旧练习。视频本身仅在视频标签打开时挂载。

## 播放与生命周期

图纸集预览和编辑器浮窗共用 `ReferenceVideoPlayer`：

- 使用浏览器原生 `video controls`，提供播放、暂停、进度、音量与浏览器支持的全屏操作；不自动播放。
- 另提供前后 10 秒、0.5 至 2 倍速、错误提示与重新加载。
- 使用 `preload="metadata"`、`playsInline` 和 `crossOrigin="anonymous"`。视频地址来自实际记录；不附加登录 token、账号、请求凭据或代理接口。
- 切换图纸地址、关闭预览、切回接线图或收起浮窗时，播放器卸载并执行 `pause()`、移除 `src`、`load()`，释放当前媒体。React Strict Mode 的 effect 重放会恢复正确地址。
- 无视频时只显示暂无状态，不创建空地址播放器。

静态演示和完整站点都直接请求远程媒体，不打包、不整段下载、不离线缓存视频。因此播放依赖网络和第三方媒体地址持续可访问。浏览器原生控件的具体外观与全屏支持取决于运行环境。

## 已验证内容

访问结果保存在忽略提交的 `.local/reference/video-access-check.json`，未包含账号、密码或登录 token。对实际地址进行 HEAD 和 `Range: bytes=0-31` 请求，并立即取消响应体，没有下载整个视频。

| 检查 | 结果 |
| --- | --- |
| 14 个不同地址的字节范围 GET | 全部返回 206，`Content-Type: video/mp4`，`Content-Range` 为 0–31 字节 |
| HEAD | 13 个首次返回 200；图纸 23 首次 HEAD 超时，但其范围 GET 成功 |
| 携带本地 Origin 的匿名范围请求 | 全部确认 `Access-Control-Allow-Origin: *`；图纸 28、16 首次超时后重试成功 |
| `node --test tests/simulator-reference-video.test.mjs` | 8 项通过 |
| `npm run typecheck` | 通过 |

自动化测试覆盖目录与精确课程关联、私图禁用关联、正式项目浏览上下文回传、跳转边界、实际播放器回调、错误重试、媒体清理与 Strict Mode 重放、图纸集标签、浮窗收起。测试通过受控 React/媒体替身执行组件逻辑，不等于浏览器解码测试。

主任务随后完成浏览器实播：32号视频取得445.52秒元数据、readyState=4，实际播放至15.15秒；暂停后设为1.5倍速并前进10秒，读回25.17秒；后退及关闭卸载成功。截图 `.local/acceptance/reference-video-browser.jpg`，数据在 `layout-gallery-browser.json`。浮窗中旧点动参考视频出现，改为浏览项目06后显示暂无视频、video元素为0，切回图纸仍保持项目06。声音质量、拖动原生进度条、音量、全屏及其他14条图纸视频逐段解码仍未逐项验收，不能用单条播放成功替代全部视频检查。
