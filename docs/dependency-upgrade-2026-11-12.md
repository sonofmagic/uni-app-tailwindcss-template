# 2026-11-12 依赖升级与测试报告

根项目、创建 CLI 与生成模板已完成稳定兼容依赖升级。Node.js 要求统一为 `^22.23.4 || ^24.22.1 || >=26.12.1`。审计从 97 条降至 64 条，critical 从 3 条降至 0 条。

生成项目在 Node 22.23.4 和 24.22.2 下的四组生命周期场景共 100/100 通过；candidate/npm latest 指纹比较仍然失败，原始失败结果和断言均保留。真实运行时最终结果见下表，存在阻塞时不作为全面测试通过。

## 版本与兼容边界

| 依赖 | 升级前 | 本次版本 |
| --- | --- | --- |
| pnpm | 12.14.0 | 12.18.0 |
| repoctl | 5.10.3 | 6.5.4 |
| Vitest | 5.0.5 | 5.1.0 |
| tsdown | 0.23.1 | 0.23.7 |
| TypeScript | 6.0.3 | 7.0.2 |
| @icebreakers/eslint-config | 8.0.6 | 8.0.17 |
| Stylelint | 17.16.0 | 18.0.0 |
| @icebreakers/stylelint-config | 5.1.3 | 6.0.3 |
| Tailwind CSS | 4.3.4 | 4.3.5 |
| weapp-tailwindcss | 5.7.2 | 5.7.4 |
| Sass | 1.108.0 | 1.108.2 |
| weapp-ide-cli | 6.2.0 | 6.4.3 |
| Wrangler | 4.158.0 | 4.160.1 |

官方 UVM 的正式通道确认 uni-app `3.0.0-5030420261029002` 为当前稳定组合。Vue、`@vue/runtime-core`、`@vue/shared` 保留 `3.4.21`，Vite 保留 `5.2.8`，Rollup 保留 `4.14.3`，沿用 DCloud 编译器配置。Pinia 保留 `2.2.4`，因为新版 Pinia 要求 Vue `^3.5.11`；vue-i18n 保留 9 系列及原有 intlify 配套覆盖。

计划中的 `@dcloudio/types@3.4.32` 已评估，但当前 `@dcloudio/uni-app` 精确要求 peer `3.4.31`，因此保留 `3.4.31`，最终 peer 检查通过。其余直接依赖沿用已查询确认的最新稳定版本。复核正式编译组合可执行：

```sh
pnpm dlx @dcloudio/uvm@latest latest --manager manual
pnpm view @dcloudio/uni-app@3.0.0-5030420261029002 peerDependencies
```

TypeScript 7 经过 CLI 类型检查及 tsdown 打包验证；repoctl 6 的声明范围也支持 TypeScript 7。Node 22.23.4 使用官方 darwin-arm64 二进制并校验官方 SHASUMS，Node 24 使用本机 24.22.2。Node 26 本次未执行运行矩阵。

## 配置和测试边界修复

- 根工作区与生成模板统一使用 pnpm `allowBuilds`，清除 `onlyBuiltDependencies`、失效的版本年龄例外及无匹配对象的 repoctl 5.5.10 override；删除 `.npmrc` 中不生效的版本年龄设置，工作区 `minimumReleaseAge: 0` 保留。
- 刷新声明范围内的间接依赖。`proxy-addr` 更新到 2.0.8，`oxfmt>tinypool: 2.1.2` 定向覆盖修复剩余 critical，不跨越 uni-app 编译器接口做全局覆盖。
- 适配 Stylelint 18 的 uni-app `uni-view` 标签、空样式文件和现有 CSS 格式；等价调整颜色表示与属性顺序。
- 微信使用 weapp-ide-cli 的受管项目 journal，保留真实编译目录，关闭项目窗口后复核资源完全释放；机器锁占用单独报告为 `BLOCKED`，不误报登录过期。
- App 测试在真实路径下创建隔离源码副本，通过 HBuilderX 标准 uni-app 流程启动。此前导入编译目录会被识别为普通 5+ 项目，Android 刷新 WebView 时未重载 uni-app 服务；macOS `/var` 符号链接还导致 iOS 增量同步目录被当作文件。测试现统一源码生命周期和文件监听路径，结束时关闭本任务临时 IDE 项目再移除文件。

中文 pnpm change summary 为 `.changeset/young-frogs-deliver.md`，按 Node 支持边界变化记录 minor 发布意图；本次未发布包或部署服务。

## 安装、质量、构建与热更新

| 检查 | 结果 | 证据或说明 |
| --- | --- | --- |
| 普通安装、冻结安装 | PASS | 根项目及四组生成项目均执行 |
| peer 依赖检查 | PASS | 保留 DCloud types 3.4.31 后通过 |
| `pnpm repo:doctor` | PASS | 23 项通过、3 项既有可选配置警告、0 项失败 |
| `pnpm release:status` | PASS | 仅预览版本计划 |
| `pnpm lint` | PASS | 最终复测通过 |
| 模板 Stylelint | PASS | `pnpm exec stylelint 'src/**/*.{vue,css,scss}'` |
| CLI 类型检查、`pnpm create:build` | PASS | TypeScript 7 + tsdown 0.23.7 |
| `pnpm test:e2e:daily:unit` | PASS | 63 项，涵盖 Node 边界、微信窗口清理及机器锁诊断 |
| `pnpm test:e2e` | PASS | 6 项桌面、移动和脚手架检查 |
| H5 / App / 微信 / 支付宝 / 抖音生产构建 | PASS | 五端均通过，生成项目矩阵另行重复验证 |
| App CSS 产物检查 | PASS | 现有构建产物的兼容性校验 |
| Workers dry-run | PASS | `pnpm workers:check`；没有实际部署 |
| App / 微信 / 支付宝 / 抖音产物 HMR | PASS | 四端串行执行，探针源码恢复 |
| H5 浏览器 HMR | PASS | 模板、脚本、Tailwind 与状态保持验证 |
| 依赖审计 | 有遗留问题 | 64 条：0 critical / 21 high / 31 moderate / 12 low，审计退出码仍非 0 |

## 生成项目生命周期

| 来源 | Node | 场景 | 结果 |
| --- | --- | --- | --- |
| candidate | 22.23.4 | 25/25 | PASS |
| candidate | 24.22.2 | 25/25 | PASS |
| npm latest | 22.23.4 | 25/25 | PASS |
| npm latest | 24.22.2 | 25/25 | PASS |

每组覆盖显式/默认模板、未知模板、已有目录等 CLI 参数，生成文件卫生、普通/冻结安装、用户编辑、lint、桌面/移动 H5、H5 HMR、四端产物 HMR、五端构建、静态站点与 Workers dry-run，以及 App/三类小程序部署产物校验。部署检查验证本地产物，不执行线上发布。

两个 Node 版本的总入口与最终合同聚合器均返回 `FAIL`，唯一合同失败是指纹漂移：

```text
candidate: 998a1963e0af441fc528d4eba038efad08ac90b6734313062f44574b1fd3e02b
npm latest: aff64b115d4cd4788814e84552f0a65cae4d11d090980c36d03da9ecdc50dab2
```

candidate 包含尚未发布的依赖、Node 要求、pnpm 配置及样式配置更新，npm latest 仍是已发布版本，两者差异符合当前开发状态。该解释不改变断言或失败退出码；原始结果保留在 `user-journey-final/runner-summary-node22.json`、`runner-summary-node24.json` 与 `daily-contract-summary.md`。

## 真实运行时

| 来源 | H5 | 微信 | iOS | Android |
| --- | --- | --- | --- | --- |
| candidate | PASS | 首轮 PASS；最终复测 BLOCKED | PASS | PASS |
| npm latest | PASS | BLOCKED | PASS | PASS |

最终 `runtime-final/summary.json` 返回 `BLOCKED`（退出码 2），13 条记录中 9 条 PASS、4 条 BLOCKED、0 条 FAIL。4 条 BLOCKED 是两份生成项目的预检快照和两条微信运行时检查。预检时 iOS 尚未启动，随后由 runner 启动并完成两组 iOS 验证；仍未解除的外部阻塞是微信机器锁。第一轮候选 App 的失败、以及路径修复中间阶段的 npm latest Android 白屏，均保留在原始 `runtime/` 报告中；最终四组 App 运行时均通过，包含画面几何、设备资源、增量编译、进程保持及运行错误检查。

HBuilderX 为 `5.34.2026102909`，匹配编译器 5.34；iOS 使用 `iPhone 17 Pro iOS 26.5`，Android 使用既有 `emulator-5556`。机器锁的外部持有者在 `/Users/icebreaker/Projects/github/weapp-vite/.codex-tmp/ide-hmr`，未终止其进程或删除其锁。

最终核对本任务所有临时 HBuilderX 项目已关闭、临时目录已删除；iOS 模拟器恢复为 Shutdown。原有 HBuilderX 进程和 Android 模拟器继续运行；微信首轮 journal 已完全释放。浏览器测试均为 headless，测试脚本关闭其 context/browser，没有保留展示标签页。探针路由、页面配置及 Tailwind 源码已恢复。

GitHub 查询到的 [Quality 运行](https://github.com/sonofmagic/uni-app-tailwindcss-template/actions/runs/43132966422) 已通过，但对应基线提交 `42b68ae7389ad81ed40f9d06014896d57b226720`。它没有测试本次未提交的升级，不作为本次升级的远端 CI 通过证明。

本次升级尚不能标记为“全面测试通过”：npm latest 指纹漂移按合同保留失败，微信最终复测受外部资源锁阻塞，依赖审计仍有 64 条上游限制问题。锁释放后需补跑 npm latest 微信及 candidate 微信最终复测；升级内容进入远端后还需由 Quality 验证该版本。

## 审计与证据

完整剩余漏洞的影响、路径、版本和保留原因见 [依赖审计复核](./dependency-upgrade-2026-11-12-audit.md)。主要限制来自 DCloud 固定的编译器、Vue/Intlify 配套链，以及 ESLint/repoctl 父包尚未接受安全修复主版本的范围。

本地日志、截图和机器生成报告统一位于忽略目录 `packages/template/.hmr-artifacts/upgrade-2026-11-12/`：

| 目录或文件 | 内容 |
| --- | --- |
| `dependencies-before.json` | 升级前三份 manifest |
| `checks.json`、各项 `*.log` | 命令、退出码和完整输出；保留修复前失败及复测结果 |
| `audit-before.json`、`audit-final.json`、`audit-review.json` | 审计前后结果及 64 项路径复核 |
| `hmr/` | 四端产物和 H5 浏览器热更新证据 |
| `user-journey-final/` | 四组最终生命周期、截图、trace、指纹与合同汇总 |
| `runtime/`、`app-source-android/`、`runtime-final/` | 原始运行时失败、定向复测和最终串行复测 |
| `resources.json` | 本任务的浏览器、IDE、模拟器与设备归属及清理记录 |

初次 Stylelint 检查返回 2 表示规则失败，旧检查辅助器曾将其标为 `BLOCKED`；最终 Stylelint 已通过。该历史记录保留，最终结果以修复后的明确复测记录为准。
