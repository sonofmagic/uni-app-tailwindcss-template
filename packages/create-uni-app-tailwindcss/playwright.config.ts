import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: 'daily/**',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [
    ['line'],
    ['html', { open: 'never' }],
  ],
  workers: 1,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
