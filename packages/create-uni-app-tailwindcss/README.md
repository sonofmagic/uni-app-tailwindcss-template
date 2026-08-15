# create-uni-app-tailwindcss

Create a `uni-app + Vite + Vue 3 + Tailwind CSS` project.

```bash
pnpm create uni-app-tailwindcss my-app
```

Select a template explicitly for CI or other non-interactive use:

```bash
pnpm create uni-app-tailwindcss my-app --template default
```

When multiple templates are bundled and `--template` is omitted, the CLI prompts for one in interactive terminals and uses the registry default otherwise.

For local development in this monorepo:

```bash
pnpm install
pnpm create
pnpm test:e2e
```
