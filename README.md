# uni-app-tailwindcss Monorepo

This workspace holds the publishable `pnpm create uni-app-tailwindcss` initializer and the template it copies.

## Packages

- `packages/template`: the uni-app template source used for local development and generation
- `packages/create-uni-app-tailwindcss`: the CLI that backs `pnpm create uni-app-tailwindcss`

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

That command copies the bundled template into `my-app`, rewrites the package name, and leaves you with a normal pnpm project.
