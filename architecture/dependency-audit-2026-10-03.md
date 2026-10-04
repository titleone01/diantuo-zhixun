# 依赖审计台账（2026-10-03）

截至2026-10-04：基线重新核验25项，18 high、6 moderate、1 low。此前19项为历史结果；第一次兼容升级14项/7 high为中间结果。补入fflate 0.7.5后当前安装11项，7 high、4 moderate、无critical。npm计数包括传播风险的父包，不等于11个独立漏洞。`npm audit --omit=dev`仍有4项moderate（better-auth的可选peer使Drizzle CLI链进入npm生产树）；不能声称生产依赖零风险。

没有运行强制升级、自动降级或legacy-peer-deps。Wrangler仍4.x、vinext仍1.x；直接编译依赖workers-types升级5.x是新版Wrangler的peer要求。Wrangler/vite-plugin同时带入间接Miniflare 5.20261001.0-alpha，需要保留本机代理偶发500的验证风险，不能因审计条目消除就声称运行稳定。删除未使用的eslint-config-next，直接声明现有配置实际导入的@next/eslint-plugin-next，保留React Hooks和无障碍规则。

## 初始25项逐条处置

| 包 | 级别 | 基线实际版本 | 当前实际版本 | 处置与影响路径 |
|---|---|---|---|---|
| @babel/core | low | 7.29.0 | 7.29.7 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| @cloudflare/vite-plugin | high | 1.37.1 | 1.62.5 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| @esbuild-kit/core-utils | moderate | 3.3.2 | 3.3.2 | 保留：Drizzle CLI → @esbuild-kit → esbuild 0.18.20。见下方暴露范围；审计建议降级不执行。 |
| @esbuild-kit/esm-loader | moderate | 2.6.5 | 2.6.5 | 保留：Drizzle CLI → @esbuild-kit → esbuild 0.18.20。见下方暴露范围；审计建议降级不执行。 |
| @next/eslint-plugin-next | high | 16.2.6 | 16.3.8 | 保留：@next/eslint-plugin-next / vinext 构建插件 → fast-glob → micromatch → braces 3.0.3。见下方暴露范围；审计建议降级不执行。 |
| baseline-browser-mapping | moderate | 2.10.30 | 2.11.27 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| brace-expansion | high | 5.0.6, 1.1.14 | 5.0.12, 1.1.21 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| braces | high | 3.0.3 | 3.0.3 | 保留：@next/eslint-plugin-next / vinext 构建插件 → fast-glob → micromatch → braces 3.0.3。见下方暴露范围；审计建议降级不执行。 |
| browserslist | high | 4.28.2 | 4.29.3 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| drizzle-kit | moderate | 0.31.10 | 0.31.10 | 保留：Drizzle CLI → @esbuild-kit → esbuild 0.18.20。见下方暴露范围；审计建议降级不执行。 |
| esbuild | moderate | 0.18.20, 0.27.3 | 0.18.20、0.25.12、0.28.1 | 保留旧0.18.20：Drizzle CLI → @esbuild-kit。直接构建版本0.28.1不受此条公告影响；审计建议降级不执行。 |
| fast-glob | high | 3.3.1, 3.3.3 | 3.3.1, 3.3.3 | 保留：@next/eslint-plugin-next / vinext 构建插件 → fast-glob → micromatch → braces 3.0.3。见下方暴露范围；审计建议降级不执行。 |
| fast-uri | high | 3.1.2 | 3.1.8 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| fflate | moderate | 0.7.4 | 0.6.11、0.7.5、0.8.3 | 已消除：satori固定0.7.3，以窄范围override修到官方同分支0.7.5；三维0.6.11及types0.8.3保持不变。 |
| image-size | high | 2.0.2 | 已移除 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| js-yaml | high | 4.1.1 | 4.3.2 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| micromatch | high | 4.0.8 | 4.0.8 | 保留：@next/eslint-plugin-next / vinext 构建插件 → fast-glob → micromatch → braces 3.0.3。见下方暴露范围；审计建议降级不执行。 |
| miniflare | high | 4.20260515.0 | 5.20261001.0-alpha | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| sharp | high | 0.34.5 | 0.35.4 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| undici | high | 7.24.8 | 7.29.1 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| vinext | high | 1.0.0-beta.2 | 1.0.1 | 保留：@next/eslint-plugin-next / vinext 构建插件 → fast-glob → micromatch → braces 3.0.3。见下方暴露范围；审计建议降级不执行。 |
| vite-plugin-commonjs | high | 0.10.4 | 0.10.4 | 保留：@next/eslint-plugin-next / vinext 构建插件 → fast-glob → micromatch → braces 3.0.3。见下方暴露范围；审计建议降级不执行。 |
| vite-plugin-dynamic-import | high | 1.6.0 | 1.6.0 | 保留：@next/eslint-plugin-next / vinext 构建插件 → fast-glob → micromatch → braces 3.0.3。见下方暴露范围；审计建议降级不执行。 |
| wrangler | high | 4.92.0 | 4.147.0 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |
| ws | high | 8.18.0 | 8.21.0 | 已消除当前审计条目：锁定兼容补丁/上游更新（移除未用配置同时消除旧image-size路径）。 |

## 中间出现、现已修复的传播项

| 包 | 版本 | 影响路径及结论 |
|---|---|---|
| @vercel/og | 1.0.3 | fflate修至0.7.5，当前审计传播条目已消除，未新增业务API。 |
| satori | 0.33.5 | 自身固定fflate0.7.3，使用下述同分支补丁后当前审计传播条目消除。 |

## 保留风险的实际暴露与处置

- **braces 栈耗尽**：3.0.3仍在公告范围，没有已核实的同主稳定补丁。构建与lint用仓库固定路径模式；业务API不接受glob。仍不能将开发工具链风险当作已修复。不要向这些工具传入不可信glob或构建不可信源码。
- **esbuild 0.18.20 开发服务器跨源读取**：只由Drizzle生成CLI旧loader引入。项目实际构建用直接esbuild 0.28.1，Wrangler使用新版本；不启动Drizzle链的esbuild serve。audit推荐drizzle-kit0.18.1倒退，拒绝。不能跨主覆盖loader内部esbuild而不验证兼容。
## fflate兼容补丁的验证

官方公告明确0.7.5修复ZIP64无限循环，npm registry也确认存在。satori0.33.5固定0.7.3，故使用`fflate@>=0.7.0 <0.7.5: 0.7.5`覆盖范围；不替换0.6.11/0.8.3，不按audit建议降级vinext。安装前后锁文件只变1个包。`dependency-zip-regression.test.mjs`在独立子进程验证正常ZIP读写及缺少ZIP64 extra field的拒绝：旧0.7.3解析3秒超时，补丁版通过；超时保护防止未来依赖回退挂住整个测试进程。[官方公告](https://github.com/advisories/GHSA-px8p-9vwx-vf98)

## 直接公告链接（npm审计中的上游公告）

- [braces vulnerable to stack-exhaustion denial of service through deeply nested patterns](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- [esbuild enables any website to send any requests to the development server and read the response](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
- [fflate unzipSync can enter an infinite loop when parsing malformed ZIP64 archives](https://github.com/advisories/GHSA-px8p-9vwx-vf98)

复核命令：`npm audit --json`、`npm audit --omit=dev --json`、`npm ls <package> --all`。本台账不替代后续审计；新公告可能改变计数。升级后已执行typecheck、生产构建、Pages构建和离线回归；隔离后台与恢复及浏览器详见加固报告。
