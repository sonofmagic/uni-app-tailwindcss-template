# uni-app-tailwindcss-template

简体中文 | [English](./README_EN.md)

本仓库包含可发布的 `pnpm create uni-app-tailwindcss` 初始化工具及其注册模板。源码和版本发布位于 [sonofmagic/uni-app-tailwindcss-template](https://github.com/sonofmagic/uni-app-tailwindcss-template)。

## 包结构

- `packages/template`：用于本地开发和生成项目的默认 uni-app 模板源码
- `packages/create-uni-app-tailwindcss`：为 `pnpm create uni-app-tailwindcss` 提供支持的 CLI
- `templates.json`：CLI 打包、根脚本和 CI 矩阵共用的模板注册表

## 本地开发

```bash
pnpm install
pnpm dev:h5
pnpm dev:mp-weixin
pnpm test:smoke
pnpm test:e2e
pnpm test:e2e:daily
```

`test:e2e` 是 PR 使用的快速脚手架检查。`test:e2e:daily` 会在系统临时目录生成一个真正独立的项目，重新安装依赖，构建 H5 和微信产物，并以桌面、移动视口验证页面资源、布局和 Pinia 交互。

## 模板 HMR 验收

仓库级验收脚本位于 `scripts/template-tests/`，由根命令针对默认模板运行，不会打包进生成项目：

```bash
pnpm test:hmr:artifact:mp-weixin
pnpm test:hmr:h5
pnpm test:hmr:mp-weixin
pnpm test:hmr:app:android -- --device-id <android-device-id> --hbuilderx-cli <hbuilderx-cli>
pnpm test:hmr:app:ios -- --device-id <ios-simulator-uuid> --hbuilderx-cli <hbuilderx-cli>
pnpm test:app-css:artifact
pnpm test:hmr:all
```

验收脚本会在 `src/components/WeappTailwindcss.vue` 的稳定标记处临时注入探针，并在正常退出、异常或中断后恢复原文件。`--timeout <毫秒>` 可调整单步等待时间，`--report-dir <目录>` 可修改报告目录，截图、日志和 JSON/Markdown 汇总默认写入忽略的 `packages/template/.hmr-artifacts/`。

H5 验收需要 Google Chrome；微信运行时验收需要已登录且服务端口可用的微信开发者工具；App 验收需要与 `@dcloudio/vite-plugin-uni` compiler 版本匹配的 HBuilderX、Android SDK/`adb` 或 Xcode 命令行工具以及已启动的目标设备。`test:app-css:artifact` 只检查已有 App 构建产物，不会重复编译。CI 只运行不依赖桌面登录态的产物层检查，不能替代真实 DevTools 或 App 运行时验收。

## 每日全面测试

`Quality` GitHub Actions workflow 每天 03:00（Asia/Shanghai）运行仓库检查、lint、CLI 构建、五平台生产构建、Workers dry-run、快速和独立项目 E2E，以及微信产物级 HMR。各类检查位于独立 job，失败的 Playwright 与 HMR 证据保留 7 天。

本机在 03:10 运行以下补充检查：

```bash
pnpm test:daily:runtime
```

runner 通过 `caffeinate` 防止执行期间休眠，依次检查 H5 浏览器、微信 DevTools、iOS Simulator、唯一在线 Android 设备，并最多等待当天的 GitHub scheduled run 45 分钟。它只关闭自己启动的 Simulator 和 HBuilderX；微信登录失效或设备、桌面工具缺失会标记为 `BLOCKED`，断言失败标记为 `FAIL`。报告写入忽略的 `packages/template/.hmr-artifacts/daily/summary.{json,md}`，退出码分别为 `0`（通过）、`1`（失败）、`2`（阻塞）。可设置 `DAILY_IOS_DEVICE_ID` 固定 iOS 模拟器；本地只验证运行时而不等待云端时使用 `pnpm test:daily:runtime -- --skip-github`。

## 创建项目

```bash
pnpm create uni-app-tailwindcss my-app
```

在 CI 或其他非交互场景中，可以通过 `--template <id>` 指定已注册的模板：

```bash
pnpm create uni-app-tailwindcss my-app --template default
```

该命令会把选中的内置模板复制到 `my-app`，改写包名，并生成一个可独立使用的 pnpm 项目。

## 更新依赖

普通依赖和 uni-app 编译工具链使用不同的更新命令：

```bash
pnpm update:deps
pnpm update:uni-app
```

`update:deps` 会交互式更新默认模板的普通依赖，并保留 DCloud 管理的 uni-app 兼容性依赖。`update:uni-app` 使用官方 UVM 工具统一更新这组兼容性依赖。

## 添加模板

1. 在 `packages/` 下添加模板源码，并将其声明为 workspace 包。
2. 在 `templates.json` 中注册模板 ID、源码目录、构建目标、HMR 目标和 H5 冒烟文本。
3. 为每个已注册的 HMR 目标提供 `dev:<target>`，仓库级 runner 会生成对应的产物层检查。
4. 运行 `pnpm create:build` 和 `pnpm test:e2e`。

create 包会打包所有已注册的模板。GitHub Actions 也会从注册表生成构建和 HMR 矩阵，因此添加模板时无需修改 workflow。

## 发布

包版本和发布流程使用 pnpm 原生版本管理与 repoctl：

```bash
pnpm release
pnpm release:status
pnpm repo:doctor
```

将生成的 change intent 与用户可见变更一同提交。Release workflow 会根据待处理的 intent 创建版本 PR，并在版本 PR 合并后通过 provenance 发布到 npm。
