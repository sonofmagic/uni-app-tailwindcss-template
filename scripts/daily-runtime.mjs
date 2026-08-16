#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { setTimeout as wait } from 'node:timers/promises'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templateRoot = path.join(repoRoot, 'packages/template')
const args = parseArgs(process.argv.slice(2))
const reportRoot = path.resolve(repoRoot, args['report-dir'] ?? 'packages/template/.hmr-artifacts/daily')
const results = []
const cleanups = []
const activeChildren = new Set()
let interrupted = false
let interruptedSignal
let hbuilderxState

const caffeinatedExitCode = await runUnderCaffeinate()
if (caffeinatedExitCode !== undefined) {
  process.exitCode = caffeinatedExitCode
}
else {
  installSignalHandler('SIGINT')
  installSignalHandler('SIGTERM')
  await main()
}

async function main() {
  await fs.rm(reportRoot, { recursive: true, force: true })
  await fs.mkdir(reportRoot, { recursive: true })

  try {
    await runLaneSafely('h5', runH5Lane)
    if (!interrupted) await runLaneSafely('mp-weixin', runWeChatLane)
    if (!interrupted) await runLaneSafely('app-ios', runIosLane)
    if (!interrupted) await runLaneSafely('app-android', runAndroidLane)
    if (interrupted) {
      recordLane('runner', 'BLOCKED', `Interrupted by ${interruptedSignal}`)
    }
    else if (args['skip-github']) {
      recordLane('github', 'SKIP', 'Skipped by --skip-github')
    }
    else {
      await runLaneSafely('github', runGitHubLane)
    }
  }
  finally {
    await cleanup()
    await writeSummary()
  }

  if (interruptedSignal) {
    process.exitCode = interruptedSignal === 'SIGINT' ? 130 : 143
  }
  else {
    const status = overallStatus()
    process.exitCode = status === 'FAIL' ? 1 : status === 'BLOCKED' ? 2 : 0
  }
}

async function runH5Lane() {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (process.platform !== 'darwin' || !(await exists(chrome))) {
    recordLane('h5', 'BLOCKED', `Google Chrome is unavailable at ${chrome}`, 'Install Google Chrome')
    return
  }
  await runTestLane('h5', ['test:hmr:h5', '--', '--report-dir', path.join(reportRoot, 'hmr-h5')])
}

async function runWeChatLane() {
  const devtoolsCli = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
  if (process.platform !== 'darwin' || !(await exists(devtoolsCli))) {
    recordLane('mp-weixin', 'BLOCKED', `WeChat DevTools is unavailable at ${devtoolsCli}`, 'Install WeChat DevTools and enable its service port')
    return
  }

  const doctor = await execCapture('pnpm', ['--dir', templateRoot, 'exec', 'weapp', 'doctor'], repoRoot)
  if (doctor.code !== 0) {
    recordLane('mp-weixin', 'BLOCKED', 'WeChat DevTools login is expired or its service port is unavailable', 'pnpm --dir packages/template weapp:login')
    return
  }
  await runTestLane('mp-weixin', ['test:hmr:mp-weixin', '--', '--report-dir', path.join(reportRoot, 'hmr-mp-weixin')])
}

async function runIosLane() {
  if (process.platform !== 'darwin' || !commandExists('xcrun')) {
    recordLane('app-ios', 'BLOCKED', 'Xcode command-line tools are unavailable', 'xcode-select --install')
    return
  }

  const selection = await selectIosSimulator()
  if (selection.error) {
    recordLane('app-ios', 'BLOCKED', selection.error, 'Set DAILY_IOS_DEVICE_ID to an available iOS Simulator UDID')
    return
  }
  const hbuilderx = await ensureHBuilderX()
  if (hbuilderx.error) {
    recordLane('app-ios', 'BLOCKED', hbuilderx.error, 'Install the HBuilderX version matching @dcloudio/vite-plugin-uni')
    return
  }

  const simulator = selection.device
  const simulatorWasRunning = processMatches('/Simulator.app/Contents/MacOS/Simulator')
  let bootedByRunner = false
  if (simulator.state !== 'Booted') {
    const boot = await execCapture('xcrun', ['simctl', 'boot', simulator.udid], repoRoot)
    if (boot.code !== 0 && !/current state: Booted/i.test(boot.output)) {
      recordLane('app-ios', 'BLOCKED', tail(boot.output) || `Could not boot iOS Simulator ${simulator.udid}`, `xcrun simctl boot ${simulator.udid}`)
      return
    }
    bootedByRunner = true
    cleanups.push(async () => execCapture('xcrun', ['simctl', 'shutdown', simulator.udid], repoRoot))
  }

  const bootStatus = await execCapture('xcrun', ['simctl', 'bootstatus', simulator.udid, '-b'], repoRoot)
  if (bootStatus.code !== 0) {
    recordLane('app-ios', 'BLOCKED', tail(bootStatus.output) || `iOS Simulator ${simulator.udid} did not finish booting`, `xcrun simctl bootstatus ${simulator.udid} -b`)
    return
  }

  if (!simulatorWasRunning) {
    const opened = await execCapture('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', simulator.udid], repoRoot)
    if (opened.code === 0) {
      cleanups.push(async () => quitApplication('Simulator'))
    }
  }

  await runTestLane('app-ios', [
    'test:hmr:app:ios', '--', '--device-id', simulator.udid,
    '--hbuilderx-cli', hbuilderx.cli, '--report-dir', path.join(reportRoot, 'hmr-app-ios'),
  ], { device: `${simulator.name} (${simulator.udid})`, bootedByRunner })
}

async function runAndroidLane() {
  if (!commandExists('adb')) {
    recordLane('app-android', 'BLOCKED', 'adb is unavailable', 'Install Android platform-tools and connect exactly one device')
    return
  }
  const devicesResult = await execCapture('adb', ['devices'], repoRoot)
  const devices = devicesResult.output.split('\n').slice(1)
    .filter(line => /\tdevice\s*$/.test(line))
    .map(line => line.split('\t')[0])
  if (devices.length !== 1) {
    recordLane('app-android', 'BLOCKED', `Expected exactly one online Android device, found ${devices.length}: ${devices.join(', ') || 'none'}`, 'adb devices')
    return
  }

  const hbuilderx = await ensureHBuilderX()
  if (hbuilderx.error) {
    recordLane('app-android', 'BLOCKED', hbuilderx.error, 'Install the HBuilderX version matching @dcloudio/vite-plugin-uni')
    return
  }
  await runTestLane('app-android', [
    'test:hmr:app:android', '--', '--device-id', devices[0],
    '--hbuilderx-cli', hbuilderx.cli, '--report-dir', path.join(reportRoot, 'hmr-app-android'),
  ], { device: devices[0] })
}

async function runGitHubLane() {
  if (!commandExists('gh')) {
    recordLane('github', 'BLOCKED', 'GitHub CLI is unavailable', 'Install gh and run gh auth login')
    return
  }
  const auth = await execCapture('gh', ['auth', 'status'], repoRoot)
  if (auth.code !== 0) {
    recordLane('github', 'BLOCKED', tail(auth.output) || 'GitHub CLI is not authenticated', 'gh auth login')
    return
  }

  const timeoutMs = numberArg('github-timeout', 45 * 60_000)
  const deadline = Date.now() + timeoutMs
  const scheduledAfter = latestShanghaiSchedule(Date.now())
  let matchedRun
  while (!interrupted && Date.now() <= deadline) {
    const listed = await execCapture('gh', [
      'run', 'list', '--workflow', 'hmr-multi-platform.yml', '--event', 'schedule', '--limit', '20',
      '--json', 'databaseId,status,conclusion,url,createdAt,headSha',
    ], repoRoot)
    if (listed.code !== 0) {
      recordLane('github', 'BLOCKED', tail(listed.output) || 'Unable to query GitHub Actions', 'gh auth refresh -h github.com -s repo')
      return
    }
    const runs = JSON.parse(listed.output)
    matchedRun = runs.find(run => new Date(run.createdAt).getTime() >= scheduledAfter)
    if (matchedRun?.status === 'completed') break
    await wait(Math.min(30_000, Math.max(0, deadline - Date.now())))
  }

  if (!matchedRun) {
    recordLane('github', 'BLOCKED', `No scheduled Quality run appeared within ${Math.round(timeoutMs / 60_000)} minutes`, 'gh workflow run hmr-multi-platform.yml')
    return
  }
  if (matchedRun.status !== 'completed') {
    recordLane('github', 'BLOCKED', `Scheduled Quality run is still ${matchedRun.status}`, `gh run watch ${matchedRun.databaseId}`, { url: matchedRun.url })
    return
  }
  if (matchedRun.conclusion !== 'success') {
    const viewed = await execCapture('gh', ['run', 'view', String(matchedRun.databaseId), '--json', 'jobs'], repoRoot)
    const failedJobs = viewed.code === 0
      ? JSON.parse(viewed.output).jobs.filter(job => job.conclusion === 'failure').map(job => job.name)
      : []
    recordLane('github', 'FAIL', `Scheduled Quality run concluded ${matchedRun.conclusion}${failedJobs.length ? `; failed jobs: ${failedJobs.join(', ')}` : ''}`, `gh run view ${matchedRun.databaseId} --log-failed`, { url: matchedRun.url })
    return
  }
  recordLane('github', 'PASS', 'Scheduled Quality workflow passed', undefined, { url: matchedRun.url })
}

async function runLaneSafely(name, lane) {
  try {
    await lane()
  }
  catch (error) {
    recordLane(name, 'FAIL', error instanceof Error ? error.message : String(error), `Review ${path.relative(repoRoot, path.join(reportRoot, `${name}.log`))}`)
  }
}

async function runTestLane(name, commandArgs, details = {}) {
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const logPath = path.join(reportRoot, `${name}.log`)
  const result = await runLogged('pnpm', commandArgs, repoRoot, logPath)
  if (result.code === 0) {
    recordLane(name, 'PASS', 'Runtime HMR assertions passed', undefined, { ...details, startedAt, durationMs: Date.now() - started, logPath })
  }
  else if (result.code === 2) {
    recordLane(name, 'BLOCKED', 'A runtime system prompt requires an unlocked interactive session', 'Unlock the Mac, open the runtime, and dismiss its permission prompt', { ...details, startedAt, durationMs: Date.now() - started, logPath })
  }
  else {
    recordLane(name, 'FAIL', `pnpm exited with ${result.signal ?? result.code ?? 'unknown status'}`, `Review ${path.relative(repoRoot, logPath)}`, { ...details, startedAt, durationMs: Date.now() - started, logPath })
  }
}

async function selectIosSimulator() {
  const listed = await execCapture('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], repoRoot)
  if (listed.code !== 0) return { error: tail(listed.output) || 'Unable to list iOS Simulators' }
  const runtimes = JSON.parse(listed.output).devices
  const devices = Object.entries(runtimes)
    .filter(([runtime]) => runtime.includes('SimRuntime.iOS-'))
    .flatMap(([runtime, entries]) => entries.map(device => ({ ...device, runtime })))
    .filter(device => device.isAvailable !== false)
  const configured = process.env.DAILY_IOS_DEVICE_ID
  if (configured) {
    const device = devices.find(candidate => candidate.udid === configured)
    return device ? { device } : { error: `DAILY_IOS_DEVICE_ID ${configured} is not available` }
  }
  if (devices.length === 1) return { device: devices[0] }
  const sorted = devices.filter(device => device.lastBootedAt)
    .sort((left, right) => new Date(right.lastBootedAt) - new Date(left.lastBootedAt))
  if (sorted.length > 0 && (sorted.length === 1 || sorted[0].lastBootedAt !== sorted[1].lastBootedAt)) {
    return { device: sorted[0] }
  }
  return { error: `Could not select one recently used iOS Simulator from ${devices.length} available devices` }
}

async function ensureHBuilderX() {
  if (hbuilderxState) return hbuilderxState
  const compilerPackage = JSON.parse(await fs.readFile(path.join(templateRoot, 'node_modules/@dcloudio/vite-plugin-uni/package.json'), 'utf8'))
  const compilerVersion = compilerPackage['uni-app']?.compilerVersion
  if (!compilerVersion) {
    hbuilderxState = { error: 'Could not determine the uni-app compiler version from @dcloudio/vite-plugin-uni' }
    return hbuilderxState
  }
  const candidates = [
    process.env.HBUILDERX_CLI_PATH,
    '/Applications/HBuilderX.app/Contents/MacOS/cli',
    '/Applications/HBuilderX-Alpha.app/Contents/MacOS/cli',
  ].filter(Boolean)
  const installed = []
  for (const cli of candidates) {
    if (!(await exists(cli))) continue
    const appPath = path.resolve(path.dirname(cli), '../..')
    const version = (await execCapture('defaults', ['read', path.join(appPath, 'Contents/Info'), 'CFBundleShortVersionString'], repoRoot)).output.trim()
    installed.push({ appPath, cli, version })
  }
  if (installed.length === 0) {
    hbuilderxState = { error: `No HBuilderX CLI found in ${candidates.join(', ')}` }
    return hbuilderxState
  }
  const selected = installed.find(candidate => candidate.version === compilerVersion || candidate.version.startsWith(`${compilerVersion}.`))
  if (!selected) {
    hbuilderxState = {
      error: `uni-app compiler ${compilerVersion} requires a matching HBuilderX; installed: ${installed.map(candidate => `${path.basename(candidate.appPath)} ${candidate.version}`).join(', ')}`,
    }
    return hbuilderxState
  }

  const { appPath, cli } = selected
  const wasRunning = processMatches(`${appPath}/Contents/MacOS/`)
  if (!wasRunning) {
    const opened = await execCapture('open', ['-a', appPath], repoRoot)
    if (opened.code !== 0) {
      hbuilderxState = { error: tail(opened.output) || `Could not open ${appPath}` }
      return hbuilderxState
    }
    const appName = path.basename(appPath, '.app')
    cleanups.push(async () => quitApplication(appName))
    await wait(3_000)
  }
  hbuilderxState = { cli, startedByRunner: !wasRunning }
  return hbuilderxState
}

async function runLogged(command, commandArgs, cwd, logPath) {
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  const log = createWriteStream(logPath, { flags: 'w' })
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd,
      detached: process.platform !== 'win32',
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    activeChildren.add(child)
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        process.stdout.write(chunk)
        log.write(chunk)
      })
    }
    child.on('error', (error) => log.write(`${error.stack ?? error.message}\n`))
    child.on('exit', (code, signal) => {
      activeChildren.delete(child)
      log.end(() => resolve({ code, signal }))
    })
  })
}

function execCapture(command, commandArgs, cwd) {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    activeChildren.add(child)
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    child.on('error', error => output += `${error.message}\n`)
    child.on('exit', (code, signal) => {
      activeChildren.delete(child)
      resolve({ code, signal, output })
    })
  })
}

function recordLane(name, status, message, repairCommand, details = {}) {
  const lane = {
    name,
    status,
    message,
    repairCommand,
    finishedAt: new Date().toISOString(),
    ...details,
  }
  results.push(lane)
  console.log(`[daily] ${name}: ${status} - ${message}`)
}

async function writeSummary() {
  const summary = {
    status: overallStatus(),
    generatedAt: new Date().toISOString(),
    repository: repoRoot,
    lanes: results,
  }
  await fs.mkdir(reportRoot, { recursive: true })
  await fs.writeFile(path.join(reportRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  const lines = [
    '# Daily Runtime Quality Report',
    '',
    `Overall: **${summary.status}**`,
    '',
    '| Lane | Status | Detail |',
    '| --- | --- | --- |',
    ...results.map(lane => `| ${lane.name} | ${lane.status} | ${markdownCell(lane.message)}${lane.url ? ` ([run](${lane.url}))` : ''} |`),
    '',
  ]
  const repairs = results.filter(lane => lane.repairCommand)
  if (repairs.length > 0) {
    lines.push('## Follow-up commands', '')
    for (const lane of repairs) lines.push(`- ${lane.name}: \`${lane.repairCommand}\``)
    lines.push('')
  }
  await fs.writeFile(path.join(reportRoot, 'summary.md'), `${lines.join('\n')}\n`)
}

function overallStatus() {
  if (results.some(result => result.status === 'FAIL')) return 'FAIL'
  if (results.some(result => result.status === 'BLOCKED')) return 'BLOCKED'
  return 'PASS'
}

async function cleanup() {
  for (const child of activeChildren) stopChild(child)
  for (const action of cleanups.reverse()) {
    try {
      await action()
    }
    catch {}
  }
}

function installSignalHandler(signal) {
  process.once(signal, () => {
    interrupted = true
    interruptedSignal = signal
    for (const child of activeChildren) stopChild(child)
  })
}

function stopChild(child) {
  if (child.exitCode !== null) return
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else child.kill('SIGTERM')
  }
  catch {}
}

async function quitApplication(name) {
  await execCapture('osascript', ['-e', `tell application "${name}" to quit`], repoRoot)
}

function runUnderCaffeinate() {
  if (process.platform !== 'darwin' || process.env.DAILY_RUNTIME_CAFFEINATED === '1' || !commandExists('caffeinate')) {
    return undefined
  }
  return new Promise((resolve) => {
    let forwardedSignal
    const child = spawn('caffeinate', ['-dimsu', process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      cwd: repoRoot,
      env: { ...process.env, DAILY_RUNTIME_CAFFEINATED: '1' },
      stdio: 'inherit',
    })
    const forward = (signal) => {
      forwardedSignal = signal
      if (child.exitCode === null) child.kill(signal)
    }
    const onSigint = () => forward('SIGINT')
    const onSigterm = () => forward('SIGTERM')
    process.once('SIGINT', onSigint)
    process.once('SIGTERM', onSigterm)
    child.on('error', () => resolve(1))
    child.on('exit', (code, signal) => {
      process.removeListener('SIGINT', onSigint)
      process.removeListener('SIGTERM', onSigterm)
      resolve(forwardedSignal === 'SIGINT' ? 130 : forwardedSignal === 'SIGTERM' ? 143 : signal ? 1 : code ?? 1)
    })
  })
}

function latestShanghaiSchedule(now) {
  const shifted = new Date(now + 8 * 60 * 60_000)
  let year = shifted.getUTCFullYear()
  let month = shifted.getUTCMonth()
  let day = shifted.getUTCDate()
  if (shifted.getUTCHours() < 3) {
    const previous = new Date(Date.UTC(year, month, day - 1))
    year = previous.getUTCFullYear()
    month = previous.getUTCMonth()
    day = previous.getUTCDate()
  }
  return Date.UTC(year, month, day, 3 - 8)
}

function processMatches(pattern) {
  return spawnSync('pgrep', ['-f', pattern], { stdio: 'ignore' }).status === 0
}

function commandExists(command) {
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  }
  catch {
    return false
  }
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) continue
    const separator = value.indexOf('=')
    if (separator !== -1) {
      parsed[value.slice(2, separator)] = value.slice(separator + 1)
    }
    else if (values[index + 1] && !values[index + 1].startsWith('--')) {
      parsed[value.slice(2)] = values[index + 1]
      index += 1
    }
    else {
      parsed[value.slice(2)] = true
    }
  }
  return parsed
}

function numberArg(name, fallback) {
  const value = Number(args[name] ?? fallback)
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a non-negative number`)
  return value
}

function tail(value, length = 1_500) {
  return value.trim().slice(-length)
}

function markdownCell(value) {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br>')
}
