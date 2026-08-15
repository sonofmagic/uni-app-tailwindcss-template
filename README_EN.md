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
```

## Template HMR verification

The root scripts proxy the default template's artifact and runtime HMR checks:

```bash
pnpm test:hmr:artifact:mp-weixin
pnpm test:hmr:h5
pnpm test:hmr:mp-weixin
pnpm test:hmr:app:android -- --device-id <android-device-id> --hbuilderx-cli <hbuilderx-cli>
pnpm test:hmr:app:ios -- --device-id <ios-simulator-uuid> --hbuilderx-cli <hbuilderx-cli>
pnpm test:hmr:all
```

CI runs the headless artifact check for every registered HMR target. Desktop runtime requirements and evidence details are documented in [`packages/template/README.md`](packages/template/README.md#tailwind-css-hmr-四端验收).

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
3. Implement `test:hmr:artifact:<target>` for each registered HMR target.
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
