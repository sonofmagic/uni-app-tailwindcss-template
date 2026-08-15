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
- `pnpm template @default open:dev`: open WeChat DevTools for the default template.
- `pnpm lint`: run the default template's ESLint checks.
- `pnpm lint:fix`: auto-fix lint issues in the default template.
- `pnpm release`: record a pnpm native change intent for a publishable package.
- `pnpm release:status`: preview pending package versions without modifying files.
- `pnpm repo:doctor`: validate the repoctl and release configuration.

## Coding Style & Naming Conventions

Follow `.editorconfig`: 2-space indentation, LF line endings, UTF-8. Prefer Vue 3 SFCs with TypeScript. Use PascalCase for component filenames such as `HeroShowcase.vue`, camelCase for store and utility modules such as `counter.ts`, and keep page directories route-aligned, for example `packages/template/src/pages/index/index.vue`. ESLint uses `@icebreakers/eslint-config` with Vue, Tailwind, and WeChat rules; run `pnpm lint` before opening a PR.

## Testing Guidelines

Playwright tests live in `packages/create-uni-app-tailwindcss/tests/` and cover project scaffolding plus the generated H5 page. Treat `pnpm lint`, `pnpm create:build`, and `pnpm test:e2e` as the minimum create-package quality gate. Template runtime changes should also run the affected target build and, for WeChat behavior, `pnpm dev:mp-weixin` plus WeChat DevTools. Keep new TypeScript tests under the owning package with `*.spec.ts` naming.

### HMR Verification Notes

When verifying `weapp-tailwindcss` HMR, run `pnpm dev:mp-weixin` in a normal, non-sandboxed shell. Codex/tool sandboxes can prevent the uni-app mini-program watcher from receiving file events, which makes `packages/template/dist/dev/mp-weixin` appear stale even though the project HMR path is healthy.

For a reliable check, edit a real source SFC such as `packages/template/src/components/sections/CapabilityShowcase.vue` and verify both template classes and script-side Tailwind class strings. Expected mini-program evidence includes `Incremental Compiling...` in the dev log plus transformed class names in `packages/template/dist/dev/mp-weixin/**/*.wxml`, `*.js`, and `app.wxss` (for example arbitrary values converted to `*_b_*` selectors). For H5, confirm the Vite `hmr update` log and, when possible, inspect the browser computed style.

## Commit & Pull Request Guidelines

Recent history uses short Conventional Commit style prefixes such as `chore:` and `chore(deps):`. Keep that pattern for new work, for example `feat: add profile page` or `fix: correct tailwind class merge`. User-visible changes to `create-uni-app-tailwindcss` or its bundled templates require a Chinese pnpm change summary committed with the change. PRs should include a concise description, linked issue when applicable, screenshots or DevTools captures for UI changes, and the commands used for verification.

## Configuration Tips

Before shipping a generated app, replace the `appid` in `packages/template/src/manifest.json` with the target project's value. Keep generated output under `dist/` out of source edits, and prefer updating template or CLI source files rather than bundled artifacts. Publishing is orchestrated by repoctl through `.github/workflows/release.yml`; do not add a second release workflow or commit npm credentials.

Project-level agent skills should stay minimal in this repository. Keep installed skills under `.agents/skills/` and commit `skills-lock.json` for reproducibility. Do not commit compatibility symlink directories such as `.claude/`, `.continue/`, or `skills/` unless this repository explicitly needs those tools.
