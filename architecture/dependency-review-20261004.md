# H08 依赖残余与最小修复候选

核对日期：2026-10-04。范围为当前 `integration/package.json`、`package-lock.json`、此前官方 npm audit JSON、安装包及调用入口的只读审查。没有执行 npm install、audit fix、重新审计 POST、漏洞复现或依赖修改；联网只做公开官方元数据 GET。本报告是方案，不能作为补丁已通过的证据。

**结论：目前没有可确认的、严格满足父依赖版本范围的普通 override 能清除全部 H08。braces 尚无官方已发布修复版本；旧 esbuild 可以评估一个范围很小的覆盖候选，但从 0.18 到 0.25 超出父包范围，必须先做隔离兼容验收。保持当前功能验收的依赖冻结。**

## 证据与计数

审计输入为 [全量审计](integration-acceptance-20261004/dependency-audit-full.json) 和 [生产审计](integration-acceptance-20261004/dependency-audit-production.json)。当前 integration 锁文件与该 feature 冻结快照逐字节相同，SHA-256 均为 `34e3d6779c0933cabf09be2ac797ae367376821d2edc93032d7ad074db474230`。这支持使用此前报表说明当前锁定树，但不是今天重新发送审计请求的结果。

全量报表有 11 个包级条目，7 high、4 moderate；因 fast-glob 有两个安装位置，合计 12 个命中位置。只有两个 `via` 对象是原始 advisory，其余九项是依赖传播的 metavulnerability，不能写成 11 个独立漏洞。npm 文档说明了这种传播及强制改变根范围的修复机制。[npm audit 官方说明](https://docs.npmjs.com/cli/v11/commands/npm-audit/)

本任务生成的可复核附件：`integration-dependency-lock.json` 保存锁定版本、分类、传播及哈希；`integration-dependency-registry.json` 保存公开 npm registry 的 GET 结果；生成脚本分别为 `dependency-lock-evidence.mjs`、`query-dependency-metadata.mjs`，仅向 audit 写证据。

| 审计条目 | 锁定版本 / package-lock 行 | 性质与链 |
|---|---|---|
| braces | 3.0.3 / 5012 | high，原始递归深度漏洞 |
| micromatch | 4.0.8 / 8529 | high，依赖 braces `^3.0.3` 的传播项 |
| fast-glob | 3.3.1 / 6842；3.3.3 / 10698 | high，两处均依赖 micromatch，再到同一 braces |
| @next/eslint-plugin-next | 16.3.8 / 2664 | high，直接 dev → fast-glob 3.3.1 |
| vite-plugin-dynamic-import | 1.6.0 / 10678 | high → 嵌套 fast-glob 3.3.3 |
| vite-plugin-commonjs | 0.10.4 / 10666 | high → dynamic-import 1.6.0 |
| vinext | 1.0.1 / 10546 | high，直接 dev → commonjs 0.10.4 |
| 嵌套 esbuild | 0.18.20 / 1022 | moderate，原始开发服务器 CORS 漏洞，位于 core-utils/node_modules |
| @esbuild-kit/core-utils | 3.3.2 / 658 | moderate → esbuild `~0.18.20`，锁标 devOptional |
| @esbuild-kit/esm-loader | 2.6.5 / 1060 | moderate → core-utils `^3.3.2`，锁标 devOptional |
| drizzle-kit | 0.31.10 / 5659 | moderate，直接 dev → esm-loader `^2.5.5`，锁标 devOptional |

## 原始漏洞和版本事实

**braces：GHSA-vfj7-8cjw-p6xm / CVE-2026-93687，高危。** 公告影响 `<=3.0.3`，深度嵌套 brace pattern 可使递归遍历栈耗尽并终止 Node 进程；GitHub 的 patched versions 为 None。这是新的深度问题，不能把 3.0.3 当作本次修复。[GitHub 原始公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)

公开 npm registry 本轮 GET 的 `dist-tags.latest` 仍为 3.0.3，稳定版本列表没有 3.0.4；上游 master 的 package.json 也为 3.0.3。修复 PR #72 仍 Open，尚不能作为已发布受支持补丁。[官方 registry 元数据](https://registry.npmjs.org/braces)，[上游 package.json](https://github.com/micromatch/braces/blob/master/package.json)，[上游修复 PR](https://github.com/micromatch/braces/pull/72)

**esbuild：GHSA-67mh-4wv8-2f99，中危。** 影响 `<=0.24.2`，首个补丁是 0.25.0；漏洞依赖使用旧 esbuild 的开发服务器，其他网页可读取其响应。[GitHub 原始公告](https://github.com/advisories/GHSA-67mh-4wv8-2f99)

命中的是 core-utils 下的 0.18.20，不是根 esbuild 0.28.1，也不是 drizzle-kit 自带的 0.25.12。0.25.0 的发布说明明确包含不兼容变化，例如 serve 返回值变化；因此不能把跨 0.x 次版本覆盖说成已证实兼容。[esbuild 0.25.0 发布说明](https://github.com/evanw/esbuild/releases/tag/v0.25.0)

上游 core-utils 仓库已归档，最新发布 3.3.2 仍声明 `~0.18.20`。本轮 registry 查到 drizzle-kit 最新 0.31.11 仍保留 esm-loader `^2.5.5`，单独从 0.31.10 更新到 0.31.11 不能据此认定该链消失。[core-utils 官方依赖声明](https://github.com/esbuild-kit/core-utils/blob/master/package.json)，[drizzle-kit 官方 registry 元数据](https://registry.npmjs.org/drizzle-kit)

## 在本项目中的暴露边界

Next 链由 `eslint.config.mjs:3` 导入并在 36 行启用，属于 lint 路径。Vinext 链由 `vite.config.ts:2` 导入、24 行使用；package.json 的 dev/build/start 分别在 9、10、26 行。受影响 glob 解析处理源码、构建及 lint 的 pattern，现行成员站 API 未发现把用户上传图纸或请求参数转交给这些包的路径。这是源码追踪的判断，未做恶意输入或最终产物动态验证；开发/构建路径仍需保留漏洞记录。

生产审计为 4 moderate，不能简单写成“全是 dev，无生产影响”。生产包 better-auth 1.7.6 的可选 peer 在锁文件 4885/4915 行声明 `drizzle-kit >=0.31.4 || >=1.0.0-beta.1` 且 optional，导致 drizzle-kit 工具链带 devOptional 并在 production audit 中保留。**被 production audit 计入不等于线上请求执行了旧 esbuild。**

当前本机入口是 `wrangler.local.jsonc:4` 的 `worker/local.ts`，其第 1 行进入 app/server API；`app/server/auth.ts:1/2/4` 使用 better-auth/minimal、Drizzle adapter、drizzle-orm/d1，静态追踪未发现受影响工具链导入。`scripts/start-local.mjs:51/52/53` 分别用 Wrangler 应用 SQL、独立根 esbuild 构建 UI、启动 local Worker，没有调用 drizzle-kit。`package.json:30` 的 db:generate 和 `drizzle.config.ts:1` 才是候选迁移生成工具路径。

已安装 core-utils/dist/index.js 的 esbuild 调用是 transform/transformSync/version，未见 serve/context/build 调用。其转换接口仍存在于当前官方 API，这是 scoped override 值得做隔离实验的静态依据，不是兼容通过证明。[esbuild 官方转换 API](https://esbuild.github.io/api/#transform)

备选 `worker/index.ts:2/3` 确实引入 Vinext server runtime。对这两个 server 入口的 46 个相对模块追踪未进入加载 commonjs 插件的 vinext/dist/index.js 或 config/next-config.js；但 virtual:vinext-* 生成模块和最终备选 Worker 产物未核查。npm start 的 Vinext CLI 路径也应单独验收，不能套用 local Worker 的结论。

## 最小候选与不采用的方案

| 方案 | 判断 | 后续需要的证明 |
|---|---|---|
| braces 覆盖为 3.0.4 等“patched”版本 | 当前没有对应官方发布，不能执行或声明修复 | 等真实发布后核对公告、registry、包完整性及消费者回归 |
| braces 保持/覆盖为 3.0.3 | 不修本次漏洞 | 保持残余可见，限制构建 pattern 来源；不能靠重复 pin 清零 |
| fast-glob 3.3.1 → 3.3.3；micromatch 保持最新 4.0.8 | 仍走 braces 3.0.3，不能解决本次 high 链 | 不作为 H08 修复；如另有功能理由单独审查 |
| 仅 core-utils 的 esbuild → 0.25.12 | **隔离实验候选**，已发布且超过补丁下限；超出父范围，未证明兼容 | 下面的专项验收、实际锁树和官方新审计 |
| 全局强制 esbuild 为一个版本 | 波及 root 0.28.1、drizzle 0.25.12、tsx 等正常工具，范围过大 | 不作为最小候选 |
| core-utils/esm-loader 别名替换为 tsx 或未发布 fork | 导出/loader 合同及维护来源不同，未证明可替换 | 不纳入本次最小兼容修复 |
| npm audit fix --force | 报表建议根依赖主版本降级，风险大 | 不执行 |

若后续安排隔离实验，建议仅在副本中合并以下 override，保留现有 fflate 项，绝不直接改当前冻结目录：

```json
{
  "overrides": {
    "fflate@>=0.7.0 <0.7.5": "0.7.5",
    "@esbuild-kit/core-utils": {
      "esbuild": "0.25.12"
    }
  }
}
```

0.25.12 已在当前锁中用于 drizzle-kit，可减少新版本变量，但 core-utils 对该版本的兼容仍待验证。npm 支持根级、按父包限定的 override；这不等于库作者支持超出其依赖范围的版本。[npm overrides 官方说明](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides)

官方报表建议 drizzle-kit 0.31.10→0.18.1、Next lint plugin 16.3.8→14.2.35、Vinext 1.0.1→0.0.15，全部 isSemVerMajor=true。其中旧 drizzle-kit 还违反当前 Better Auth 可选 peer 范围。这些是移除传播依赖路径的降级建议，不能冒充原始库的小补丁。

## 候选验收门槛与未验项

1. 独立工作目录和安装树，先记录 package/lock 哈希；只允许新增 scoped override 及对应锁树。确认 0.18.20 和它的旧平台包确实从该链移除，root esbuild 0.28.1 保持原值，补丁 JS API 与平台二进制版本一致。
2. 对 core-utils 实際 transform/transformSync 做 TypeScript、TSX、CJS/ESM、动态 import、import.meta.url、tsconfig paths、source-map 的加载回归，包含本项目最低支持 Node 22.13 和当前 Node 24。只证明 API 名存在不够。
3. 使用新的临时 schema/输出目录验证 drizzle-kit config 加载与 generate；不能写历史 SQL、真实 DB 或共享 .local。检查生成候选的差异，不把 CLI --version 当成功证明。
4. 重跑 lint、类型检查、production/pages/local 构建及相关 schema、backend、release/recovery/browser 检查；对备选 Vinext 入口补最终产物依赖追踪和独立启动验证。
5. 再做官方 full 和 production npm audit，保存 JSON 并检查是否出现新项。即便安装树中旧 esbuild 消失，metavulnerability 计数变化仍以实际新报表为准，不预先承诺减少四项或清零。braces 未发布补丁前，high 链仍应明确保留。

以上安装、候选执行和复测本轮均未开展；当前锁文件、node_modules、源码和正式运行目录未由本任务修改。现有功能/browser/recovery 检查可以继续使用冻结依赖；H08 尚未修复。
