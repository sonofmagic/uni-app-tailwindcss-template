#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { setTimeout as wait } from 'node:timers/promises'
import { runCleanup } from '../packages/create-uni-app-tailwindcss/scripts/daily-contract.mjs'
import { runPreflight, prepareHBuilderX, selectIosSimulator as selectSharedIosSimulator } from './preflight-core.mjs'
import { runCommand, signalCommand } from './runtime-process.mjs'
import { checkGitHubRun, runtimeStatus, ExternalBlockError } from './runtime-contract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const createPackageRoot = path.join(repoRoot, 'packages/create-uni-app-tailwindcss')
const hmrRuntimeScript = path.join(repoRoot, 'scripts/template-tests/hmr-runtime.mjs')
const args = parseArgs(process.argv.slice(2))
const reportRoot = path.resolve(repoRoot, args['report-dir'] ?? 'packages/template/.hmr-artifacts/daily')
const results = []
const cleanups = []
const activeChildren = new Set()
let interrupted = false
let interruptedSignal
const runtimeProjects = new Map()
const preflightResults = new Map()

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
    await prepareRuntimeProjects()
    for (const source of ['candidate', 'latest']) {
      const projectRoot = runtimeProjects.get(source)
      if (interrupted) break
      if (!projectRoot) {
        for (const platform of ['h5', 'mp-weixin', 'app-ios', 'app-android']) {
          recordLane(`${source}:${platform}`, 'BLOCKED', `${source} project preparation failed`, `Review ${path.relative(repoRoot, path.join(reportRoot, `${source}-prepare.log`))}`)
        }
        continue
      }
      await runPreflightLane(source, 'h5', () => runH5Lane(source, projectRoot))
      if (!interrupted) await runPreflightLane(source, 'mp-weixin', () => runWeChatLane(source, projectRoot))
      if (!interrupted) await runPreflightLane(source, 'app-ios', () => runIosLane(source, projectRoot))
      if (!interrupted) await runPreflightLane(source, 'app-android', () => runAndroidLane(source, projectRoot))
    }
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

async function prepareRuntimeProjects() {
  const temporaryRoot = await fs.mkdtemp(path.join(tmpdir(), 'uni-app-tailwindcss-runtime-'))
  cleanups.push(async () => fs.rm(temporaryRoot, { recursive: true, force: true }))
  for (const source of ['candidate', 'latest']) {
    if (interrupted) return
    const sourceRoot = path.join(temporaryRoot, source)
    const projectRoot = path.join(sourceRoot, 'daily-runtime-app')
    const logPath = path.join(reportRoot, `${source}-prepare.log`)
    await fs.mkdir(sourceRoot, { recursive: true })
    try {
      if (source === 'candidate') {
        const packRoot = path.join(sourceRoot, 'pack')
        await fs.mkdir(packRoot, { recursive: true })
        await requireCommandSuccess('pnpm', ['pack', '--pack-destination', packRoot], createPackageRoot, logPath)
        const tarballs = (await fs.readdir(packRoot)).filter(file => file.endsWith('.tgz'))
        if (tarballs.length !== 1) throw new Error(`Expected one candidate tarball, found ${tarballs.length}`)
        await requireCommandSuccess('pnpm', ['dlx', path.join(packRoot, tarballs[0]), projectRoot, '--template=default', '--pm=pnpm'], sourceRoot, logPath, true)
      }
      else {
        await requireCommandSuccess('pnpm', ['create', 'uni-app-tailwindcss@latest', projectRoot, '--template=default', '--pm=pnpm'], sourceRoot, logPath)
      }
      let installError
      try {
        await requireCommandSuccess('pnpm', ['install'], projectRoot, logPath, true)
      }
      catch (error) {
        installError = error
        await requireCommandSuccess('pnpm', ['install', '--ignore-scripts'], projectRoot, logPath, true)
      }
      try {
        await requireCommandSuccess('pnpm', ['install', '--frozen-lockfile'], projectRoot, logPath, true)
      }
      catch (error) {
        installError ||= error
        await requireCommandSuccess('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], projectRoot, logPath, true)
      }
      runtimeProjects.set(source, projectRoot)
      const preflight = await runPreflight({
        repo: repoRoot,
        registry: {
          version: 1,
          defaultTemplate: 'default',
          templates: [{
            id: 'default',
            source: projectRoot,
            targets: ['h5', 'app', 'mp-weixin'],
          }],
        },
        selection: 'h5,app-android,app-ios,mp-weixin',
        runBuild: false,
      })
      preflightResults.set(source, preflight)
      await fs.writeFile(path.join(reportRoot, `${source}-preflight.json`), `${JSON.stringify(preflight, null, 2)}\n`, 'utf8')
      recordLane(`${source}:preflight`, preflight.status, `Generated project preflight: ${preflight.status}`, undefined, {
        targets: preflight.targetResults.map(result => ({ target: result.target, status: result.status })),
      })
      recordLane(
        `${source}:prepare`,
        installError ? 'FAIL' : 'PASS',
        installError ? `Normal install failed; diagnostic --ignore-scripts install completed: ${installError.message}` : 'Created and installed an isolated runtime project',
        installError ? `Review ${path.relative(repoRoot, logPath)}` : undefined,
        { projectRoot },
      )
    }
    catch (error) {
      recordLane(`${source}:prepare`, 'FAIL', error instanceof Error ? error.message : String(error), `Review ${path.relative(repoRoot, logPath)}`)
    }
  }
}

async function runPreflightLane(source, target, lane) {
  const preflight = preflightResults.get(source)
  const result = preflight?.targetResults.find(item => item.target === target)
  if (result?.status === 'FAIL') {
    recordLane(`${source}:${target}`, 'FAIL', 'Skipped because generated project preflight failed', 'Review the generated project preflight report')
    return
  }
  if (result?.status === 'BLOCKED') {
    // The daily runner owns App device preparation (booting iOS and opening
    // HBuilderX), so let those lanes perform their existing preparation before
    // deciding whether the runtime remains blocked.
    if (target.startsWith('app-')) {
      await runLaneSafely(`${source}:${target}`, lane)
      return
    }
    const blocked = result.checks.find(check => check.status === 'BLOCKED')
    recordLane(`${source}:${target}`, 'BLOCKED', blocked?.message ?? 'Skipped because the target runtime is blocked', blocked?.repairCommand)
    return
  }
  await runLaneSafely(`${source}:${target}`, lane)
}

async function runH5Lane(source, projectRoot) {
  await runRuntimeTestLane(source, 'h5', projectRoot)
}

async function runWeChatLane(source, projectRoot) {
  const devtoolsCli = process.env.WECHAT_DEVTOOLS_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
  if (process.platform !== 'darwin' || !(await exists(devtoolsCli))) {
    recordLane(`${source}:mp-weixin`, 'BLOCKED', `WeChat DevTools is unavailable at ${devtoolsCli}`, 'Install WeChat DevTools and enable its service port')
    return
  }

  await runRuntimeTestLane(source, 'mp-weixin', projectRoot)
}

async function runIosLane(source, projectRoot) {
  const lane = `${source}:app-ios`
  if (process.platform !== 'darwin' || !commandExists('xcrun')) {
    recordLane(lane, 'BLOCKED', 'Xcode command-line tools are unavailable', 'xcode-select --install')
    return
  }

  const selection = await selectIosSimulator()
  if (selection.error) {
    recordLane(lane, 'BLOCKED', selection.error, 'Set DAILY_IOS_DEVICE_ID to an available iOS Simulator UDID')
    return
  }
  const hbuilderx = await ensureHBuilderX(projectRoot)
  if (hbuilderx.error) {
    recordLane(lane, 'BLOCKED', hbuilderx.error, 'Install the HBuilderX version matching @dcloudio/vite-plugin-uni')
    return
  }

  const simulator = selection.device
  const simulatorWasRunning = processMatches('/Simulator.app/Contents/MacOS/Simulator')
  let bootedByRunner = false
  if (simulator.state !== 'Booted') {
    const boot = await execCapture('xcrun', ['simctl', 'boot', simulator.udid], repoRoot)
    if (boot.code !== 0 && !/current state: Booted/i.test(boot.output)) {
      recordLane(lane, 'BLOCKED', tail(boot.output) || `Could not boot iOS Simulator ${simulator.udid}`, `xcrun simctl boot ${simulator.udid}`)
      return
    }
    bootedByRunner = true
    cleanups.push(async () => execCapture('xcrun', ['simctl', 'shutdown', simulator.udid], repoRoot))
  }

  const bootStatus = await execCapture('xcrun', ['simctl', 'bootstatus', simulator.udid, '-b'], repoRoot)
  if (bootStatus.code !== 0) {
    recordLane(lane, 'BLOCKED', tail(bootStatus.output) || `iOS Simulator ${simulator.udid} did not finish booting`, `xcrun simctl bootstatus ${simulator.udid} -b`)
    return
  }

  if (!simulatorWasRunning) {
    const opened = await execCapture('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', simulator.udid], repoRoot)
    if (opened.code === 0) {
      cleanups.push(async () => quitApplication('Simulator'))
    }
  }

  await runRuntimeTestLane(source, 'app-ios', projectRoot, [
    '--device-id', simulator.udid, '--hbuilderx-cli', hbuilderx.cli,
  ], { device: `${simulator.name} (${simulator.udid})`, bootedByRunner })
}

async function runAndroidLane(source, projectRoot) {
  const lane = `${source}:app-android`
  if (!commandExists('adb')) {
    recordLane(lane, 'BLOCKED', 'adb is unavailable', 'Install Android platform-tools and connect exactly one device')
    return
  }
  const devicesResult = await execCapture('adb', ['devices'], repoRoot)
  const devices = devicesResult.output.split('\n').slice(1)
    .filter(line => /\tdevice\s*$/.test(line))
    .map(line => line.split('\t')[0])
  if (devices.length !== 1) {
    recordLane(lane, 'BLOCKED', `Expected exactly one online Android device, found ${devices.length}: ${devices.join(', ') || 'none'}`, 'adb devices')
    return
  }

  const hbuilderx = await ensureHBuilderX(projectRoot)
  if (hbuilderx.error) {
    recordLane(lane, 'BLOCKED', hbuilderx.error, 'Install the HBuilderX version matching @dcloudio/vite-plugin-uni')
    return
  }
  await runRuntimeTestLane(source, 'app-android', projectRoot, [
    '--device-id', devices[0], '--hbuilderx-cli', hbuilderx.cli,
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

  const head = await execCapture('git', ['rev-parse', 'HEAD'], repoRoot)
  if (head.code !== 0) throw new Error(`Cannot determine tested commit: ${head.output}`)
  const expectedSha = head.output.trim()
  const runId = args['github-run-id']
  if (runId && !/^\d+$/.test(String(runId))) throw new Error('--github-run-id must be a numeric run ID')
  const timeoutMs = numberArg('github-timeout', 45 * 60_000)
  const deadline = Date.now() + timeoutMs
  const scheduledAfter = latestShanghaiSchedule(Date.now())
  let matchedRun
  while (!interrupted && Date.now() <= deadline) {
    const fields = 'databaseId,status,conclusion,url,createdAt,headSha,workflowName'
    const commandArgs = runId
      ? ['run', 'view', String(runId), '--json', fields]
      : ['run', 'list', '--workflow', 'hmr-multi-platform.yml', '--event', 'schedule', '--limit', '20', '--json', fields]
    const listed = await execCapture('gh', commandArgs, repoRoot)
    if (listed.code !== 0) {
      recordLane('github', 'BLOCKED', tail(listed.output) || 'Unable to query GitHub Actions', 'Check gh authentication and connectivity')
      return
    }
    const data = JSON.parse(listed.output)
    matchedRun = runId ? data : data.find(run => run.headSha === expectedSha && new Date(run.createdAt).getTime() >= scheduledAfter)
    if (matchedRun && (matchedRun.status === 'completed' || matchedRun.headSha !== expectedSha || matchedRun.workflowName !== 'Quality')) break
    await wait(Math.min(30_000, Math.max(0, deadline - Date.now())))
  }
  const checked = checkGitHubRun(matchedRun, expectedSha)
  recordLane('github', checked.status, checked.message,
    checked.status === 'PASS' ? undefined : matchedRun ? `gh run view ${matchedRun.databaseId} --log-failed` : 'gh workflow run hmr-multi-platform.yml',
    { url: matchedRun?.url, expectedSha, headSha: matchedRun?.headSha, runId: matchedRun?.databaseId })

}

async function runLaneSafely(name, lane) {
  try {
    await lane()
  }
  catch (error) {
    recordLane(name, error instanceof ExternalBlockError ? 'BLOCKED' : 'FAIL', error instanceof Error ? error.message : String(error), `Review ${path.relative(repoRoot, path.join(reportRoot, `${name}.log`))}`)
  }
}

async function runRuntimeTestLane(source, platform, projectRoot, extraArgs = [], details = {}) {
  const name = `${source}:${platform}`
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const sourceReportDir = path.join(reportRoot, source, platform)
  const logPath = path.join(reportRoot, `${source}-${platform}.log`)
  const result = await runLogged(process.execPath, [
    hmrRuntimeScript, '--platform', platform, '--report-dir', sourceReportDir, ...extraArgs,
  ], projectRoot, logPath)
  if (result.code === 0) {
    recordLane(name, 'PASS', 'Runtime HMR assertions passed', undefined, { ...details, startedAt, durationMs: Date.now() - started, logPath })
  }
  else if (result.code === 2) {
    let detail = 'External runtime is unavailable'
    try {
      const summary = JSON.parse(await fs.readFile(path.join(sourceReportDir, 'summary.json'), 'utf8'))
      detail = summary.platforms?.find(item => item.status === 'BLOCKED')?.error || summary.error || detail
    } catch {}
    recordLane(name, 'BLOCKED', detail, `Review ${logPath}`, { ...details, startedAt, durationMs: Date.now() - started, logPath })
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
  const device = selectSharedIosSimulator(devices, process.env.DAILY_IOS_DEVICE_ID)
  return device ? { device } : { error: `Could not select an available iOS Simulator; check DAILY_IOS_DEVICE_ID` }
}

async function ensureHBuilderX(projectRoot) {
  const check = await prepareHBuilderX({ source: projectRoot, onStarted: ({ appPath }) => {
    cleanups.push(async () => quitApplication(path.basename(appPath, '.app')))
  } })
  if (check.status === 'FAIL') throw new Error(check.message)
  if (check.status !== 'PASS') return { error: check.message }
  return { cli: check.evidence.selected.cli }
}

async function requireCommandSuccess(command, commandArgs, cwd, logPath, append = false) {
  const result = await runLogged(command, commandArgs, cwd, logPath, append)
  if (result.signal || result.code !== 0) {
    throw new Error(`${command} exited with ${result.signal ?? result.code ?? 'unknown status'}`)
  }
}

async function runLogged(command, commandArgs, cwd, logPath, append = false) {
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  const log = createWriteStream(logPath, { flags: append ? 'a' : 'w' })
  try {
    return await runCommand(command, commandArgs, {
      cwd, timeoutMs: 20 * 60_000,
      onSpawn: child => activeChildren.add(child),
      onClose: child => activeChildren.delete(child),
      onData: text => { process.stdout.write(text); log.write(text) },
    })
  }
  finally { await new Promise(resolve => log.end(resolve)) }
}

function execCapture(command, commandArgs, cwd) {
  return runCommand(command, commandArgs, {
    cwd, onSpawn: child => activeChildren.add(child), onClose: child => activeChildren.delete(child),
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
  // Two sources, each with prepare/preflight and four runtime lanes, plus CI.
  return runtimeStatus(results, 13)
}

async function cleanup() {
  const stopped = await Promise.allSettled([...activeChildren].map(stopChild))
  const errors = stopped.filter(result => result.status === 'rejected').map(result => result.reason)
  errors.push(...await runCleanup(cleanups))
  cleanups.length = 0
  if (errors.length) recordLane('runner:cleanup', 'FAIL', errors.map(error => error.message).join('; '))
}

function installSignalHandler(signal) {
  process.once(signal, () => {
    interrupted = true
    interruptedSignal = signal
    for (const child of activeChildren) stopChild(child)
  })
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  signalCommand(child)
  await wait(1_000)
  if (activeChildren.has(child)) signalCommand(child, 'SIGKILL')
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
  return spawnSync('pgrep', ['-f', pattern], { stdio: 'ignore', timeout: 30_000, killSignal: 'SIGKILL' }).status === 0
}

function commandExists(command) {
  return spawnSync('which', [command], { stdio: 'ignore', timeout: 30_000, killSignal: 'SIGKILL' }).status === 0
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
