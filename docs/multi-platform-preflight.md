# 多端测试预检

`pnpm test:preflight` 是模板多端测试的统一入口。它先确认仓库、依赖、构建产物和外部运行时满足测试条件，再把每个目标报告为 `PASS`、`BLOCKED` 或 `FAIL`。预检报告默认写入 `packages/template/.hmr-artifacts/preflight/`，该目录属于构建证据，不应提交到仓库。

## 检查范围

默认矩阵来自 `templates.json` 的注册目标：

| 目标 | 预检内容 | 运行时前置条件 |
| --- | --- | --- |
| H5 | Node/pnpm、锁文件、依赖解析、H5 构建产物、Chrome headless 启动 | Chrome 可执行文件和 loopback 访问能力 |
| App Android | App 构建产物和 App CSS 检查、HBuilderX 版本匹配 | HBuilderX CLI、`adb`、恰好一个 `device` 状态设备 |
| App iOS | App 构建产物和 App CSS 检查、HBuilderX 版本匹配 | Xcode `xcrun`、可用 iOS Simulator；可由 `DAILY_IOS_DEVICE_ID` 指定 |
| 微信小程序 | `app.json`、`app.js`、`app.wxss` 和页面产物 | 微信开发者工具 CLI、服务端口、`weapp-ide-cli` 登录状态 |
| 支付宝小程序 | `app.json`、`app.js`、`app.acss` 和页面产物 | 构建工具链；真机或 IDE 运行时需人工确认 |
| 头条小程序 | `app.json`、`app.js`、`app.ttss` 和页面产物 | 构建工具链；真机或 IDE 运行时需人工确认 |

App 会拆成 Android 与 iOS 两个独立 lane。这样一个设备缺失时不会隐藏另一个端的结果。支付宝和头条的构建及 artifact 检查可以自动执行，厂商 IDE 的打开、登录、预览和真机验证记录为人工步骤，不会被预检错误地标记为自动通过。

## 状态和退出码

- `PASS`（退出码 `0`）：该目标已具备进入正式测试的条件。
- `BLOCKED`（退出码 `2`）：外部环境缺失，例如没有设备、未登录开发者工具或缺少 Xcode。只跳过这个目标，报告会包含修复命令。
- `FAIL`（退出码 `1`）：仓库、依赖、锁文件、配置、构建或产物检查失败。先修复失败项，再继续正式测试。

汇总状态遵循 `FAIL > BLOCKED > PASS`。任何必需检查没有执行也应作为 `FAIL`，避免把漏测当成通过。

## 使用方式

先安装依赖并执行默认矩阵：

```bash
pnpm install
pnpm test:preflight
```

可以只检查指定目标，或把报告写到其他目录：

```bash
pnpm test:preflight -- --target h5
pnpm test:preflight -- --target app,mp-weixin
pnpm test:preflight -- --report-dir /tmp/uni-app-preflight
```

预检默认为只读操作。`--prepare` 才允许 runner 启动它管理的 iOS Simulator 或 HBuilderX；runner 记录哪些进程或模拟器由本次运行启动，并且只清理这些资源。已经由用户启动的应用、模拟器和设备不会被关闭。

```bash
pnpm test:preflight -- --prepare
```

机器可读结果为 `summary.json`，人类可读结果为 `summary.md`。每条检查至少包含 `id`、`target`、`phase`、`status`、说明、修复命令和 `evidence` 字段。命令输出与设备信息按目标保存在同一报告目录，便于 CI 或后续测试引用。

## 运行前准备

### 所有目标

- 使用满足 `^22.18.0 || >=24.11.0` 的 Node.js，并让 pnpm 版本匹配根 `package.json` 的 `packageManager`。
- 根 workspace 和 `packages/template` 的锁文件都能通过 frozen-lockfile 校验。
- 模板源目录、`templates.json`、`manifest.json`（JSONC）、`src/tailwind.css` 和入口页面存在且可读写。
- 关闭会占用 HMR bridge 或测试端口的旧 runner；预检会报告残留开发进程和占用端口。
- 预检期间建议保持工作区干净。未提交修改会被记录为警告；如果包含 HMR fixture，相关 HMR 目标不能安全执行。

### H5

安装 Chrome 并确保当前用户可以启动 headless Chrome、访问本机 loopback。正式运行 H5 HMR 前，使用：

```bash
pnpm test:hmr:h5
```

### 微信小程序

安装并打开微信开发者工具，启用服务端口，使用 `weapp-ide-cli` 登录。预检使用模板项目目录执行登录检查：

```bash
pnpm --dir packages/template exec weapp islogin
```

确认 `project.config.json` 中是要测试的真实 AppID；临时调试条件可放在 `project.private.config.json`，不要把个人 AppID 或私密配置提交到模板。若新增页面或场景，保持 `condition.miniprogram.list` 与真实页面路径同步。

### App Android

安装 HBuilderX，并确保其版本与生成项目中的 `@dcloudio/vite-plugin-uni` `compilerVersion` 匹配。安装 Android platform-tools，连接一个已授权设备或启动一个模拟器：

```bash
adb devices
```

输出中必须恰好有一行 `device` 状态。`offline`、`unauthorized` 或多个在线设备都会让 Android lane 变成 `BLOCKED`；可通过环境变量指定设备时，仍需保证其在线且可执行 shell 与截图操作。

### App iOS

安装 Xcode 和命令行工具，确认 `xcrun simctl list devices available -j` 能列出可用 iOS Simulator。多台设备时设置：

```bash
export DAILY_IOS_DEVICE_ID=<simulator-udid>
```

没有设置时，runner 会选择唯一设备，或选择最近启动且没有并列的设备。没有可确定的选择会报告 `BLOCKED`。使用 `--prepare` 时 runner 可以启动并等待目标 Simulator；如果该 Simulator 原本已运行，runner 不负责关闭它。

### 支付宝和头条

预检只负责验证编译器和固定 artifact。进入正式运行时测试前，分别打开支付宝/头条开发者工具，导入对应产物目录，确认登录状态、预览和目标设备。厂商工具未安装或未登录不表示构建失败；相关运行时步骤应由人工记录。

## 推荐执行顺序

```bash
# 1. 预检全部目标
pnpm test:preflight -- --prepare

# 2. 先验证不依赖外部 IDE 的 artifact HMR
pnpm test:hmr:artifact:app
pnpm test:hmr:artifact:mp-weixin
pnpm test:hmr:artifact:mp-alipay
pnpm test:hmr:artifact:mp-toutiao

# 3. 再运行可用的真实运行时
pnpm test:hmr:h5
pnpm test:hmr:mp-weixin
pnpm test:hmr:app:ios
pnpm test:hmr:app:android
```

`BLOCKED` 目标应在报告中保留原因和修复命令，准备好外部环境后只需重新执行该目标的预检和测试。不要把缺少本地设备改写成业务断言失败。

## 调试配置与发布配置

本预检针对开发和调试测试。空 DCloud AppID、包名、签名、证书和发布平台权限不会阻断构建预检，但会在进入发布流程前单独检查。发布前仍需替换模板 `src/manifest.json` 的 `appid`，配置真实包名和签名，并在目标平台后台完成合法的发布配置。

预检不会新增 `@dcloudio/uni-automator` 用法。微信相关自动化统一通过 `weapp-ide-cli` 和 DevTools 服务执行；现有运行时测试中的会话应在 suite 级别复用，并通过 `miniProgram.reLaunch(route)` 切换页面，避免每个页面重复启动 DevTools。
