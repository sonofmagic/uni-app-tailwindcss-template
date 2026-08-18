# 贡献与仓库开发

[返回用户 README](./README.md) | [English](./CONTRIBUTING_EN.md)

本文档面向维护模板、CLI 和仓库自动化的贡献者。生成项目的使用方式请参阅 [README.md](./README.md) 和 [模板使用说明](./packages/template/README.md)。

## 仓库结构

- `packages/template`：默认 uni-app 模板源码，既用于本地开发，也用于 CLI 打包。
- `packages/create-uni-app-tailwindcss`：`pnpm create uni-app-tailwindcss` 使用的 CLI、模板打包脚本和 E2E 测试。
- `templates.json`：模板 ID、源码目录、构建目标、HMR 目标和冒烟文本的共享注册表。
- `scripts/`：模板运行代理、模板测试、CI 矩阵和每日运行器。
- `.github/workflows/`：发布和仓库级质量检查工作流。

## 环境与本地开发

要求 Node.js `22+` 和 `pnpm`。安装依赖：

```bash
pnpm install
```

默认模板的常用开发和构建命令：

```bash
pnpm dev:h5
pnpm dev:mp-weixin
pnpm build:h5
pnpm build:mp-weixin
pnpm build:app
pnpm build:mp-alipay
pnpm build:mp-toutiao
pnpm lint
```

CLI 和生成项目检查：

```bash
pnpm create:build
pnpm test:e2e
pnpm test:smoke
```

`weapp-tailwindcss@5` 在构建运行时生成 Tailwind CSS；仓库不需要安装后补丁或 install hook。

## HMR 与平台验收

仓库级脚本位于 `scripts/template-tests/`，不会被打包进生成项目：

```bash
pnpm test:hmr:artifact:mp-weixin
pnpm test:hmr:h5
pnpm test:hmr:mp-weixin
pnpm test:hmr:app:android -- --device-id <android-device-id> --hbuilderx-cli <hbuilderx-cli>
pnpm test:hmr:app:ios -- --device-id <ios-simulator-uuid> --hbuilderx-cli <hbuilderx-cli>
pnpm test:app-css:artifact
pnpm test:hmr:all
```

验收脚本会创建测试专用临时路由并触碰 Tailwind 入口，在正常退出、异常或中断后恢复源文件。截图、日志和 JSON/Markdown 报告默认写入忽略的 `packages/template/.hmr-artifacts/`。

H5 验收需要 Google Chrome；微信运行时验收需要已登录且服务端口可用的微信开发者工具；App 验收需要与 `@dcloudio/vite-plugin-uni` compiler 版本匹配的 HBuilderX、Android SDK/`adb` 或 Xcode 命令行工具以及目标设备。`test:app-css:artifact` 只检查已有 App 构建产物，不会重复编译。CI 只运行不依赖桌面登录态的产物层检查。

## 每日全面测试

`Quality` GitHub Actions workflow 每天 03:00（Asia/Shanghai）运行仓库检查、lint、CLI 构建、五平台生产构建、Workers dry-run、快速 E2E 和微信产物级 HMR。每日用户生命周期使用 `candidate/latest × Node 22/24` 四组合矩阵；contract job 要求所有声明场景执行，并比较 candidate 与 npm latest 的规范化文件、脚本和依赖指纹。

```bash
pnpm test:e2e:daily
pnpm test:e2e:daily:unit
pnpm test:daily:runtime
```

生命周期覆盖率 100% 指所有 required scenarios 均已执行，不代表代码行覆盖率。`BLOCKED` 计为已执行但不能使套件通过；任何静默 `SKIP` 或缺失场景都会失败。缺少桌面工具、登录态或设备应标记为 `BLOCKED`，生成、构建或断言失败才标记为 `FAIL`。

本地 daily runner 会创建隔离的 candidate/latest 项目并串行运行 H5、微信 DevTools、iOS Simulator 和唯一在线 Android 设备检查；只关闭它自己启动的 Simulator 和 HBuilderX。可用 `DAILY_IOS_DEVICE_ID` 固定 iOS 模拟器，或使用 `pnpm test:daily:runtime -- --skip-github` 跳过云端等待。报告写入忽略的 `packages/template/.hmr-artifacts/daily/summary.{json,md}`，退出码 `0`、`1`、`2` 分别表示通过、失败、阻塞。

## 添加模板

1. 在 `packages/` 下添加模板源码，并将其声明为 workspace 包。
2. 在 `templates.json` 注册模板 ID、源码目录、构建目标、HMR 目标和 H5 冒烟文本。
3. 为每个注册的 HMR 目标提供对应的 `dev:<target>` 脚本。
4. 运行 `pnpm create:build` 和 `pnpm test:e2e`。

CLI 会打包所有已注册模板，GitHub Actions 也会从注册表生成构建和 HMR 矩阵，因此新增模板通常不需要修改 workflow。

## 依赖、代码和测试约定

- `pnpm update:deps` 只更新普通依赖；`pnpm update:uni-app` 使用 DCloud UVM 统一更新 uni-app 兼容性依赖。
- 遵循 `.editorconfig` 的 2 空格缩进、LF 和 UTF-8；Vue 组件使用 PascalCase，store 和工具模块使用 camelCase。
- 页面放在 `packages/template/src/pages/`，共享组件放在 `src/components/`，store 放在 `src/stores/`，静态资源放在 `src/static/`。
- 默认质量门槛是 `pnpm lint`、`pnpm create:build` 和 `pnpm test:e2e`；模板运行时变更还应运行受影响的平台构建。
- TypeScript 测试放在所属包中，并使用 `*.spec.ts` 命名。

## 变更与发布

提交使用简短的 Conventional Commit 前缀，例如 `feat:`、`fix:`、`chore:` 和 `chore(deps):`。涉及 `create-uni-app-tailwindcss` 或其内置模板的用户可见变更，需要提交中文 pnpm change summary。

```bash
pnpm release
pnpm release:status
pnpm repo:doctor
```

将生成的 change intent 与用户可见变更一起提交。Release workflow 会根据待处理 intent 创建版本 PR，并在合并后通过 provenance 发布到 npm。不要提交 npm 凭据，也不要新增第二套发布 workflow。

更详细的项目代理约定见 [AGENTS.md](./AGENTS.md)。
