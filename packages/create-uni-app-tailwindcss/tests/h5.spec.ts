import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { setTimeout as wait } from 'node:timers/promises'
import path from 'node:path'

const repoRoot = path.resolve(process.cwd(), '../..')
const templateRoot = path.join(repoRoot, 'packages/template')
const port = 5173

test('serves the template home page in h5', async ({ page }) => {
  const child = spawn('pnpm', ['--dir', templateRoot, 'dev:h5'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  })

  const close = async () => {
    if (!child.killed) {
      child.kill('SIGTERM')
      await wait(1000)
    }
  }

  child.stderr.on('data', chunk => process.stderr.write(chunk))
  child.stdout.on('data', chunk => process.stdout.write(chunk))

  try {
    await waitForServer(page)
    await page.goto(`http://127.0.0.1:${port}`)
    await expect(page.getByText('能力速览')).toBeVisible()
    await expect(page.getByText('一份模板，串联更多设计场景')).toBeVisible()
  }
  finally {
    await close()
  }
})

async function waitForServer(page: typeof import('@playwright/test').Page) {
  for (let i = 0; i < 60; i += 1) {
    try {
      await page.context().request.get(`http://127.0.0.1:${port}`)
      return
    }
    catch {
      await wait(1000)
    }
  }
  throw new Error('timed out waiting for h5 server')
}
