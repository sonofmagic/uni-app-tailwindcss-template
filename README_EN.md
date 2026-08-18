# uni-app-tailwindcss-template

[简体中文](./README.md) | English

A multi-platform project template based on `uni-app + Vite + Vue 3 + Tailwind CSS`, with the `pnpm create uni-app-tailwindcss` project initializer.

## Use Cases

- Build WeChat Mini Programs, H5 sites, and Apps with uni-app and Vite
- Organize Vue 3 projects with Pinia and automatic imports
- Write cross-platform styles with Tailwind CSS v4 and `weapp-tailwindcss`
- Start from runnable page, component, icon, and interaction examples

The main branch uses Tailwind CSS v4. Switch to the `tailwindcss@3` branch when you need Tailwind CSS v3.

## What Is Included

- `uni-app`, Vite, Vue 3, Pinia, and Vue I18n
- Tailwind CSS v4, `weapp-tailwindcss`, and `@iconify/tailwind4`
- `unplugin-auto-import` for Vue, uni-app, and Pinia APIs
- A runnable home page with Hero, capability, interaction, gradient feature, icon gallery, and macro showcase components
- `src/pages/` for pages, `src/components/` for shared UI, `src/stores/` for Pinia stores, and `src/static/` for assets
- `wx:` and `not-wx:` conditional styling examples, plus the Tailwind processing chain for App WebViews

## Supported Platforms

| Platform | Development | Production build |
| --- | --- | --- |
| WeChat Mini Program | `pnpm dev:mp-weixin` | `pnpm build:mp-weixin` |
| H5 | `pnpm dev:h5` | `pnpm build:h5` |
| Android | `pnpm launch:app:android` | `pnpm build:app` |
| iOS Simulator | `pnpm launch:app:ios` | `pnpm build:app` |
| Alipay Mini Program | `pnpm dev:mp-alipay` | `pnpm build:mp-alipay` |
| Toutiao Mini Program | `pnpm dev:mp-toutiao` | `pnpm build:mp-toutiao` |

`build:app` creates shared `app-plus` WebView resources for Android and iOS. It does not produce signed APK or IPA files.

## Prerequisites

- Node.js `22+`
- `pnpm`
- WeChat DevTools for WeChat Mini Programs
- HBuilderX `5.0+` for Android and iOS App debugging
- Android SDK, an emulator, or a USB-debugging Android device
- macOS, Xcode, and an iOS Simulator, or an iOS device with signing configured

Before releasing an App, configure your DCloud AppID, Android package and signing settings, or iOS Bundle ID and certificates in `src/manifest.json`. The template does not contain release credentials.

## Create a Project

```bash
pnpm create uni-app-tailwindcss my-app
cd my-app
pnpm install
pnpm dev:h5
```

In CI or another non-interactive environment, select the template and package manager explicitly:

```bash
pnpm create uni-app-tailwindcss my-app --template default --pm pnpm
```

The CLI copies the bundled template, rewrites the project name in `package.json`, and leaves a standalone pnpm project. After creation, replace `dev:h5` with any development command for a supported platform.

## Run on Android and iOS

Keep HBuilderX, the standard debug base, and the project's uni-app compiler on compatible versions. Start an Android emulator, connect an Android device, or boot an iOS Simulator before running:

```bash
pnpm launch:app:android
pnpm launch:app:ios
```

Pass a device ID when needed:

```bash
pnpm launch:app:android --deviceId <android-device-id>
pnpm launch:app:ios --deviceId <ios-simulator-uuid>
```

`launch:app:ios` targets the iOS Simulator by default. A real device requires Apple signing configured in HBuilderX. You can also run `pnpm dev:app`, then import `dist/dev/app` into HBuilderX.

## Cross-Platform Styling

- Prefer static Tailwind classes that can be scanned; use enumerated values instead of freely concatenated runtime classes.
- Keep Tailwind spacing and breakpoints consistent at the same logical width; use `rpx` arbitrary values for dimensions that should scale with the screen.
- Leave safe-area space at the bottom of pages so iOS Home Indicator and Android gesture navigation do not cover content.
- Prefer images in `src/static` with the uni-app `image` component to reduce platform-specific loading shifts.
- Use `wx:` for Mini Program-only styles and `not-wx:` for other hosts; Android and iOS both use the `not-wx` branch.

`weapp-tailwindcss@5` generates Tailwind CSS and collects classes at build time. No extra Tailwind patch or install hook is required. App WebView compatibility is provided by its built-in `legacy-web` processing chain.

## Update Dependencies

Use separate commands for regular dependencies and the uni-app compiler toolchain:

```bash
pnpm update:deps
pnpm update:uni-app
```

Do not update compatibility dependencies such as `vue`, `vite`, `rollup`, or `@dcloudio/*` individually with the general update command. `update:uni-app` uses the official UVM tool to keep the compiler set aligned.

## Related Documentation

- [Complete guide for generated projects](./packages/template/README.md)
- [Repository development, testing, and release guide](./CONTRIBUTING_EN.md)
- [weapp-tailwindcss](https://tw.icebreaker.top/)
- [uni-app](https://uniapp.dcloud.net.cn/)
- [HBuilderX App CLI](https://hx.dcloud.net.cn/cli/launch-app)

Source and releases are hosted at [sonofmagic/uni-app-tailwindcss-template](https://github.com/sonofmagic/uni-app-tailwindcss-template).
