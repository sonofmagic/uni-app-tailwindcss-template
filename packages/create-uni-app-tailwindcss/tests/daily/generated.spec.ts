import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { access, appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { applyEdits, modify, parse } from 'jsonc-parser'
import { targetRequiredArtifacts, validateTargetArtifact as validateTargetArtifactContract } from '../../scripts/daily-contract.mjs'

const packageRoot = process.cwd()
const repoRoot = path.resolve(packageRoot, '../..')
const projectDir = process.env.USER_JOURNEY_PROJECT_ROOT ?? ''
const reportDir = process.env.USER_JOURNEY_REPORT_DIR ?? ''
const source = process.env.USER_JOURNEY_SOURCE ?? 'unknown'
const dailyPage = path.join(projectDir, 'src/pages/daily-user/index.vue')
const dailyUtilityMarker = '/* DAILY_USER_JOURNEY_UTILITY */'
const requiredStages = [
  'create', 'hygiene', 'install', 'frozen-install', 'user-edit', 'lint',
  'h5-dev', 'h5-desktop', 'h5-mobile', 'h5-hmr', 'mp-weixin-hmr',
  'build-h5', 'build-app', 'build-mp-weixin', 'build-mp-alipay', 'build-mp-toutiao',
  'deploy-h5-static', 'deploy-h5-workers', 'deploy-app',
  'deploy-mp-weixin', 'deploy-mp-alipay', 'deploy-mp-toutiao',
]
const stageJournalDir = path.join(reportDir, 'stages')
const activeChildren = new Set<ChildProcess>()
let devServer: ChildProcess | undefined
let devUrl = ''
let productionServer: ChildProcess | undefined
let productionUrl = ''
let hygieneViolations: string[] = []

test.describe('generated project user lifecycle', () => {
  test.beforeAll(async () => {
    if (!projectDir || !reportDir) throw new Error('Run through pnpm test:e2e:daily')
    await mkdir(reportDir, { recursive: true })
    await mkdir(stageJournalDir, { recursive: true })
    await record('create', 'PASS', { detail: `${source} explicit/default/unknown/existing-directory CLI scenarios passed` })
    hygieneViolations = await inspectHygiene()
    if (!await attempt('install', () => runCommand('pnpm', ['install'], projectDir))) {
      await runCommand('pnpm', ['install', '--ignore-scripts'], projectDir)
    }
    if (!await attempt('frozen-install', () => runCommand('pnpm', ['install', '--frozen-lockfile'], projectDir))) {
      await runCommand('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], projectDir)
    }
    const lockfile = await readFile(path.join(projectDir, 'pnpm-lock.yaml'), 'utf8')
    if (lockfile.includes(repoRoot)) hygieneViolations.push('Generated lockfile contains the repository path')
    if (/^\s+(?:specifier|version):\s+(?:link|workspace):/m.test(lockfile)) {
      hygieneViolations.push('Generated importer borrowed a workspace or link dependency')
    }
    await execute('user-edit', injectDailyPage)
    await execute('lint', () => runCommand('pnpm', ['run', 'lint'], projectDir))
    const port = await getFreePort()
    devUrl = `http://127.0.0.1:${port}`
    devServer = spawnManaged(packageManagerCommand(), ['run', 'dev:h5', '--port', String(port)], projectDir, 'h5-dev')
    await execute('h5-dev', () => waitForServer(devUrl))
  })

  test.afterAll(async () => {
    await stopAll()
    await writeSummary()
  })

  test('ships a clean standalone project contract', async () => {
    await execute('hygiene', async () => expect(hygieneViolations).toEqual([]))
  })

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`supports normal H5 development on ${viewport.name}`, async ({ page }) => {
      await execute(`h5-${viewport.name}`, async () => {
        const runtimeErrors: string[] = []
        page.on('pageerror', error => runtimeErrors.push(error.message))
        page.on('console', (entry) => {
          if (entry.type() === 'error') runtimeErrors.push(entry.text())
        })
        await page.setViewportSize(viewport)
        await page.goto(`${devUrl}/#/pages/daily-user/index`, { waitUntil: 'networkidle' })
        await expect(page.getByText('daily-user-initial')).toBeVisible()
        await expect(page.getByTestId('daily-counter-value')).toHaveText('0')
        await page.getByTestId('daily-counter').click()
        await expect(page.getByTestId('daily-counter-value')).toHaveText('1')
        await expect.poll(() => page.locator('img').evaluateAll(images => images.length > 0
          && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        expect(runtimeErrors).toEqual([])
      })
    })
  }

  test('preserves state across template and Tailwind HMR', async ({ page }) => {
    await execute('h5-hmr', async () => {
      await page.goto(`${devUrl}/#/pages/daily-user/index`, { waitUntil: 'networkidle' })
      await page.getByTestId('daily-counter').click()
      await expect(page.getByTestId('daily-counter-value')).toHaveText('1')
      const token = `hmr-${Date.now()}`
      await page.evaluate(value => ((window as Window & { __dailyHmrToken?: string }).__dailyHmrToken = value), token)
      await writeFile(dailyPage, renderDailyPage('updated'), 'utf8')
      const tailwind = path.join(projectDir, 'src/tailwind.css')
      const tailwindContent = await readFile(tailwind, 'utf8')
      await writeFile(tailwind, tailwindContent.replace('#0f766e', '#dc2626'), 'utf8')
      await expect(page.getByText('daily-user-updated')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('daily-counter-value')).toHaveText('1')
      expect(await page.evaluate(() => (window as Window & { __dailyHmrToken?: string }).__dailyHmrToken)).toBe(token)
      await expect.poll(() => page.getByTestId('daily-panel').evaluate(element => getComputedStyle(element).backgroundColor)).toContain('220')
      await expect.poll(async () => {
        const response = await fetch(`${devUrl}/src/tailwind.css?direct&daily=${Date.now()}`)
        return response.text()
      }).toContain('#dc2626')
    })
  })

  test('builds and validates all deployable targets', async ({ browser }) => {
    await stopProcess(devServer)
    devServer = undefined
    const failures: string[] = []
    if (!await attempt('mp-weixin-hmr', () => runCommand('node', [
      path.join(repoRoot, 'scripts/template-tests/hmr-smoke.mjs'),
      '--platform', 'mp-weixin', '--script', 'dev:mp-weixin', '--timeout', '240000',
    ], projectDir))) failures.push('mp-weixin-hmr')

    for (const target of ['h5', 'app', 'mp-weixin', 'mp-alipay', 'mp-toutiao']) {
      if (!await attempt(`build-${target}`, () => runCommand('pnpm', ['run', `build:${target}`], projectDir))) failures.push(`build-${target}`)
    }
    await writeArtifactManifest()

    if (!await attempt('deploy-h5-static', async () => {
      const output = path.join(projectDir, 'dist/build/h5')
      const port = await getFreePort()
      productionUrl = `http://127.0.0.1:${port}`
      productionServer = spawnManaged(process.execPath, [path.join(packageRoot, 'scripts/serve-static.mjs'), output, String(port)], projectDir, 'h5-production')
      await waitForServer(productionUrl)
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', (entry) => {
        if (entry.type() === 'error') errors.push(entry.text())
      })
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
      })
      await page.goto(`${productionUrl}/#/pages/daily-user/index`, { waitUntil: 'networkidle' })
      await expect(page.getByText('daily-user-updated')).toBeVisible()
      await expect.poll(() => page.locator('img').evaluateAll(images => images.length > 0
        && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
      const fallback = await page.request.get(`${productionUrl}/deployment/deep/link`)
      expect(fallback.ok()).toBe(true)
      expect(await fallback.text()).toContain('<div id="app">')
      expect(errors).toEqual([])
      await context.close()
      await stopProcess(productionServer)
      productionServer = undefined
    })) failures.push('deploy-h5-static')

    if (!await attempt('deploy-h5-workers', validateWorkersDryRun)) failures.push('deploy-h5-workers')
    for (const target of ['app', 'mp-weixin', 'mp-alipay', 'mp-toutiao']) {
      if (!await attempt(`deploy-${target}`, () => validateTargetArtifact(target))) failures.push(`deploy-${target}`)
    }
    expect(failures).toEqual([])
  })
})

async function injectDailyPage() {
  if (await fileExists(dailyPage)) return
  await mkdir(path.dirname(dailyPage), { recursive: true })
  await writeFile(dailyPage, renderDailyPage('initial'), 'utf8')
  const pagesPath = path.join(projectDir, 'src/pages.json')
  const sourceText = await readFile(pagesPath, 'utf8')
  const pages = parse(sourceText)?.pages
  if (!Array.isArray(pages)) throw new Error('Generated pages.json does not contain a pages array')
  if (!pages.some(page => page?.path === 'pages/daily-user/index')) {
    const edits = modify(sourceText, ['pages', pages.length], {
      path: 'pages/daily-user/index',
      style: { navigationBarTitleText: 'Daily User' },
    }, { formattingOptions: { insertSpaces: true, tabSize: 2 } })
    await writeFile(pagesPath, applyEdits(sourceText, edits), 'utf8')
  }
  const tailwindPath = path.join(projectDir, 'src/tailwind.css')
  const tailwind = await readFile(tailwindPath, 'utf8')
  await writeFile(tailwindPath, `${tailwind.trimEnd()}\n\n@source inline("bg-[#0f766e]");\n${dailyUtilityMarker}\n`)
}

function renderDailyPage(state: 'initial' | 'updated') {
  const updated = state === 'updated'
  return `<script setup lang="ts">
import { useCounterStore } from '@/stores/counter'

const store = useCounterStore()
const { count } = storeToRefs(store)
const { increment } = store
const panelStyle = { backgroundColor: '${updated ? '#dc2626' : '#0f766e'}' }
</script>

<template>
  <view class="min-h-screen bg-slate-50 p-4">
    <view
      data-testid="daily-panel"
      class="daily-user-surface ${updated ? 'h-[360rpx] rounded-[36rpx]' : 'h-[280rpx] rounded-[24rpx]'} flex flex-col items-center justify-center gap-4 text-white shadow-xl"
      :style="panelStyle"
    >
      <text class="text-[34rpx] font-bold">daily-user-${state}</text>
      <image class="h-[64rpx] w-[360rpx]" src="/static/images/weapp-tailwindcss.png" mode="aspectFit" />
      <text data-testid="daily-counter-value" class="text-[48rpx] font-bold">{{ count }}</text>
      <button data-testid="daily-counter" class="rounded-[18rpx] bg-white px-5 py-2 text-slate-900" @click="increment">
        increment
      </button>
    </view>
  </view>
</template>
`
}

async function inspectHygiene() {
  const violations: string[] = []
  const pkg = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'))
  for (const script of Object.keys(pkg.scripts ?? {})) {
    if (/^test:(?:hmr|app-css|e2e)/.test(script)) violations.push(`QA script: ${script}`)
  }
  for (const dependency of ['@dcloudio/uni-automator', '@playwright/test', 'playwright', 'pngjs']) {
    if (pkg.dependencies?.[dependency] || pkg.devDependencies?.[dependency]) violations.push(`QA dependency: ${dependency}`)
  }
  const files = await listFiles(projectDir)
  if (files.some(file => file.startsWith('scripts/'))) violations.push('QA scripts directory')
  for (const file of files.filter(file => /\.(?:[cm]?[jt]s|vue|json|md|css|scss|npmrc)$/.test(file))) {
    const content = await readFile(path.join(projectDir, file), 'utf8')
    if (/HMR_PROBE|HMR_SMOKE|hmr-smoke-file-event-bridge|\.hmr-artifacts/.test(content)) violations.push(`QA marker in ${file}`)
    if (content.includes(repoRoot)) violations.push(`Repository path leaked into ${file}`)
  }
  return violations
}

async function validateWorkersDryRun() {
  const configPath = path.join(reportDir, 'wrangler.user-journey.jsonc')
  const outdir = path.join(reportDir, 'wrangler-dry-run')
  await writeFile(configPath, `${JSON.stringify({
    assets: { directory: path.join(projectDir, 'dist/build/h5'), not_found_handling: 'single-page-application' },
    compatibility_date: '2026-08-16',
    name: `uni-user-journey-${source}`,
  }, null, 2)}\n`)
  await runCommand('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run', '--config', configPath, '--outdir', outdir], repoRoot)
  expect((await readdir(outdir)).length).toBeGreaterThan(0)
}

async function validateTargetArtifact(target: string) {
  const root = path.join(projectDir, 'dist/build', target)
  const required = targetRequiredArtifacts[target]
  for (const relative of required) expect((await readFile(path.join(root, relative))).length).toBeGreaterThan(0)
  const content = await readTextArtifacts(root)
  const failures = validateTargetArtifactContract(target, await listFiles(root), content, repoRoot)
  expect(failures).toEqual([])
  if (target === 'app') {
    await runCommand('node', [path.join(repoRoot, 'scripts/template-tests/app-css-smoke.mjs')], projectDir)
  }
}

async function readTextArtifacts(root: string) {
  const files = await listFiles(root)
  return (await Promise.all(files
    .filter(file => /\.(?:js|json|css|wxss|acss|ttss|wxml|axml|ttml)$/.test(file))
    .map(file => readFile(path.join(root, file), 'utf8')))).join('\n')
}

async function execute(name: string, action: () => Promise<unknown>) {
  const started = Date.now()
  try {
    await action()
    await record(name, 'PASS', { durationMs: Date.now() - started })
  }
  catch (error) {
    await record(name, 'FAIL', {
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function attempt(name: string, action: () => Promise<unknown>) {
  try {
    await execute(name, action)
    return true
  }
  catch {
    return false
  }
}

async function record(name: string, status: StageResult['status'], options: Pick<StageResult, 'detail' | 'durationMs' | 'error'> = {}) {
  const result = { durationMs: 0, name, status, ...options }
  const finalPath = path.join(stageJournalDir, `${name}.json`)
  const temporaryPath = `${finalPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`)
  await rename(temporaryPath, finalPath)
}

async function writeSummary() {
  const persistedStages = new Map<string, StageResult>()
  for (const name of requiredStages) {
    try {
      persistedStages.set(name, JSON.parse(await readFile(path.join(stageJournalDir, `${name}.json`), 'utf8')))
    }
    catch {}
  }
  const scenarioResults = requiredStages.map(name => persistedStages.get(name) ?? { durationMs: 0, error: 'Stage was not executed', name, status: 'MISSING' as const })
  const executed = scenarioResults.filter(stage => stage.status !== 'MISSING').length
  const summary = {
    coverage: { executed, percent: Math.round(executed / requiredStages.length * 100), required: requiredStages.length },
    generatedAt: new Date().toISOString(),
    node: process.version,
    source,
    stages: scenarioResults,
    status: executed === requiredStages.length && scenarioResults.every(stage => stage.status === 'PASS') ? 'PASS' : 'FAIL',
  }
  await writeFile(path.join(reportDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  const lines = [
    `# User journey: ${source}`,
    '',
    `Overall: **${summary.status}**`,
    `Coverage: **${executed}/${requiredStages.length} (${summary.coverage.percent}%)**`,
    '',
    '| Stage | Status | Detail |',
    '| --- | --- | --- |',
    ...scenarioResults.map(stage => `| ${stage.name} | ${stage.status} | ${(stage.error ?? stage.detail ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>')} |`),
    '',
  ]
  await writeFile(path.join(reportDir, 'summary.md'), `${lines.join('\n')}\n`)
}

function spawnManaged(command: string, args: string[], cwd: string, label: string, capture?: string[]) {
  const child = spawn(process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command, args, {
    cwd,
    detached: process.platform !== 'win32',
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeChildren.add(child)
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`)
    capture?.push(String(chunk))
    void appendFile(path.join(reportDir, 'runtime.log'), `[${label}] ${chunk}`).catch(() => {})
  })
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[${label}:err] ${chunk}`)
    capture?.push(String(chunk))
    void appendFile(path.join(reportDir, 'runtime.log'), `[${label}:err] ${chunk}`).catch(() => {})
  })
  child.once('exit', () => activeChildren.delete(child))
  return child
}

function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const captured: string[] = []
    const child = spawnManaged(command, args, cwd, path.basename(cwd), captured)
    child.once('error', reject)
    child.once('exit', async (code, signal) => {
      const logsDir = path.join(reportDir, 'logs')
      await mkdir(logsDir, { recursive: true })
      const commandLabel = [command, ...args.slice(0, 3)].join('-').replaceAll(/[^a-z0-9._-]+/gi, '-').slice(0, 100)
      await writeFile(path.join(logsDir, `${Date.now()}-${commandLabel}.log`), captured.join(''))
      if (signal) reject(new Error(`${command} terminated by ${signal}`))
      else if (code !== 0) reject(new Error(`${command} exited with ${code ?? 'null'}`))
      else resolve()
    })
  })
}

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const listener = net.createServer()
    listener.unref()
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address()
      if (!address || typeof address === 'string') reject(new Error('Failed to allocate port'))
      else listener.close(() => resolve(address.port))
    })
  })
}

async function waitForServer(url: string) {
  for (let attemptIndex = 0; attemptIndex < 180; attemptIndex += 1) {
    try {
      if ((await fetch(url)).ok) return
    }
    catch {}
    await wait(500)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function stopAll() {
  for (const child of [...activeChildren]) await stopProcess(child)
}

async function stopProcess(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else child.kill('SIGTERM')
  }
  catch {}
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(8_000)])
  if (child.exitCode === null) {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
      else child.kill('SIGKILL')
    }
    catch {}
  }
}

async function listFiles(root: string) {
  const files: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (['dist', 'node_modules', 'playwright-report', 'test-results'].includes(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(absolute)
      else files.push(path.relative(root, absolute).split(path.sep).join('/'))
    }
  }
  return files.sort()
}

async function fileExists(file: string) {
  try {
    await access(file)
    return true
  }
  catch {
    return false
  }
}

async function writeArtifactManifest() {
  const artifacts = []
  for (const target of ['h5', 'app', 'mp-weixin', 'mp-alipay', 'mp-toutiao']) {
    const root = path.join(projectDir, 'dist/build', target)
    if (!await fileExists(root)) continue
    for (const relative of await listFiles(root)) {
      artifacts.push({ path: `${target}/${relative}`, size: (await stat(path.join(root, relative))).size, target })
    }
  }
  const manifest = { generatedAt: new Date().toISOString(), source, artifacts }
  await writeFile(path.join(reportDir, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const lines = [
    `# Artifact manifest: ${source}`,
    '',
    '| Target | Path | Bytes |',
    '| --- | --- | ---: |',
    ...artifacts.map(artifact => `| ${artifact.target} | ${artifact.path} | ${artifact.size} |`),
    '',
  ]
  await writeFile(path.join(reportDir, 'artifact-manifest.md'), `${lines.join('\n')}\n`)
}

function packageManagerCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

type StageResult = {
  durationMs: number
  detail?: string
  error?: string
  name: string
  status: 'PASS' | 'FAIL' | 'MISSING'
}
