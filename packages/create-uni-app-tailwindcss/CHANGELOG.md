# create-uni-app-tailwindcss

## 0.1.3

### Patch Changes

- 生成的 uni-app 项目现在包含 VS Code 的 ESLint、Stylelint、Tailwind CSS 配置和扩展推荐。

- 升级模板、脚手架和仓库工具链依赖，统一更新锁文件并提升生成项目的构建与测试工具版本。

- 完善每日用户全生命周期测试，覆盖 H5 浏览器 E2E 与热更新，以及 App、微信、支付宝和抖音端的增量编译和生产构建。

- deps upgrade

## 0.1.2

### Patch Changes

- 更新默认模板依赖并补充多平台 HMR 验证，生成项目获得更完整的质量保障。

## 0.1.1

### Patch Changes

- 迁移并修复模板的多平台 HMR 验收，确保测试产物不会进入生成项目。

- 移除生成模板中的仓库 QA 钩子，并新增 candidate 与 npm latest 的每日真实用户全生命周期回归。

- 将依赖升级拆分为通用依赖和 uni-app 编译工具链两个命令，避免普通升级破坏 uni-app 的版本兼容关系。
