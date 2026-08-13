import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as wait } from 'node:timers/promises'
import path from 'node:path'

const repoRoot = path.resolve(process.cwd(), '../..')
const registry = JSON.parse(readFileSync(path.join(repoRoot, 'templates.json'), 'utf8'))

for (const [index, template] of registry.templates.entries()) {
  test(`serves the ${template.id} template home page in h5`, async ({ page }) => {
    const port = 5173 + index
    const templateRoot = path.join(repoRoot, template.source)
    const child = spawn('pnpm', ['--dir', templateRoot, 'dev:h5', '--port', String(port)], {
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
      await waitForServer(page, port)
      await page.goto(`http://127.0.0.1:${port}`)
      for (const text of template.smokeText) {
        await expect(page.getByText(text)).toBeVisible()
      }
    }
    finally {
      await close()
    }
  })
}

async function waitForServer(page: typeof import('@playwright/test').Page, port: number) {
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
