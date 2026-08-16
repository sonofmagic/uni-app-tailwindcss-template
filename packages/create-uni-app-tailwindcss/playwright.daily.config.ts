import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  globalTimeout: 35 * 60_000,
  testDir: './tests/daily',
  testIgnore: [],
  timeout: 20 * 60_000,
})
