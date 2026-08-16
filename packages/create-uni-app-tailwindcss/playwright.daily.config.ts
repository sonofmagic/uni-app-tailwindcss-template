import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  globalTimeout: 35 * 60_000,
  outputDir: process.env.USER_JOURNEY_REPORT_DIR
    ? `${process.env.USER_JOURNEY_REPORT_DIR}/test-results`
    : './test-results/daily',
  reporter: [
    ['line'],
    ['html', {
      open: 'never',
      outputFolder: process.env.USER_JOURNEY_REPORT_DIR
        ? `${process.env.USER_JOURNEY_REPORT_DIR}/playwright-report`
        : './playwright-report/daily',
    }],
  ],
  testDir: './tests/daily',
  testIgnore: [],
  timeout: 20 * 60_000,
})
