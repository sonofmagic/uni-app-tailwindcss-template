import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as wait } from 'node:timers/promises'
import path from 'node:path'

const repoRoot = path.resolve(process.cwd(), '../..')
const registry = JSON.parse(readFileSync(path.join(repoRoot, 'templates.json'), 'utf8'))
const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

for (const [index, template] of registry.templates.entries()) {
  for (const viewport of viewports) {
    test(`serves the ${template.id} template home page in h5 (${viewport.name})`, async ({ page }) => {
      const port = 5173 + index
      const templateRoot = path.join(repoRoot, template.source)
      const child = spawn('pnpm', ['--dir', templateRoot, 'dev:h5', '--port', String(port)], {
        cwd: repoRoot,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FORCE_COLOR: '0',
        },
      })
      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      page.on('pageerror', error => pageErrors.push(error.message))
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      await page.setViewportSize({ width: viewport.width, height: viewport.height })

      const close = async () => {
        if (child.exitCode !== null || child.signalCode !== null) return
        try {
          if (process.platform === 'win32') child.kill('SIGTERM')
          else process.kill(-child.pid, 'SIGTERM')
        }
        catch {}
        await Promise.race([
          new Promise(resolve => child.once('exit', resolve)),
          wait(1000),
        ])
        if (child.exitCode === null && child.signalCode === null) {
          try {
            if (process.platform === 'win32') child.kill('SIGKILL')
            else process.kill(-child.pid, 'SIGKILL')
          }
          catch {}
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

        const images = page.locator('img')
        await expect(images.first()).toBeVisible()
        const imageStates = await images.evaluateAll(elements => elements.map(element => {
          const image = element as HTMLImageElement
          return { complete: image.complete, naturalWidth: image.naturalWidth }
        }))
        expect(imageStates.length).toBeGreaterThan(0)
        expect(imageStates.every(image => image.complete && image.naturalWidth > 0)).toBe(true)

        const pageRoot = page.locator('.safe-area-bottom').first()
        await expect(pageRoot).toHaveClass(/bg-\[radial-gradient/)
        const pageRootStyles = await pageRoot.evaluate(element => {
          const styles = getComputedStyle(element)
          return { backgroundImage: styles.backgroundImage, paddingBottom: styles.paddingBottom }
        })
        expect(pageRootStyles.backgroundImage).toContain('radial-gradient')
        expect(pageRootStyles.paddingBottom).not.toBe('0px')

        await expect(page.locator('[class*="i-[mdi--github-circle]"]').first()).toBeVisible()

        const hostVariant = page.locator('[class*="not-wx:bg-red-500"]').first()
        await expect(hostVariant).toBeVisible()
        const hostBackground = await hostVariant.evaluate(element => getComputedStyle(element).backgroundColor)
        expect(hostBackground.replaceAll(' ', '')).toContain('251,44,54')

        const customButton = page.locator('.btn').first()
        await expect(customButton).toBeVisible()
        const buttonStyles = await customButton.evaluate(element => {
          const styles = getComputedStyle(element)
          return { display: styles.display, backgroundImage: styles.backgroundImage }
        })
        expect(['flex', 'inline-flex']).toContain(buttonStyles.display)
        expect(buttonStyles.backgroundImage).toContain('linear-gradient')

        const incrementButton = page.locator('uni-button').filter({ hasText: 'click to inc' })
        const counter = incrementButton.locator('xpath=..').locator('.text-3xl').first()
        await expect(counter).toHaveText('0')
        await incrementButton.click()
        await expect(counter).toHaveText('1')

        const dimensions = await page.evaluate(() => ({
          bodyWidth: document.body.scrollWidth,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        }))
        expect(Math.max(dimensions.bodyWidth, dimensions.documentWidth)).toBeLessThanOrEqual(dimensions.viewportWidth + 1)
        expect(pageErrors).toEqual([])
        expect(consoleErrors).toEqual([])
      }
      finally {
        await close()
      }
    })
  }
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
