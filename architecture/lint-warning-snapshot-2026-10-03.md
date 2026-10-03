# lint最终合并副本快照

更新于2026-10-04：0错误、11警告。初始加固副本39错误/18警告保留为历史计数，共享UI修复后已重新执行全仓检查；没有全局关闭Hooks或无障碍规则。

| 位置 | 规则 | 处置说明 |
|---|---|---|
| app/simulator/CourseLibrary.tsx:20 | @next/next/no-img-element | 原生SVG/图纸沿用现有加载方式；涉及私有媒体时须验证会话、缓存与尺寸，未为消警告替换图片链路。 |
| app/simulator/DrawingViewer.tsx:95 | @next/next/no-img-element | 原生SVG/图纸沿用现有加载方式；涉及私有媒体时须验证会话、缓存与尺寸，未为消警告替换图片链路。 |
| app/simulator/LessonSchematic.tsx:7 | @next/next/no-img-element | 原生SVG/图纸沿用现有加载方式；涉及私有媒体时须验证会话、缓存与尺寸，未为消警告替换图片链路。 |
| app/simulator/ReferenceDrawingPicker.tsx:79 | @next/next/no-img-element | 原生SVG/图纸沿用现有加载方式；涉及私有媒体时须验证会话、缓存与尺寸，未为消警告替换图片链路。 |
| app/simulator/ReferenceDrawings.tsx:19 | @next/next/no-img-element | 原生SVG/图纸沿用现有加载方式；涉及私有媒体时须验证会话、缓存与尺寸，未为消警告替换图片链路。 |
| app/simulator/editor/DeviceArtwork.tsx:20 | @next/next/no-img-element | 原生SVG/图纸沿用现有加载方式；涉及私有媒体时须验证会话、缓存与尺寸，未为消警告替换图片链路。 |
| app/simulator/editor/DeviceArtwork.tsx:24 | @next/next/no-img-element | 原生SVG/图纸沿用现有加载方式；涉及私有媒体时须验证会话、缓存与尺寸，未为消警告替换图片链路。 |
| app/simulator/reference-video/ReferenceVideoPlayer.tsx:30 | jsx-a11y/media-has-caption | 上游没有已核验字幕文件，保留警告；不伪造空track作为通过。 |
| app/training/ProjectPanel.tsx:97 | @next/next/no-img-element | 原生SVG/图纸沿用现有加载方式；涉及私有媒体时须验证会话、缓存与尺寸，未为消警告替换图片链路。 |
| app/training/TrainingCanvas.tsx:23 | @next/next/no-location-assign-relative-destination | 历史独立服务器需要完整页面导航保留认证行为；不能直接套用二维客户端路由。 |
| app/training/workspace-api.ts:12 | @next/next/no-location-assign-relative-destination | 历史独立服务器需要完整页面导航保留认证行为；不能直接套用二维客户端路由。 |

执行：npm run lint；行号随后续修改可能变化，接手时重新运行。
