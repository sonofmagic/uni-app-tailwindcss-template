#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { PNG } from 'pngjs'
import { createFixtureController, getFixtureState } from './hmr-fixture.mjs'

const require = createRequire(import.meta.url)
const { Automator } = require('@dcloudio/uni-automator')
const { chromium } = require('playwright')

const cwd = process.cwd()
const args = parseArgs(process.argv.slice(2))
const timeoutMs = Number(args.timeout ?? 240_000)
const reportRoot = path.resolve(args['report-dir'] ?? '.hmr-artifacts')
const bridgeFile = path.resolve('.hmr-artifacts/.file-event-bridge')
const supportedPlatforms = ['h5', 'mp-weixin', 'app-android', 'app-ios']
const platforms = args.all ? supportedPlatforms : [args.platform]
const results = []

let fixture
let fatalError
let environment = collectBaseEnvironment()
let activeChild
let activeChildStopSignal = 'SIGTERM'
let activeProgram
let activeBrowser
let activePage
let restoreAutomatorEnvironment
let activeDeviceId
let interrupted = false

installSignalHandler('SIGINT')
installSignalHandler('SIGTERM')
process.once('exit', () => fixture?.restoreSync())

main().catch((error) => {
  fatalError = error instanceof Error ? error.message : String(error)
  console.error(`\n[hmr-runtime] FAILED: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
}).finally(async () => {
  await cleanup()
  if (results.length > 0 || fatalError) {
    await writeSummary()
  }
})

async function main() {
  if (platforms.some(platform => !supportedPlatforms.includes(platform))) {
    throw new Error(`Use --platform ${supportedPlatforms.join('|')} or --all`)
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout must be a positive number of milliseconds')
  }
  if (args.all && args['device-id']) {
    throw new Error('--device-id cannot be shared by Android and iOS when using --all')
  }

  await fs.mkdir(reportRoot, { recursive: true })
  environment = collectEnvironment(platforms)
  await preflight(platforms)

  for (const platform of platforms) {
    if (interrupted) {
      break
    }
    const result = { platform, status: 'FAIL', startedAt: new Date().toISOString() }
    const startedAt = Date.now()
    results.push(result)
    try {
      fixture = await createFixtureController()
      Object.assign(result, await runPlatform(platform))
      result.status = 'PASS'
      console.log(`[hmr-runtime] ${platform}: PASS`)
    }
    catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
      console.error(`[hmr-runtime] ${platform}: FAIL: ${result.error}`)
      if (!args.all) {
        throw error
      }
      process.exitCode = 1
    }
    finally {
      result.durationMs = Date.now() - startedAt
      result.finishedAt = new Date().toISOString()
      await cleanupPlatform()
      await fixture?.restore()
    }
  }
}

async function runPlatform(platform) {
  const reportDir = path.join(reportRoot, platform)
  await fs.rm(reportDir, { recursive: true, force: true })
  await fs.mkdir(reportDir, { recursive: true })

  await fixture.apply('initial')
  if (platform.startsWith('app-')) {
    return runAppPlatform(platform, reportDir)
  }
  const port = await getFreePort()
  const env = {
    ...process.env,
    FORCE_COLOR: '0',
    CHOKIDAR_INTERVAL: '200',
    CHOKIDAR_USEPOLLING: 'true',
    UNI_AUTOMATOR_COMPILE: 'false',
    HMR_SMOKE_USE_POLLING: 'true',
  }
  if (platform !== 'h5') {
    env.UNI_AUTOMATOR_WS_ENDPOINT = `ws://localhost:${port}`
  }

  const launch = await startPlatform(platform, env, port)
  const logs = []
  activeChild = launch.child
  collectLogs(activeChild, logs, platform)

  await launch.ready
  const runtimeErrors = []
  if (platform === 'h5') {
    activeBrowser = await chromium.launch({ executablePath: chromePath(), headless: true })
    activePage = await activeBrowser.newPage({ viewport: { width: 375, height: 667 } })
    activePage.on('websocket', (socket) => {
      socket.on('framereceived', (event) => {
        const text = String(event.payload)
        const label = text.includes('"type":"update"')
          ? 'hmr update'
          : text.includes('"type":"full-reload"') ? 'page reload' : 'received'
        logs.push({ time: Date.now(), stream: 'websocket', text: `${label}:${text}\n` })
      })
      socket.on('framesent', event => logs.push({ time: Date.now(), stream: 'websocket', text: `sent:${event.payload}\n` }))
    })
    activePage.on('pageerror', error => runtimeErrors.push(error.message))
    activePage.on('console', (entry) => {
      if (entry.type() === 'error' && !entry.text().startsWith('Failed to load resource:')) {
        runtimeErrors.push(entry.text())
      }
    })
    await activePage.goto(launch.url)
  }
  else {
    activeProgram = await connectAutomator(platform, port)
    activeProgram.on('exception', error => runtimeErrors.push(String(error?.message ?? error)))
    activeProgram.on('console', (entry) => {
      if (entry?.type === 'error') {
        runtimeErrors.push(entry.args?.join(' ') ?? String(entry))
      }
    })
  }

  const initial = await waitForRuntimeState(activeProgram, platform, 'initial')
  await takeScreenshot(platform, path.join(reportDir, 'initial.png'))

  await sleep(1_500)
  const changedAt = Date.now()
  await fixture.apply('updated')
  let transformedSource
  const hmrLog = await waitForHmrLog(logs, platform, changedAt)
  if (platform === 'h5') {
    transformedSource = await waitForTransformedFixture(launch.url, getFixtureState('updated').text)
  }
  const updated = await waitForRuntimeState(activeProgram, platform, 'updated')
  await takeScreenshot(platform, path.join(reportDir, 'updated.png'))

  if (runtimeErrors.length > 0) {
    throw new Error(`Runtime errors: ${runtimeErrors.join(' | ')}`)
  }

  const pixels = await compareScreenshots(
    path.join(reportDir, 'initial.png'),
    path.join(reportDir, 'updated.png'),
  )
  if (pixels.changedPixels === 0) {
    throw new Error('Runtime screenshot did not change after the HMR update')
  }

  await fs.writeFile(path.join(reportDir, 'dev.log'), logs.map(entry => entry.text).join(''), 'utf8')
  const evidence = { initial, updated, hmrLog, pixels, runtimeErrors, transformedSource }
  await fs.writeFile(path.join(reportDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  return evidence
}

async function runAppPlatform(platform, reportDir) {
  await fs.mkdir(path.dirname(bridgeFile), { recursive: true })
  await fs.writeFile(bridgeFile, `${process.pid}\n`, 'utf8')
  const deviceId = resolveDeviceId(platform)
  activeDeviceId = deviceId
  const cli = hbuilderxPaths().cli
  const launchArgs = [
    'launch',
    platform,
    '--project',
    cwd,
    '--deviceId',
    deviceId,
    '--playground',
    'standard',
  ]
  if (platform === 'app-ios') {
    launchArgs.push('--iosTarget', 'simulator')
  }
  const logs = []
  activeChild = spawn(cli, launchArgs, {
    cwd,
    detached: true,
    env: {
      ...process.env,
      CHOKIDAR_INTERVAL: '200',
      CHOKIDAR_USEPOLLING: 'true',
      HMR_SMOKE_USE_POLLING: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeChildStopSignal = 'SIGINT'
  collectLogs(activeChild, logs, platform)
  await waitForOutput(activeChild, /应用【.*】已启动|项目 \[.*\] 已启动|App Launch/i, timeoutMs)

  const initial = await waitForAppState(platform, 'initial')
  await captureAppScreenshot(platform, path.join(reportDir, 'initial.png'))
  const pidBefore = appProcessId(platform)

  const changedAt = Date.now()
  await fixture.apply('updated')
  const hmrLog = await waitForHmrLog(logs, platform, changedAt)
  let updated
  let updateError
  try {
    updated = await waitForAppState(platform, 'updated')
  }
  catch (error) {
    updated = error.appState
    updateError = error
  }
  await captureAppScreenshot(platform, path.join(reportDir, 'updated.png'))
  const pidAfter = appProcessId(platform)
  if (!pidBefore || pidBefore !== pidAfter) {
    throw new Error(`${platform} process changed during HMR: ${pidBefore || 'none'} -> ${pidAfter || 'none'}`)
  }

  const pixels = await compareScreenshots(
    path.join(reportDir, 'initial.png'),
    path.join(reportDir, 'updated.png'),
  )
  if (updateError) {
    const logText = logs.map(entry => entry.text).join('')
    await fs.writeFile(path.join(reportDir, 'dev.log'), logText, 'utf8')
    const evidence = {
      initial,
      updated,
      hmrLog,
      pixels,
      runtimeErrors: parseHbuilderxRuntimeErrors(logText),
      appSync: { deviceId, pidBefore, pidAfter, changedAt },
      failure: 'Updated runtime state did not apply the script-side Tailwind class',
    }
    await fs.writeFile(path.join(reportDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    throw new Error(`${evidence.failure}; last=${JSON.stringify(updated)}`)
  }
  if (pixels.changedPixels === 0 || updated.colorBounds.height <= initial.colorBounds.height + 15) {
    throw new Error(`${platform} screenshot did not show the expected HMR geometry change`)
  }
  const logText = logs.map(entry => entry.text).join('')
  const runtimeErrors = parseHbuilderxRuntimeErrors(logText)
  if (runtimeErrors.length > 0) {
    throw new Error(`Runtime errors: ${runtimeErrors.join(' | ')}`)
  }

  await fs.writeFile(path.join(reportDir, 'dev.log'), logText, 'utf8')
  const evidence = {
    initial,
    updated,
    hmrLog,
    pixels,
    runtimeErrors,
    appSync: { deviceId, pidBefore, pidAfter, changedAt },
  }
  await fs.writeFile(path.join(reportDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  return evidence
}

async function waitForAppState(platform, stateName, waitMs = timeoutMs) {
  const expected = getFixtureState(stateName)
  const color = hexToRgb(expected.colorClass.match(/#[0-9a-f]+/i)[0])
  let last
  try {
    await waitUntil(async () => {
      await dismissRuntimeWarning(platform)
      const screenshot = await captureAppScreenshotBuffer(platform)
      const image = await parsePng(screenshot)
      const colorBounds = findColorBounds(image, color)
      const borderBounds = findColorBounds(image, [255, 35, 87], 12)
      const resources = await readDeviceAppResources(platform)
      last = {
        colorBounds,
        borderBounds,
        resources: {
          cssHasColor: resources.css.includes(expected.colorClass.slice(4, -1).toLowerCase()),
          cssHasRadius: resources.css.includes(stateName === 'initial' ? '18rpx' : '30rpx'),
          marker: resources.service.includes(expected.text),
          pseudoCss: resources.css.includes(expected.pseudo),
          pseudoTemplate: resources.service.includes(expected.pseudo),
        },
      }
      return colorBounds.pixels > 1_000
        && borderBounds.pixels > 200
        && Object.values(last.resources).every(Boolean)
    }, waitMs, 1_000)
  }
  catch (error) {
    error.appState = last
    throw error
  }
  return last
}

async function startPlatform(platform, env, port) {
  if (platform === 'h5') {
    const child = spawnUni(['--host', '--port', String(port)], env)
    return {
      child,
      ready: waitForOutput(child, /Local:\s+http:\/\/\S+/, timeoutMs),
      url: `http://127.0.0.1:${port}`,
    }
  }

  const outputPlatform = platform.startsWith('app-') ? 'app' : platform
  const child = spawnUni(['-p', outputPlatform], env)
  const automatorFile = path.join(cwd, 'dist', 'dev', '.automator', outputPlatform, '.automator.json')
  return {
    child,
    ready: waitForFile(automatorFile, content => content.includes(`localhost:${port}`), timeoutMs),
  }
}

async function connectAutomator(platform, port) {
  const automator = new Automator()
  const common = { projectPath: cwd, cliPath: cwd, compile: false, port, timeout: timeoutMs }
  restoreAutomatorEnvironment = setEnvironment({
    UNI_AUTOMATOR_COMPILE: 'false',
    UNI_AUTOMATOR_WS_ENDPOINT: `ws://localhost:${port}`,
    UNI_OUTPUT_DIR: path.join(cwd, 'dist', 'dev', platform),
  })

  return automator.launch({
    ...common,
    platform,
    'mp-weixin': {
      executablePath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      teardown: 'disconnect',
    },
  })
}

async function waitForRuntimeState(program, platform, stateName) {
  const expected = getFixtureState(stateName)
  const expectedColor = hexToRgb(expected.colorClass.match(/#[0-9a-f]+/i)[0])
  let last

  try {
    await waitUntil(async () => {
      if (platform === 'h5') {
        last = await readH5RuntimeState(program)
      }
      else {
        last = await readElementRuntimeState(program)
        last.generatedStyles = await readGeneratedStyleEvidence(platform, stateName)
      }
      if (last.element === 'not found') {
        return false
      }
      last.assertions = {
        marker: last.marker === expected.text,
        backgroundColor: includesRgb(last.backgroundColor, expectedColor),
        baseLayout: last.size.width > 100 && Number.parseInt(last.fontWeight, 10) >= 600,
        platformBorder: isPlatformBorder(last.borderColor, platform),
        height: last.size.height > (stateName === 'initial' ? 40 : 55),
        radius: matchesRadius(last.borderRadius, stateName),
        pseudo: platform === 'h5'
          ? last.pseudoContent.includes(expected.pseudo.replaceAll('_', ' '))
          : Object.values(last.generatedStyles).every(Boolean),
        text: last.text.includes(expected.text),
      }
      return Object.values(last.assertions).every(Boolean)
    }, timeoutMs, 600)
  }
  catch (error) {
    throw new Error(`${error.message}; expected=${JSON.stringify({ stateName, ...expected })}; last runtime state=${JSON.stringify(last)}`)
  }

  return last
}

async function readElementRuntimeState(program) {
  const page = await program.currentPage()
  const element = await page.$('.hmr-runtime-probe')
  if (!element) {
    return { element: 'not found' }
  }
  return {
    text: await element.text(),
    marker: await element.attribute('data-hmr-probe'),
    backgroundColor: await element.style('background-color'),
    borderColor: await element.style('border-color'),
    borderRadius: await element.style('border-radius'),
    fontWeight: await element.style('font-weight'),
    height: await element.style('height'),
    size: await element.size(),
  }
}

async function readH5RuntimeState(program) {
  return activePage.evaluate(() => {
    const element = document.querySelector('.hmr-runtime-probe')
    if (!element) {
      return { element: 'not found' }
    }
    const style = getComputedStyle(element)
    return {
      text: element.textContent,
      marker: element.getAttribute('data-hmr-probe'),
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      fontWeight: style.fontWeight,
      height: style.height,
      pseudoContent: getComputedStyle(element, '::before').content,
      size: {
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      },
    }
  })
}

async function takeScreenshot(platform, outputPath) {
  if (platform === 'h5') {
    await activePage.screenshot({ path: outputPath, fullPage: true })
    return
  }
  await activeProgram.screenshot({ path: outputPath })
}

async function readGeneratedStyleEvidence(platform, stateName) {
  const expected = getFixtureState(stateName)
  const outputDir = path.join(cwd, 'dist', 'dev', platform)
  const files = []
  const stack = [outputDir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    }
    catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      }
      else if (path.extname(entry.name) === '.wxss') {
        files.push(fullPath)
      }
    }
  }
  const css = (await Promise.all(files.map(file => fs.readFile(file, 'utf8')))).join('\n').toLowerCase()
  const color = expected.colorClass.match(/#[0-9a-f]+/i)?.[0].toLowerCase()
  const radius = stateName === 'initial' ? '18rpx' : '30rpx'
  return {
    color: Boolean(color && css.includes(color)),
    pseudo: css.includes(expected.pseudo.toLowerCase()),
    radius: css.includes(radius),
  }
}

async function waitForHmrLog(logs, platform, changedAt) {
  const matcher = platform === 'h5'
    ? /hmr update|page reload/i
    : /Incremental Compiling|开始差量编译|Build complete|compiled successfully/i
  let matched
  await waitUntil(() => {
    matched = logs.find(entry => entry.time >= changedAt && matcher.test(entry.text))
    return Boolean(matched)
  }, timeoutMs, 300)
  return matched.text.trim()
}

async function waitForTransformedFixture(baseUrl, needle) {
  let source = ''
  await waitUntil(async () => {
    const url = new URL('/src/components/WeappTailwindcss.vue', baseUrl)
    source = await (await fetch(url)).text()
    return source.includes(needle)
  }, timeoutMs, 300)
  return { contains: needle, length: source.length }
}

function collectLogs(child, logs, platform) {
  const append = (stream, chunk) => {
    const text = chunk.toString()
    logs.push({ time: Date.now(), stream, text })
    process[stream].write(`[dev:${platform}] ${text}`)
  }
  child.stdout.on('data', chunk => append('stdout', chunk))
  child.stderr.on('data', chunk => append('stderr', chunk))
}

function spawnUni(childArgs, env) {
  const command = path.join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'uni.cmd' : 'uni')
  return spawn(command, childArgs, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function preflight(selected) {
  require.resolve('playwright')
  require.resolve('pngjs')
  require.resolve('@dcloudio/uni-automator')
  await fs.access(chromePath())

  if (selected.includes('mp-weixin')) {
    await fs.access('/Applications/wechatwebdevtools.app/Contents/MacOS/cli')
    const check = spawnSync('pnpm', ['exec', 'weapp', 'doctor'], { cwd, encoding: 'utf8' })
    if (check.status !== 0) {
      throw new Error('WeChat DevTools is not logged in or its service port is unavailable. Run pnpm weapp:login first.')
    }
  }

  if (selected.some(platform => platform.startsWith('app-'))) {
    const paths = hbuilderxPaths()
    await fs.access(paths.cli)
  }

  if (selected.includes('app-android')) {
    resolveDeviceId('app-android')
  }
  if (selected.includes('app-ios')) {
    resolveDeviceId('app-ios')
  }
}

function collectBaseEnvironment() {
  return {
    arch: process.arch,
    node: process.version,
    platform: process.platform,
    dependencies: {
      playwright: packageVersion('playwright'),
      pngjs: packageVersion('pngjs'),
      tailwindcss: packageVersion('tailwindcss'),
      uniApp: packageVersion('@dcloudio/uni-app'),
      weappTailwindcss: packageVersion('weapp-tailwindcss'),
    },
    pnpm: commandText('pnpm', ['--version']),
  }
}

function collectEnvironment(selected) {
  const info = {
    ...collectBaseEnvironment(),
    chrome: commandText(chromePath(), ['--version']),
  }
  if (selected.includes('mp-weixin')) {
    info.wechatDevtools = {
      cli: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      doctor: commandText('pnpm', ['exec', 'weapp', 'doctor']),
    }
  }
  if (selected.some(platform => platform.startsWith('app-'))) {
    const cli = hbuilderxPaths().cli
    info.hbuilderx = { cli, version: commandText(cli, ['version']) }
  }
  if (selected.includes('app-android')) {
    const deviceId = resolveDeviceId('app-android')
    info.android = {
      adb: commandText('adb', ['version']),
      deviceId,
      model: commandText('adb', ['-s', deviceId, 'shell', 'getprop', 'ro.product.model']),
      version: commandText('adb', ['-s', deviceId, 'shell', 'getprop', 'ro.build.version.release']),
    }
  }
  if (selected.includes('app-ios')) {
    const deviceId = resolveDeviceId('app-ios')
    const simulator = findBootedIosSimulator(deviceId)
    info.ios = {
      deviceId,
      name: simulator.name,
      runtime: simulator.runtime,
    }
  }
  return info
}

function resolveDeviceId(platform) {
  if (platform === 'app-android') {
    const output = spawnSync('adb', ['devices'], { encoding: 'utf8' }).stdout
    const devices = output.split('\n').slice(1).filter(line => /\tdevice\s*$/.test(line)).map(line => line.split('\t')[0])
    if (args['device-id'] && !args.all) {
      if (!devices.includes(args['device-id'])) {
        throw new Error(`Android device ${args['device-id']} is not online`)
      }
      return args['device-id']
    }
    if (devices.length !== 1) {
      throw new Error(`Expected exactly one online Android device, found: ${devices.join(', ') || 'none'}`)
    }
    return devices[0]
  }
  const devices = listBootedIosSimulators()
  if (args['device-id'] && !args.all) {
    const device = devices.find(candidate => candidate.udid === args['device-id'])
    if (!device) {
      throw new Error(`iOS simulator ${args['device-id']} is not booted`)
    }
    return device.udid
  }
  if (devices.length !== 1) {
    throw new Error(`Expected exactly one booted iOS simulator, found: ${devices.map(device => device.udid).join(', ') || 'none'}`)
  }
  return devices[0].udid
}

function findBootedIosSimulator(deviceId) {
  return listBootedIosSimulators().find(device => device.udid === deviceId)
}

function listBootedIosSimulators() {
  const output = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { encoding: 'utf8' }).stdout
  const runtimes = JSON.parse(output).devices
  return Object.entries(runtimes).flatMap(([runtime, devices]) => devices
    .filter(device => device.state === 'Booted')
    .map(device => ({ ...device, runtime })))
}

function hbuilderxPaths() {
  const cli = path.resolve(args['hbuilderx-cli'] ?? process.env.HBUILDERX_CLI_PATH ?? '/Applications/HBuilderX.app/Contents/MacOS/cli')
  return { cli }
}

function chromePath() {
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
}

async function cleanupPlatform() {
  if (activeBrowser) {
    await activeBrowser.close()
    activeBrowser = undefined
    activePage = undefined
  }
  if (activeProgram) {
    try {
      activeProgram.disconnect()
    }
    catch {}
    activeProgram = undefined
  }
  if (activeChild && activeChild.exitCode === null) {
    try {
      process.kill(-activeChild.pid, activeChildStopSignal)
    }
    catch {
      activeChild.kill(activeChildStopSignal)
    }
    await Promise.race([new Promise(resolve => activeChild.once('exit', resolve)), sleep(8_000)])
    if (activeChild.exitCode === null) {
      try {
        process.kill(-activeChild.pid, 'SIGKILL')
      }
      catch {
        activeChild.kill('SIGKILL')
      }
      await Promise.race([new Promise(resolve => activeChild.once('exit', resolve)), sleep(3_000)])
    }
    if (activeChildStopSignal === 'SIGINT') {
      await sleep(2_000)
    }
  }
  restoreAutomatorEnvironment?.()
  restoreAutomatorEnvironment = undefined
  await fs.rm(bridgeFile, { force: true })
  activeDeviceId = undefined
  activeChild = undefined
  activeChildStopSignal = 'SIGTERM'
}

async function cleanup() {
  await cleanupPlatform()
  await fixture?.restore()
}

async function writeSummary() {
  const status = !fatalError && results.length === platforms.length && results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL'
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    environment,
    error: fatalError,
    platforms: results,
  }
  await fs.mkdir(reportRoot, { recursive: true })
  await fs.writeFile(path.join(reportRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  const lines = [
    '# Tailwind CSS HMR Report',
    '',
    `Overall: **${status}**`,
    '',
    `- Node: ${environment.node}`,
    `- pnpm: ${environment.pnpm}`,
    `- Tailwind CSS: ${environment.dependencies?.tailwindcss}`,
    `- weapp-tailwindcss: ${environment.dependencies?.weappTailwindcss}`,
  ]
  if (environment.hbuilderx) {
    lines.push(`- HBuilderX: ${environment.hbuilderx.version}`)
  }
  if (fatalError) {
    lines.push(`- Preflight/error: ${fatalError}`)
  }
  lines.push('')
  for (const result of results) {
    lines.push(`- ${result.platform}: ${result.status} (${result.durationMs} ms)${result.error ? ` - ${result.error}` : ''}`)
  }
  await fs.writeFile(path.join(reportRoot, 'summary.md'), `${lines.join('\n')}\n`, 'utf8')
}

async function compareScreenshots(beforePath, afterPath) {
  const [before, after] = await Promise.all([readPng(beforePath), readPng(afterPath)])
  if (before.width !== after.width || before.height !== after.height) {
    return { changedPixels: before.width * before.height, dimensionsChanged: true }
  }
  let changedPixels = 0
  for (let index = 0; index < before.data.length; index += 4) {
    const delta = Math.abs(before.data[index] - after.data[index])
      + Math.abs(before.data[index + 1] - after.data[index + 1])
      + Math.abs(before.data[index + 2] - after.data[index + 2])
    if (delta > 30) {
      changedPixels += 1
    }
  }
  return { changedPixels, dimensionsChanged: false, width: before.width, height: before.height }
}

async function readPng(file) {
  const buffer = await fs.readFile(file)
  return parsePng(buffer)
}

async function parsePng(buffer) {
  return new Promise((resolve, reject) => new PNG().parse(buffer, (error, image) => error ? reject(error) : resolve(image)))
}

function findColorBounds(image, expected, tolerance = 14) {
  let pixels = 0
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4
      if (expected.every((value, channel) => Math.abs(image.data[index + channel] - value) <= tolerance)) {
        pixels += 1
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return {
    pixels,
    x: pixels ? minX : 0,
    y: pixels ? minY : 0,
    width: pixels ? maxX - minX + 1 : 0,
    height: pixels ? maxY - minY + 1 : 0,
  }
}

async function captureAppScreenshot(platform, outputPath) {
  await fs.writeFile(outputPath, await captureAppScreenshotBuffer(platform))
}

async function captureAppScreenshotBuffer(platform) {
  if (platform === 'app-android') {
    const screenshot = spawnSync('adb', ['-s', activeDeviceId, 'exec-out', 'screencap', '-p'], {
      encoding: null,
      maxBuffer: 20 * 1024 * 1024,
    })
    if (screenshot.status !== 0) {
      throw new Error(`Failed to capture Android screenshot: ${screenshot.stderr?.toString()}`)
    }
    return screenshot.stdout
  }
  const tempFile = path.join(reportRoot, '.ios-current.png')
  const screenshot = spawnSync('xcrun', ['simctl', 'io', activeDeviceId, 'screenshot', tempFile], { encoding: 'utf8' })
  if (screenshot.status !== 0) {
    throw new Error(`Failed to capture iOS screenshot: ${screenshot.stderr || screenshot.stdout}`)
  }
  const buffer = await fs.readFile(tempFile)
  await fs.rm(tempFile, { force: true })
  return buffer
}

async function dismissRuntimeWarning(platform) {
  if (platform !== 'app-android') {
    return
  }
  spawnSync('adb', ['-s', activeDeviceId, 'shell', 'uiautomator', 'dump', '/sdcard/hmr-window.xml'], { encoding: 'utf8' })
  const xml = spawnSync('adb', ['-s', activeDeviceId, 'exec-out', 'cat', '/sdcard/hmr-window.xml'], { encoding: 'utf8' }).stdout
  const bounds = xml.match(/text="(?:ignore|忽略)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i)
  if (bounds) {
    const x = Math.round((Number(bounds[1]) + Number(bounds[3])) / 2)
    const y = Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)
    spawnSync('adb', ['-s', activeDeviceId, 'shell', 'input', 'tap', String(x), String(y)])
    await sleep(500)
  }
}

async function readDeviceAppResources(platform) {
  if (platform === 'app-android') {
    const base = '/storage/emulated/0/Android/data/io.dcloud.HBuilder/apps/HBuilder/www'
    const service = readAndroidDeviceFile(`${base}/app-service.js`, 'service')
    const css = readAndroidDeviceFile(`${base}/app.css`, 'css')
    return { css, service }
  }
  const container = spawnSync('xcrun', [
    'simctl',
    'get_app_container',
    activeDeviceId,
    'io.dcloud.HBuilder',
    'data',
  ], { encoding: 'utf8' }).stdout.trim()
  const base = path.join(container, 'Documents', 'Pandora', 'apps', 'HBuilder', 'www')
  return {
    css: await fs.readFile(path.join(base, 'app.css'), 'utf8'),
    service: await fs.readFile(path.join(base, 'app-service.js'), 'utf8'),
  }
}

function readAndroidDeviceFile(remotePath, suffix) {
  const readablePath = `/sdcard/Download/hmr-${process.pid}-${suffix}`
  const copy = spawnSync('adb', ['-s', activeDeviceId, 'shell', 'cp', remotePath, readablePath], { encoding: 'utf8' })
  if (copy.status !== 0) {
    return ''
  }
  const content = spawnSync('adb', ['-s', activeDeviceId, 'exec-out', 'cat', readablePath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  }).stdout
  spawnSync('adb', ['-s', activeDeviceId, 'shell', 'rm', readablePath])
  return content
}

function parseHbuilderxRuntimeErrors(log) {
  return log.split('\n').filter(line => /---BEGIN:EXCEPTION---|\$RUNTIME_ERROR\$|TypeError|ReferenceError/i.test(line))
}

function appProcessId(platform) {
  if (platform === 'app-android') {
    return spawnSync('adb', ['-s', activeDeviceId, 'shell', 'pidof', 'io.dcloud.HBuilder'], { encoding: 'utf8' }).stdout.trim()
  }
  const output = spawnSync('xcrun', ['simctl', 'spawn', activeDeviceId, 'launchctl', 'list'], { encoding: 'utf8' }).stdout
  return output.split('\n').find(line => line.includes('io.dcloud.HBuilder'))?.trim().split(/\s+/)[0] ?? ''
}

async function waitForFile(file, predicate, timeout) {
  await waitUntil(async () => {
    try {
      return predicate(await fs.readFile(file, 'utf8'))
    }
    catch {
      return false
    }
  }, timeout, 500)
}

async function waitForOutput(child, matcher, timeout) {
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  await waitUntil(() => matcher.test(output), timeout, 200)
}

async function waitUntil(predicate, timeout, interval) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeout) {
    if (interrupted) {
      throw new Error('Interrupted while waiting for HMR evidence')
    }
    try {
      if (await predicate()) {
        return
      }
    }
    catch (error) {
      lastError = error
    }
    await sleep(interval)
  }
  throw new Error(`Timed out after ${timeout} ms${lastError ? `: ${lastError.message}` : ''}`)
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function includesRgb(value, expected) {
  const numbers = String(value).match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? []
  return expected.every((number, index) => Math.abs(number - numbers[index]) <= 2)
}

function matchesRadius(value, stateName) {
  const radius = Number.parseFloat(String(value))
  if (!Number.isFinite(radius)) {
    return false
  }
  const expectedRpx = stateName === 'initial' ? 18 : 30
  return String(value).includes('rpx')
    ? Math.abs(radius - expectedRpx) <= 1
    : Math.abs(radius - expectedRpx / 2) <= 2
}

function isPlatformBorder(value, platform) {
  const [red = 0, green = 0, blue = 0] = String(value).match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? []
  if (platform === 'mp-weixin') {
    return blue > 180 && blue > red * 1.5 && blue > green
  }
  return red > 180 && red > green * 2 && red > blue * 1.5
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [value >> 16, (value >> 8) & 255, value & 255]
}

function parseArgs(rawArgs) {
  const parsed = {}
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (!arg.startsWith('--')) {
      continue
    }
    const key = arg.slice(2)
    const value = rawArgs[index + 1]
    if (!value || value.startsWith('--')) {
      parsed[key] = true
    }
    else {
      parsed[key] = value
      index += 1
    }
  }
  return parsed
}

function packageVersion(name) {
  try {
    return require(`${name}/package.json`).version
  }
  catch {
    return 'unknown'
  }
}

function commandText(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8', timeout: 10_000 })
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    .trim()
    .replaceAll(String.fromCharCode(27), '')
    .replace(/\[[0-9;]*m/g, '')
    .split('\n')[0] || 'unknown'
}

function installSignalHandler(signal) {
  process.once(signal, () => {
    interrupted = true
    process.exitCode = 1
    fixture?.restoreSync()
    void cleanup()
  })
}

function setEnvironment(values, previousRestore) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      }
      else {
        process.env[key] = value
      }
    }
    previousRestore?.()
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
