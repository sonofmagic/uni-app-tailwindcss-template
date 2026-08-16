# uni-app-tailwindcss-template

`uni-app + Vite + Vue 3 + Tailwind CSS` 的 VS Code 多端模板。

## 适用场景

- 使用 `uni-app` 的 `Vite` 方案开发多端项目
- 同时运行到微信小程序、H5、Android 和 iOS
- 需要 `Vue 3`、Pinia、自动导入和 `weapp-tailwindcss` 集成

## 技术栈

- `uni-app`
- `Vite`
- `Vue 3`
- `Tailwind CSS v4`
- `weapp-tailwindcss`
- `pnpm`

> 当前主分支是 `tailwindcss@4` 版本；如果需要 `tailwindcss@3` 版本，请切换到 `tailwindcss@3` 分支。

## 支持平台

| 平台       | 开发命令                  | 生产构建               |
| ---------- | ------------------------- | ---------------------- |
| 微信小程序 | `pnpm dev:mp-weixin`      | `pnpm build:mp-weixin` |
| H5         | `pnpm dev:h5`             | `pnpm build:h5`        |
| Android    | `pnpm launch:app:android` | `pnpm build:app`       |
| iOS 模拟器 | `pnpm launch:app:ios`     | `pnpm build:app`       |

`build:app` 生成 Android 和 iOS 共用的 `app-plus` WebView 资源，不会生成已签名的 APK 或 IPA。

## 使用前提

- Node.js `22+`
- `pnpm`
- 微信开发者工具，用于微信小程序
- HBuilderX `5.0+`，用于 Android 和 iOS App 调试
- Android SDK、模拟器或已开启调试的 Android 设备
- macOS、Xcode 和 iOS 模拟器，或已配置开发证书的 iOS 真机

发布 App 前，还需要在 `src/manifest.json` 中配置自己的 DCloud AppID、Android 包名与签名，或 iOS Bundle ID 与证书。模板不保存任何发布证书。

## 快速开始

```bash
pnpm install
pnpm dev:mp-weixin
```

`weapp-tailwindcss@5` 会在构建运行时完成 Tailwind CSS 生成和类名收集，安装依赖时无需额外的 Tailwind 补丁或构建脚本授权。

如果需要直接打开微信开发者工具：

```bash
pnpm open:dev
```

## 运行 Android 和 iOS

HBuilderX 5 提供 App CLI 启动能力。请尽量让 HBuilderX、标准调试基座与项目使用的 uni-app 编译器保持同一版本，避免运行时与编译产物不兼容。先启动 Android 模拟器、连接 Android 设备或启动 iOS 模拟器，再执行：

```bash
pnpm launch:app:android
pnpm launch:app:ios
```

指定设备时，把 HBuilderX 设备列表中的 ID 透传给命令：

```bash
pnpm launch:app:android --deviceId <android-device-id>
pnpm launch:app:ios --deviceId <ios-simulator-uuid>
```

`launch:app:ios` 默认运行到 iOS 模拟器。真机运行需要在 HBuilderX 中配置 Apple 开发证书与描述文件。

也可以使用传统的编译监听流程：

```bash
pnpm dev:app
```

编译完成后，在 HBuilderX 中导入 `dist/dev/app`，再选择“运行到手机或模拟器”。生产 App 资源位于 `dist/build/app`：

```bash
pnpm build:app
```

## 常用命令

```bash
pnpm dev:mp-weixin
pnpm build:mp-weixin
pnpm dev:h5
pnpm build:h5
pnpm dev:app
pnpm build:app
pnpm launch:app:android
pnpm launch:app:ios
pnpm open:dev
pnpm open:build
pnpm lint
```

## 跨端样式约定

- 布局优先使用可被 Tailwind 扫描到的静态 class，运行时样式 class 使用枚举值，不自由拼接字符串。
- Tailwind 间距和断点在相同逻辑宽度下保持一致；需要随屏幕缩放的尺寸可以使用 `rpx` 任意值。
- 页面内容容器共用同一组宽度、间距和断点。Android 与 iOS 的系统状态栏、原生导航栏和字体抗锯齿允许存在平台差异。
- 页面底部包含安全区留白，避免 iOS Home Indicator 和 Android 手势导航栏遮挡内容。
- 图片优先放在 `src/static` 并使用 uni-app `image` 组件，避免不同平台的网络和加载时序造成布局偏移。
- 小程序专用样式使用 `wx:`，其他宿主使用 `not-wx:`；Android 与 iOS 都进入同一个 `not-wx` 分支。

## 模板说明

- Tailwind CSS 由 `weapp-tailwindcss@5` 在构建运行时生成，无需安装后补丁
- App WebView 兼容由 `weapp-tailwindcss` 内置的 `legacy-web` 处理链提供；模板不再维护额外的 PostCSS 兼容插件，并保留 Tailwind CSS v4 的运行时 `--spacing` 语义
- 样式条件编译示例使用 `@custom-variant wx` / `@custom-variant not-wx`
- 请先把 `src/manifest.json` 中的 AppID 替换成自己的配置
- 模板内提供 `pnpm update:deps` 和 `pnpm update:uni-app`，用于分别升级通用依赖和 `uni-app` 依赖
- 推荐在 VS Code 中安装 `Tailwind CSS IntelliSense`、ESLint、Stylelint

## 依赖升级

交互式升级除 uni-app 编译工具链之外的所有直接依赖：

```bash
pnpm update:deps
```

升级 DCloud 官方 UVM 管理的整套 uni-app 依赖：

```bash
pnpm update:uni-app
```

uni-app 的兼容性集合不仅包括 `@dcloudio/*`，还包括 `vue`、`vue-i18n`、`@vue/runtime-core`、`@vue/shared`、`vite` 和 `rollup`。不要用通用更新命令单独升级这些包；`update:uni-app` 会通过 UVM 让编译器相关版本保持一致。

## 项目级技能

仓库已内置项目级 `uni-app` skill，供 Codex 等 agent 在当前项目内直接复用：

- 技能目录：`.agents/skills/uni-app`
- 锁文件：`skills-lock.json`
- 技能入口：`.agents/skills/uni-app/SKILL.md`

这个仓库只保留最小集合，不提交 `.claude/`、`.continue/`、`skills/` 这类兼容性符号链接目录。

## 相关文档

- `weapp-tailwindcss`：<https://tw.icebreaker.top/>
- `uni-app`：<https://uniapp.dcloud.net.cn/>
- HBuilderX App CLI：<https://hx.dcloud.net.cn/cli/launch-app>
