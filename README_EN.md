# uni-app-tailwindcss-template

[简体中文](./README.md) | English

This repository holds the publishable `pnpm create uni-app-tailwindcss` initializer and its registered templates. Source and releases are hosted at [sonofmagic/uni-app-tailwindcss-template](https://github.com/sonofmagic/uni-app-tailwindcss-template).

## Packages

- `packages/template`: the default uni-app template source used for local development and generation
- `packages/create-uni-app-tailwindcss`: the CLI that backs `pnpm create uni-app-tailwindcss`
- `templates.json`: the template registry used by the CLI, root scripts, and CI matrices

## Local development

```bash
pnpm install
pnpm dev:h5
pnpm dev:mp-weixin
pnpm test:smoke
pnpm test:e2e
pnpm test:e2e:daily
```

`test:e2e` is the fast scaffolding gate used on pull requests. `test:e2e:daily` checks both the locally packed candidate and npm `latest` by default; pass `--source candidate|latest|all` to select a source. Each source is created with its real create command in a system temporary directory, then goes through independent install and frozen reinstall, normal edits, lint, H5 development/HMR, incremental WeChat compilation, five production targets, static H5 serving, and a side-effect-free Workers dry-run.

## Template HMR verification

Repository-owned checks live under `scripts/template-tests/` and run against the default template. They are not bundled into generated projects:

```bash
pnpm test:hmr:artifact:mp-weixin
pnpm test:hmr:h5
pnpm test:hmr:mp-weixin
pnpm test:hmr:app:android -- --device-id <android-device-id> --hbuilderx-cli <hbuilderx-cli>
pnpm test:hmr:app:ios -- --device-id <ios-simulator-uuid> --hbuilderx-cli <hbuilderx-cli>
pnpm test:app-css:artifact
pnpm test:hmr:all
```

The checks create a test-owned temporary route and touch the Tailwind entry directly, then restore every source file after normal completion, failure, or interruption. The public template contains no HMR probes, bridges, or QA scripts. Evidence is written to the ignored `packages/template/.hmr-artifacts/` directory. H5 checks require Google Chrome, WeChat runtime checks require logged-in DevTools with its service port enabled, and App checks require an HBuilderX version matching the `@dcloudio/vite-plugin-uni` compiler plus the relevant Android or iOS tooling. `test:app-css:artifact` checks an existing App build without compiling it again. CI only runs the headless artifact check; it does not replace real runtime verification.

## Daily comprehensive testing

The `Quality` GitHub Actions workflow starts every day at 03:00 Asia/Shanghai. Separate jobs cover repository health, lint, the create CLI, five production targets, a Workers dry-run, fast E2E, and artifact-level WeChat HMR. The daily user journey runs as a `candidate/latest × Node 22/24` matrix. A contract job requires every declared scenario to execute and compares normalized files, scripts, and dependency fingerprints between the candidate and npm latest. Latest drift or a broken public package is a strict `FAIL`; evidence is retained for seven days.

Lifecycle coverage of 100% means `required scenarios executed / required scenarios = 100%`, not line coverage or an exhaustive set of all possible combinations. A `BLOCKED` scenario counts as executed but does not make the suite pass. Any silent `SKIP` or missing scenario fails the contract.

The current npm `create-uni-app-tailwindcss@latest` (`0.1.0`) still emits the old QA scripts, so the first latest canary is expected to be a strict `FAIL`. The tests never publish or upload a real application.

Run the complementary local runtime suite at 03:10 with:

```bash
pnpm test:daily:runtime
```

The runner uses `caffeinate`, creates and independently installs candidate and latest projects, then runs H5, WeChat DevTools, iOS Simulator, and the single online Android device serially for each source. It finally waits up to 45 minutes for that day's scheduled GitHub run. It only closes Simulator and HBuilderX when it started them. Missing tools, login, or devices produce `BLOCKED`; create, build, or assertion failures produce `FAIL`. Reports include source, platform, repair commands, and the GitHub run URL under the ignored `packages/template/.hmr-artifacts/daily/summary.{json,md}`, with exit codes `0` for pass, `1` for failure, and `2` for blocked. Set `DAILY_IOS_DEVICE_ID` to pin the simulator, or pass `--skip-github` when validating only local runtimes.

## Create a new project

```bash
pnpm create uni-app-tailwindcss my-app
```

Use `--template <id>` to select a registered template in CI or other non-interactive environments:

```bash
pnpm create uni-app-tailwindcss my-app --template default
```

The command copies the selected bundled template into `my-app`, rewrites the package name, and leaves you with a standalone pnpm project.

## Update dependencies

Use separate commands for regular dependencies and the uni-app compiler toolchain:

```bash
pnpm update:deps
pnpm update:uni-app
```

`update:deps` interactively updates regular dependencies in the default template while leaving the DCloud-managed uni-app compatibility set unchanged. `update:uni-app` uses the official UVM tool to update that compatibility set together.

## Add a template

1. Add its source as a workspace package under `packages/`.
2. Register its ID, source, build targets, HMR targets, and H5 smoke text in `templates.json`.
3. Provide `dev:<target>` for each registered HMR target; the repository runner supplies the artifact check.
4. Run `pnpm create:build` and `pnpm test:e2e`.

The create package bundles every registered template. GitHub Actions also derives its build and HMR matrices from the registry, so new templates do not require workflow edits.

## Release

Package versions and releases use pnpm native versioning with repoctl:

```bash
pnpm release
pnpm release:status
pnpm repo:doctor
```

Commit the generated change intent with the user-visible change. The release workflow creates a version PR from pending intents and publishes the merged version to npm with provenance.
