# Repository Guidelines

## Project Structure & Module Organization

This repository is a `pnpm` workspace containing the publishable create CLI and its registered uni-app templates. The default `uni-app + Vite + Vue 3 + Tailwind CSS` application lives in `packages/template/`; put its routes under `packages/template/src/pages/`, shared UI under `packages/template/src/components/`, Pinia stores under `packages/template/src/stores/`, and static files under `packages/template/src/static/`. The initializer lives in `packages/create-uni-app-tailwindcss/`, while `templates.json` is the shared source of truth for CLI bundling, root scripts, and CI matrices. Template tooling is defined in [`packages/template/vite.config.ts`](packages/template/vite.config.ts) and [`packages/template/eslint.config.mjs`](packages/template/eslint.config.mjs), with Tailwind v4 configuration in [`packages/template/src/tailwind.css`](packages/template/src/tailwind.css).

## Build, Test, and Development Commands

Use `pnpm install` to install dependencies. `weapp-tailwindcss@5` handles Tailwind generation at build time, so no install-time Tailwind hook is required.

- `pnpm dev:mp-weixin`: start WeChat Mini Program development build.
- `pnpm dev:h5`: run the H5 dev server.
- `pnpm build:mp-weixin`: create a production Mini Program build in `dist/build/mp-weixin`.
- `pnpm build:h5`: create an H5 production build.
- `pnpm create:build`: build the initializer and bundle every registered template.
- `pnpm test:e2e`: verify scaffolding and the generated H5 application with Playwright.
- `pnpm test:e2e:daily`: run the full candidate and npm-latest user lifecycle; use `-- --source candidate|latest|all` to select sources.
- `pnpm test:e2e:daily:unit`: verify source parsing, fingerprint comparison, coverage, and status aggregation.
- `pnpm test:daily:runtime`: create candidate/latest projects and run their H5, WeChat, iOS, Android, and scheduled GitHub lanes; reports use exit codes 0/1/2 for pass/fail/blocked.
- `pnpm test:hmr:artifact:mp-weixin`: run the headless Mini Program artifact HMR check used by CI.
- `pnpm test:hmr:h5`: verify H5 HMR in a real browser and write evidence under `packages/template/.hmr-artifacts/`.
- `pnpm test:hmr:mp-weixin`: verify HMR against a logged-in WeChat DevTools runtime.
- `pnpm test:app-css:artifact`: verify App CSS compatibility from an existing `build:app` output without rebuilding it.
- `pnpm template @default open:dev`: open WeChat DevTools for the default template.
- `pnpm lint`: run the default template's ESLint checks.
- `pnpm lint:fix`: auto-fix lint issues in the default template.
- `pnpm update:deps`: interactively update regular template dependencies while excluding the uni-app compatibility set.
- `pnpm update:uni-app`: update the DCloud-managed uni-app compiler dependencies together through UVM.
- `pnpm release`: record a pnpm native change intent for a publishable package.
- `pnpm release:status`: preview pending package versions without modifying files.
- `pnpm repo:doctor`: validate the repoctl and release configuration.

## Coding Style & Naming Conventions

Follow `.editorconfig`: 2-space indentation, LF line endings, UTF-8. Prefer Vue 3 SFCs with TypeScript. Use PascalCase for component filenames such as `HeroShowcase.vue`, camelCase for store and utility modules such as `counter.ts`, and keep page directories route-aligned, for example `packages/template/src/pages/index/index.vue`. ESLint uses `@icebreakers/eslint-config` with Vue, Tailwind, and WeChat rules; run `pnpm lint` before opening a PR.

## Testing Guidelines

Playwright tests live in `packages/create-uni-app-tailwindcss/tests/` and cover project scaffolding plus the generated H5 page. Treat `pnpm lint`, `pnpm create:build`, and `pnpm test:e2e` as the minimum create-package quality gate. Template runtime changes should also run the affected target build and, for WeChat behavior, `pnpm dev:mp-weixin` plus WeChat DevTools. Keep new TypeScript tests under the owning package with `*.spec.ts` naming.

### HMR Verification Notes

Use `pnpm test:hmr:artifact:mp-weixin` for the deterministic headless CI path. It applies the shared probe fixture atomically, verifies transformed template/script/style artifacts before and after an incremental compile, and restores the source even after interruption.

Runtime verification remains platform-specific: `pnpm test:hmr:h5` uses Playwright, `pnpm test:hmr:mp-weixin` requires logged-in WeChat DevTools, and the App scripts require the matching HBuilderX CLI plus a running device or simulator. Reports, screenshots, and logs live under ignored `packages/template/.hmr-artifacts/`; do not commit them or bundle them into generated projects.

The daily lifecycle contract defines 100% as every required scenario being executed. `BLOCKED` counts as executed but cannot pass the suite; `MISSING` and `SKIP` fail it. Scheduled/manual CI runs candidate/latest on Node 22 and 24, compares generated-project fingerprints, and treats npm latest drift as a failure.

The daily local runner starts at 03:10 Asia/Shanghai after the 03:00 GitHub `Quality` schedule. It creates isolated candidate/latest projects and runs their runtime lanes serially. It may boot the selected iOS Simulator and open HBuilderX, but must only stop applications or simulators it started. Use `DAILY_IOS_DEVICE_ID` to pin iOS; Android requires exactly one already-online device, and WeChat login remains a manual prerequisite. Treat missing external runtime state as `BLOCKED`, not a test assertion failure.

## Commit & Pull Request Guidelines

Recent history uses short Conventional Commit style prefixes such as `chore:` and `chore(deps):`. Keep that pattern for new work, for example `feat: add profile page` or `fix: correct tailwind class merge`. User-visible changes to `create-uni-app-tailwindcss` or its bundled templates require a Chinese pnpm change summary committed with the change. PRs should include a concise description, linked issue when applicable, screenshots or DevTools captures for UI changes, and the commands used for verification.

## Configuration Tips

Before shipping a generated app, replace the `appid` in `packages/template/src/manifest.json` with the target project's value. Keep generated output under `dist/` out of source edits, and prefer updating template or CLI source files rather than bundled artifacts. Publishing is orchestrated by repoctl through `.github/workflows/release.yml`; do not add a second release workflow or commit npm credentials.

Project-level agent skills should stay minimal in this repository. Keep installed skills under `.agents/skills/` and commit `skills-lock.json` for reproducibility. Do not commit compatibility symlink directories such as `.claude/`, `.continue/`, or `skills/` unless this repository explicitly needs those tools.
