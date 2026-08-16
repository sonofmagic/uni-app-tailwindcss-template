import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdir, readFile, rm } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

const packageRoot = process.cwd()
const repoRoot = path.resolve(packageRoot, '../..')
let temporaryRoot: string
let projectDir: string
let server: ChildProcess | undefined
let serverUrl: string

test.describe.serial('generated default project', () => {
  test.beforeAll(async () => {
    temporaryRoot = process.env.DAILY_E2E_TEMP_ROOT ?? ''
    if (!temporaryRoot) throw new Error('Run daily E2E through pnpm test:e2e:daily')
    await mkdir(temporaryRoot, { recursive: true })
    projectDir = path.join(temporaryRoot, 'standalone-app')
    expect(path.relative(repoRoot, projectDir).startsWith('..')).toBe(true)
    await runCommand('pnpm', [
      '--dir', packageRoot, 'run', 'start', '--', projectDir,
      '--template=default', '--package-manager=pnpm',
    ], repoRoot)
    await runCommand('pnpm', ['install'], projectDir)
    await runCommand('pnpm', ['run', 'build:h5'], projectDir)
    await runCommand('pnpm', ['run', 'build:mp-weixin'], projectDir)

    const port = await getFreePort()
    serverUrl = `http://127.0.0.1:${port}`
    server = spawn(packageManagerCommand(), ['run', 'dev:h5', '--port', String(port)], {
      cwd: projectDir,
      detached: process.platform !== 'win32',
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout?.on('data', chunk => process.stdout.write(`[generated:h5] ${chunk}`))
    server.stderr?.on('data', chunk => process.stderr.write(`[generated:h5:err] ${chunk}`))
    await waitForServer(serverUrl)
  })

  test.afterAll(async () => {
    await stopProcess(server)
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  test('builds standalone H5 and WeChat artifacts', async () => {
    await expectFile(path.join(projectDir, 'dist/build/h5/index.html'))
    await expectFile(path.join(projectDir, 'dist/build/mp-weixin/app.json'))
    await expectFile(path.join(projectDir, 'dist/build/mp-weixin/pages/index/index.wxml'))
    await expectFile(path.join(projectDir, 'pnpm-workspace.yaml'))
    const pkg = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('standalone-app')
    for (const script of ['test:hmr:h5', 'test:hmr:mp-weixin', 'test:app-css', 'test:e2e']) {
      expect(pkg.scripts[script]).toBeUndefined()
    }
    for (const dependency of ['@dcloudio/uni-automator', '@playwright/test', 'playwright', 'pngjs']) {
      expect(pkg.devDependencies[dependency]).toBeUndefined()
    }
    await expect(access(path.join(projectDir, 'scripts'))).rejects.toThrow()
    await expect(access(path.join(projectDir, '.hmr-artifacts'))).rejects.toThrow()
    await expect(access(path.join(projectDir, 'playwright-report'))).rejects.toThrow()
    await expect(access(path.join(projectDir, 'test-results'))).rejects.toThrow()
  })

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`renders and interacts on ${viewport.name}`, async ({ page }) => {
      page.setDefaultTimeout(15_000)
      page.setDefaultNavigationTimeout(15_000)
      const runtimeErrors: string[] = []
      page.on('pageerror', error => runtimeErrors.push(error.message))
      page.on('console', (entry) => {
        if (entry.type() === 'error') runtimeErrors.push(entry.text())
      })
      await page.setViewportSize(viewport)
      await page.goto(serverUrl, { waitUntil: 'commit' })

      await expect(page.getByText('能力速览')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('一份模板，串联更多设计场景')).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => page.locator('img').evaluateAll(images => images.length > 0
        && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)), {
        timeout: 15_000,
      }).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

      const incrementButton = page.getByText('click to inc', { exact: true })
      const experienceCard = incrementButton.locator('..')
      await incrementButton.scrollIntoViewIfNeeded()
      await expect(incrementButton).toBeEnabled()
      await expect(experienceCard.getByText('0', { exact: true })).toBeVisible()
      const initialBackground = await incrementButton.evaluate(element => getComputedStyle(element).backgroundColor)
      await incrementButton.click({ timeout: 15_000 })
      await expect(experienceCard.getByText('1', { exact: true })).toBeVisible()
      await expect.poll(() => incrementButton.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(initialBackground)
      expect(runtimeErrors).toEqual([])
    })
  }
})

async function expectFile(filePath: string) {
  expect((await readFile(filePath)).length).toBeGreaterThan(0)
}

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const listener = net.createServer()
    listener.unref()
    listener.on('error', reject)
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate an H5 port'))
        return
      }
      listener.close(() => resolve(address.port))
    })
  })
}

async function waitForServer(url: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    }
    catch {}
    await wait(500)
  }
  throw new Error(`Timed out waiting for generated H5 server at ${url}`)
}

async function stopProcess(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else child.kill('SIGTERM')
  }
  catch {
    child.kill('SIGTERM')
  }
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(8_000)])
  if (child.exitCode === null) {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
      else child.kill('SIGKILL')
    }
    catch {}
  }
}

function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`))
      else if (code !== 0) reject(new Error(`${command} exited with ${code ?? 'null'}`))
      else resolve()
    })
  })
}

function packageManagerCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}
