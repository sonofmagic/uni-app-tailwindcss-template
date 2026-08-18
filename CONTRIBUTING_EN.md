# Contributing and Repository Development

[Back to user README](./README_EN.md) | [简体中文](./CONTRIBUTING.md)

This guide is for contributors maintaining the template, CLI, and repository automation. For generated-project usage, see [README_EN.md](./README_EN.md) and the [template guide](./packages/template/README.md).

## Repository Structure

- `packages/template`: the default uni-app template source used for local development and CLI bundling.
- `packages/create-uni-app-tailwindcss`: the CLI, template bundler, and E2E tests for `pnpm create uni-app-tailwindcss`.
- `templates.json`: the shared registry for template IDs, source directories, build targets, HMR targets, and smoke text.
- `scripts/`: template runners, template tests, CI matrices, and the daily runner.
- `.github/workflows/`: release and repository quality workflows.

## Environment and Local Development

Use Node.js `22+` and `pnpm`. Install dependencies with:

```bash
pnpm install
```

Common development and production commands for the default template:

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

CLI and generated-project checks:

```bash
pnpm create:build
pnpm test:e2e
pnpm test:smoke
```

`weapp-tailwindcss@5` generates Tailwind CSS at build time; the repository does not require an install-time patch or hook.

## HMR and Platform Verification

Repository-owned checks live under `scripts/template-tests/` and are not bundled into generated projects:

```bash
pnpm test:hmr:artifact:mp-weixin
pnpm test:hmr:h5
pnpm test:hmr:mp-weixin
pnpm test:hmr:app:android -- --device-id <android-device-id> --hbuilderx-cli <hbuilderx-cli>
pnpm test:hmr:app:ios -- --device-id <ios-simulator-uuid> --hbuilderx-cli <hbuilderx-cli>
pnpm test:app-css:artifact
pnpm test:hmr:all
```

The checks create a temporary test route and touch the Tailwind entry, then restore source files after normal completion, failure, or interruption. Screenshots, logs, and JSON/Markdown reports are written to the ignored `packages/template/.hmr-artifacts/` directory.

H5 checks require Google Chrome; WeChat runtime checks require logged-in DevTools with its service port enabled; App checks require an HBuilderX version matching the `@dcloudio/vite-plugin-uni` compiler, Android SDK/`adb` or Xcode command-line tools, and a target device. `test:app-css:artifact` checks an existing App build without compiling it again. CI only runs the headless artifact check and does not replace desktop runtime verification.

## Daily Comprehensive Testing

The `Quality` GitHub Actions workflow runs every day at 03:00 Asia/Shanghai. It covers repository checks, lint, the CLI build, five production targets, a Workers dry-run, fast E2E, and artifact-level WeChat HMR. The daily user lifecycle runs as a `candidate/latest × Node 22/24` matrix; its contract job requires every declared scenario to execute and compares normalized files, scripts, and dependency fingerprints between candidate and npm latest.

```bash
pnpm test:e2e:daily
pnpm test:e2e:daily:unit
pnpm test:daily:runtime
```

Lifecycle coverage of 100% means every required scenario executed, not line coverage. A `BLOCKED` scenario counts as executed but does not make the suite pass; any silent `SKIP` or missing scenario fails the contract. Missing desktop tools, login state, or devices should be reported as `BLOCKED`; create, build, and assertion failures are `FAIL`.

The local daily runner creates isolated candidate/latest projects and serially checks H5, WeChat DevTools, iOS Simulator, and the single online Android device. It only closes the Simulator and HBuilderX when it started them. Set `DAILY_IOS_DEVICE_ID` to pin the simulator, or pass `pnpm test:daily:runtime -- --skip-github` to skip cloud-run waiting. Reports are written to the ignored `packages/template/.hmr-artifacts/daily/summary.{json,md}`; exit codes `0`, `1`, and `2` mean pass, fail, and blocked.

## Adding a Template

1. Add the template source under `packages/` and declare it as a workspace package.
2. Register its ID, source directory, build targets, HMR targets, and H5 smoke text in `templates.json`.
3. Provide a `dev:<target>` script for every registered HMR target.
4. Run `pnpm create:build` and `pnpm test:e2e`.

The CLI bundles every registered template, and GitHub Actions derives its build and HMR matrices from the registry, so adding a template normally does not require workflow changes.

## Dependency, Code, and Test Conventions

- `pnpm update:deps` updates regular dependencies; `pnpm update:uni-app` uses DCloud UVM to update the uni-app compatibility set together.
- Follow `.editorconfig`: two-space indentation, LF line endings, and UTF-8. Use PascalCase for Vue components and camelCase for stores and utility modules.
- Put pages in `packages/template/src/pages/`, shared components in `src/components/`, stores in `src/stores/`, and assets in `src/static/`.
- The default quality gate is `pnpm lint`, `pnpm create:build`, and `pnpm test:e2e`; template runtime changes should also run the affected platform build.
- Keep TypeScript tests in the owning package with `*.spec.ts` names.

## Changes and Releases

Use short Conventional Commit prefixes such as `feat:`, `fix:`, `chore:`, and `chore(deps):`. User-visible changes to `create-uni-app-tailwindcss` or its bundled templates require a Chinese pnpm change summary.

```bash
pnpm release
pnpm release:status
pnpm repo:doctor
```

Commit the generated change intent with the user-visible change. The release workflow creates a version PR from pending intents and publishes the merged version to npm with provenance. Do not commit npm credentials or add a second release workflow.

See [AGENTS.md](./AGENTS.md) for the detailed project-agent conventions.
