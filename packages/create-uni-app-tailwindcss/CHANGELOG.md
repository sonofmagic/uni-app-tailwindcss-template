# create-uni-app-tailwindcss

## 0.1.1

### Patch Changes

- 迁移并修复模板的多平台 HMR 验收，确保测试产物不会进入生成项目。

- 移除生成模板中的仓库 QA 钩子，并新增 candidate 与 npm latest 的每日真实用户全生命周期回归。

- 将依赖升级拆分为通用依赖和 uni-app 编译工具链两个命令，避免普通升级破坏 uni-app 的版本兼容关系。
