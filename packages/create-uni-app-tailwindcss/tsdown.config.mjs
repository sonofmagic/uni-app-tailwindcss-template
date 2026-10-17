import { defineConfig } from 'tsdown'

export default defineConfig({
  // Keep the published CLI entry at dist/cli.js for the package bin and
  // generated-project start command, while retaining native ESM semantics.
  fixedExtension: false,
})
