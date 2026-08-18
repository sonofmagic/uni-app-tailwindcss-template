# uni-app-tailwindcss-template

简体中文 | [English](./README_EN.md)

一个基于 `uni-app + Vite + Vue 3 + Tailwind CSS` 的多端项目模板，并提供 `pnpm create uni-app-tailwindcss` 初始化工具。

## 适用场景

- 使用 `uni-app` 的 Vite 方案开发微信小程序、H5 和 App
- 使用 Vue 3、Pinia 和自动导入组织业务代码
- 使用 Tailwind CSS v4 与 `weapp-tailwindcss` 编写跨端样式
- 需要一组可以直接参考的页面、组件、图标和交互示例

当前主分支使用 Tailwind CSS v4；需要 Tailwind CSS v3 时，请切换到 `tailwindcss@3` 分支。

## 模板包含什么

- `uni-app`、Vite、Vue 3、Pinia 和 Vue I18n
- Tailwind CSS v4、`weapp-tailwindcss` 和 `@iconify/tailwind4`
- `unplugin-auto-import`，自动导入 Vue、uni-app 和 Pinia API
- 一个可运行的首页示例，包含 Hero、能力展示、交互体验、渐变特性、图标画廊和宏示例组件
- `src/pages/` 页面目录、`src/components/` 共享组件、`src/stores/` Pinia store 和 `src/static/` 静态资源目录
- `wx:` 与 `not-wx:` 条件样式示例，以及适配 App WebView 的 Tailwind 处理链

## 支持平台

| 平台 | 开发命令 | 生产构建 |
| --- | --- | --- |
| 微信小程序 | `pnpm dev:mp-weixin` | `pnpm build:mp-weixin` |
| H5 | `pnpm dev:h5` | `pnpm build:h5` |
| Android | `pnpm launch:app:android` | `pnpm build:app` |
| iOS 模拟器 | `pnpm launch:app:ios` | `pnpm build:app` |
| 支付宝小程序 | `pnpm dev:mp-alipay` | `pnpm build:mp-alipay` |
| 字节跳动小程序 | `pnpm dev:mp-toutiao` | `pnpm build:mp-toutiao` |

`build:app` 生成 Android 和 iOS 共用的 `app-plus` WebView 资源，不会生成已签名的 APK 或 IPA。

## 使用前提

- Node.js `22+`
- `pnpm`
- 微信开发者工具（微信小程序）
- HBuilderX `5.0+`（Android 和 iOS App 调试）
- Android SDK、模拟器或已开启调试的 Android 设备
- macOS、Xcode 和 iOS 模拟器，或已配置开发证书的 iOS 真机

发布 App 前，请在生成项目的 `src/manifest.json` 中配置自己的 DCloud AppID、Android 包名与签名，或 iOS Bundle ID 与证书。模板不保存任何发布证书。

## 创建项目

```bash
pnpm create uni-app-tailwindcss my-app
cd my-app
pnpm install
pnpm dev:h5
```

在 CI 或其他非交互场景中，可以显式选择模板和包管理器：

```bash
pnpm create uni-app-tailwindcss my-app --template default --pm pnpm
```

CLI 会复制内置模板、改写 `package.json` 中的项目名，并保留一个可以独立运行的 pnpm 项目。生成项目后，也可以把 `dev:h5` 换成任意支持平台的开发命令。

## 运行 Android 和 iOS

请让 HBuilderX、标准调试基座和项目使用的 uni-app 编译器保持同一版本。先启动 Android 模拟器、连接 Android 设备或启动 iOS 模拟器，再执行：

```bash
pnpm launch:app:android
pnpm launch:app:ios
```

指定设备时，把设备 ID 透传给命令：

```bash
pnpm launch:app:android --deviceId <android-device-id>
pnpm launch:app:ios --deviceId <ios-simulator-uuid>
```

`launch:app:ios` 默认运行到 iOS 模拟器。真机运行需要在 HBuilderX 中配置 Apple 开发证书与描述文件。也可以使用 `pnpm dev:app` 生成监听产物，再在 HBuilderX 中导入 `dist/dev/app`。

## 跨端样式约定

- 布局优先使用可以被 Tailwind 扫描到的静态 class，运行时 class 使用枚举值，不自由拼接字符串。
- Tailwind 间距和断点在相同逻辑宽度下保持一致；需要随屏幕缩放的尺寸可以使用 `rpx` 任意值。
- 页面底部保留安全区留白，避免 iOS Home Indicator 和 Android 手势导航栏遮挡内容。
- 图片优先放在 `src/static` 并使用 uni-app `image` 组件，减少不同平台的加载时序差异。
- 小程序专用样式使用 `wx:`，其他宿主使用 `not-wx:`；Android 与 iOS 都进入 `not-wx` 分支。

`weapp-tailwindcss@5` 会在构建运行时完成 Tailwind CSS 生成和类名收集，安装依赖时无需额外的 Tailwind 补丁或构建脚本授权。App WebView 兼容由内置的 `legacy-web` 处理链提供。

## 更新依赖

普通依赖和 uni-app 编译工具链使用不同的更新命令：

```bash
pnpm update:deps
pnpm update:uni-app
```

不要用通用更新命令单独升级 `vue`、`vite`、`rollup` 或 `@dcloudio/*` 等兼容性依赖；`update:uni-app` 会通过官方 UVM 让编译器相关版本保持一致。

## 相关文档

- [生成项目的完整使用说明](./packages/template/README.md)
- [仓库开发、测试与发布指南](./CONTRIBUTING.md)
- [weapp-tailwindcss](https://tw.icebreaker.top/)
- [uni-app](https://uniapp.dcloud.net.cn/)
- [HBuilderX App CLI](https://hx.dcloud.net.cn/cli/launch-app)

源码和版本发布位于 [sonofmagic/uni-app-tailwindcss-template](https://github.com/sonofmagic/uni-app-tailwindcss-template)。
