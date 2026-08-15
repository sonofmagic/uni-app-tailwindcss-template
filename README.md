# uni-app-tailwindcss-template

This repository holds the publishable `pnpm create uni-app-tailwindcss` initializer and its registered templates. Source and releases are hosted at [sonofmagic/uni-app-tailwindcss-template](https://github.com/sonofmagic/uni-app-tailwindcss-template).

## Packages

- `packages/template`: the default uni-app template source used for local development and generation
- `packages/create-uni-app-tailwindcss`: the CLI that backs `pnpm create uni-app-tailwindcss`
- `templates.json`: the template registry used by the CLI, root scripts, and CI matrices

## Usage

```bash
pnpm install
pnpm dev:h5
pnpm dev:mp-weixin
pnpm test:smoke
pnpm test:e2e
```

## Create a new project

```bash
pnpm create uni-app-tailwindcss my-app
```

Use `--template <id>` to select a registered template without an interactive prompt:

```bash
pnpm create uni-app-tailwindcss my-app --template default
```

The command copies the selected bundled template into `my-app`, rewrites the package name, and leaves you with a normal pnpm project.

## Add a template

1. Add its source as a workspace package under `packages/`.
2. Register its id, source, build targets, HMR targets, and H5 smoke text in `templates.json`.
3. Run `pnpm create:build` and `pnpm test:e2e`.

The create package bundles every registered template. GitHub Actions also derives its build and HMR matrices from the registry, so new templates do not require workflow edits.

## Release

Package versions and releases use pnpm native versioning with repoctl:

```bash
pnpm release
pnpm release:status
pnpm repo:doctor
```

Commit the generated change intent with the user-visible change. The release workflow creates a version PR from pending intents and publishes the merged version to npm with provenance.
