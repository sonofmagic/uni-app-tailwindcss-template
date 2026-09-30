/**
 * Shared multi-platform preflight helpers.
 *
 * The module deliberately has no work at import time.  Callers may inject an
 * executor and filesystem implementation, which keeps the checks deterministic
 * in unit tests and lets the CLI use the same checks for generated projects.
 */

import { once } from 'node:events'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { satisfies } from 'semver'
import { runCommand } from './runtime-process.mjs'

import { loadTemplateRegistry, repoRoot as registryRoot, resolveTemplateSource } from './template-registry.mjs'

export const PREFLIGHT_STATUSES = Object.freeze(['PASS', 'BLOCKED', 'FAIL'])
export const TARGETS = Object.freeze(['h5', 'app', 'app-android', 'app-ios', 'mp-weixin', 'mp-alipay', 'mp-toutiao'])

const TARGET_DEFINITIONS = Object.freeze({
  h5: {
    buildTarget: 'h5',
    platform: 'h5',
    artifacts: ['dist/build/h5/index.html'],
  },
  app: {
    buildTarget: 'app',
    platform: 'app',
    artifacts: ['dist/build/app/manifest.json', 'dist/build/app/app-service.js', 'dist/build/app/app.css'],
  },
  'app-android': {
    buildTarget: 'app',
    platform: 'app-android',
    artifacts: ['dist/build/app/manifest.json', 'dist/build/app/app-service.js', 'dist/build/app/app.css'],
  },
  'app-ios': {
    buildTarget: 'app',
    platform: 'app-ios',
    artifacts: ['dist/build/app/manifest.json', 'dist/build/app/app-service.js', 'dist/build/app/app.css'],
  },
  'mp-weixin': {
    buildTarget: 'mp-weixin',
    platform: 'mp-weixin',
    artifacts: ['dist/build/mp-weixin/app.json', 'dist/build/mp-weixin/app.js', 'dist/build/mp-weixin/app.wxss'],
  },
  'mp-alipay': {
    buildTarget: 'mp-alipay',
    platform: 'mp-alipay',
    artifacts: ['dist/build/mp-alipay/app.json', 'dist/build/mp-alipay/app.js', 'dist/build/mp-alipay/app.acss'],
  },
  'mp-toutiao': {
    buildTarget: 'mp-toutiao',
    platform: 'mp-toutiao',
    artifacts: ['dist/build/mp-toutiao/app.json', 'dist/build/mp-toutiao/app.js', 'dist/build/mp-toutiao/app.ttss'],
  },
})

export function targetDefinition(target) {
  return TARGET_DEFINITIONS[target]
}

/** Expand registered build targets into runnable lanes. `app` expands to both
 * runtime lanes while retaining one build invocation in each lane. */
export function normalizeTargets(registry, selection) {
  const sourceRegistry = registry ?? { templates: [{ id: 'default', source: 'packages/template', targets: TARGETS.slice(0, 5) }], defaultTemplate: 'default' }
  const requested = parseTargetSelection(selection)
  const unknownTargets = requested.targets.filter(target => !TARGETS.includes(target))
  if (unknownTargets.length > 0) throw new Error(`Unknown preflight target(s): ${unknownTargets.join(', ')}`)
  const templates = sourceRegistry.templates ?? []
  const defaultTemplate = sourceRegistry.defaultTemplate ?? templates[0]?.id
  const records = []

  for (const template of templates) {
    const selectedTemplate = requested.templateIds.length === 0 || requested.templateIds.includes(template.id)
    if (!selectedTemplate) continue
    const registered = Array.isArray(template.targets) ? template.targets : []
    for (const registeredTarget of registered) {
      if (requested.targets.length > 0 && !requested.targets.includes(registeredTarget) && !(registeredTarget === 'app' && requested.targets.some(item => item.startsWith('app-')))) continue
      const expanded = registeredTarget === 'app' ? ['app-android', 'app-ios'] : [registeredTarget]
      for (const laneTarget of expanded) {
        if (requested.targets.length > 0 && !requested.targets.includes(registeredTarget) && !requested.targets.includes(laneTarget)) continue
        const definition = TARGET_DEFINITIONS[laneTarget]
        if (!definition) continue
        records.push({
          id: `${template.id}:${laneTarget}`,
          template: template.id,
          isDefault: template.id === defaultTemplate,
          source: resolveSourceSafely(template),
          registeredTarget,
          target: laneTarget,
          platform: definition.platform,
          buildTarget: definition.buildTarget,
          buildScript: `build:${definition.buildTarget}`,
          artifacts: [...definition.artifacts],
        })
      }
    }
  }

  // A direct app-android/app-ios request should work even when a registry only
  // declares the parent `app` target.
  return records.filter((record, index, all) => all.findIndex(candidate => candidate.id === record.id) === index)
}

export const expandTargets = normalizeTargets

function parseTargetSelection(selection) {
  if (!selection) return { targets: [], templateIds: [] }
  if (Array.isArray(selection)) return validateTargetSelection({ targets: selection.flatMap(value => String(value).split(',').map(item => item.trim()).filter(Boolean)), templateIds: [] })
  if (typeof selection === 'object') {
    return validateTargetSelection({
      targets: String(selection.target ?? selection.targets ?? '').split(',').map(item => item.trim()).filter(Boolean),
      templateIds: String(selection.template ?? selection.templateId ?? '').split(',').map(item => item.trim()).filter(Boolean),
    })
  }
  return validateTargetSelection({ targets: String(selection).split(',').map(item => item.trim()).filter(Boolean), templateIds: [] })
}

function validateTargetSelection(selection) {
  const unknown = selection.targets.filter(target => !TARGETS.includes(target))
  if (unknown.length > 0) throw new Error(`Unknown or unsupported target(s): ${unknown.join(', ')}`)
  return selection
}

function resolveSourceSafely(template) {
  if (path.isAbsolute(template.source)) return path.resolve(template.source)
  try { return resolveTemplateSource(template) }
  catch { return path.resolve(registryRoot, template.source ?? '') }
}

export function aggregateStatus(results = []) {
  const values = results.map(result => typeof result === 'string' ? result : result?.status).filter(Boolean)
  if (values.length === 0) return 'FAIL'
  if (values.includes('FAIL')) return 'FAIL'
  if (values.includes('BLOCKED')) return 'BLOCKED'
  return values.length > 0 ? 'PASS' : 'FAIL'
}

export function makeCheck({ id, target, phase = 'baseline', status = 'PASS', message = '', repairCommand, evidence = {}, ...extra }) {
  if (!PREFLIGHT_STATUSES.includes(status)) throw new Error(`Invalid preflight status: ${status}`)
  return { id, target, phase, status, message, ...(repairCommand ? { repairCommand } : {}), evidence, ...extra }
}

export function checkVersion(actual, requirement = '>=22') {
  return satisfies(String(actual ?? ''), requirement)
}

export function compareVersions(actual, expected) {
  return checkVersion(actual, `=${expected}`)
}

export function createDefaultExecutor({ cwd = registryRoot, env = process.env } = {}) {
  return {
    cwd,
    env,
    run(command, args = [], options = {}) {
      return runCommand(command, args, { ...options, cwd: options.cwd ?? cwd, env: options.env ?? env })
    },
    commandExists(command) {
      return this.run(process.platform === 'win32' ? 'where' : 'which', [command]).then(result => result.code === 0)
    },
    async exists(filePath) {
      try { await access(filePath); return true } catch { return false }
    },
    async readFile(filePath, encoding = 'utf8') { return readFile(filePath, encoding) },
    async stat(filePath) { return stat(filePath) },
  }
}

export async function checkNodeAndPnpm({ executor = createDefaultExecutor(), nodeVersion = process.version, nodeRequirement = '>=22', packageManager, cwd, target = 'repository' } = {}) {
  const checks = []
  const nodeMatches = checkVersion(nodeVersion, nodeRequirement)
  checks.push(makeCheck({
    id: 'runtime.node.version', target, phase: 'baseline',
    status: nodeMatches ? 'PASS' : 'FAIL',
    message: nodeMatches ? `Node.js ${nodeVersion}` : `Node.js ${nodeVersion} does not satisfy ${nodeRequirement}`,
    repairCommand: nodeMatches ? undefined : `Install Node.js satisfying ${nodeRequirement}`, evidence: { actual: nodeVersion, required: nodeRequirement },
  }))
  const pnpm = await executor.run('pnpm', ['--version'], { cwd })
  const actualPnpm = firstVersion(commandOutput(pnpm))
  const expectedPnpm = packageManager?.match(/^pnpm@(.+)$/)?.[1]
  const pnpmMatches = pnpm.code === 0 && (!expectedPnpm || compareVersions(actualPnpm, expectedPnpm))
  checks.push(makeCheck({
    id: 'runtime.pnpm.version', target, phase: 'baseline',
    status: pnpmMatches ? 'PASS' : 'FAIL',
    message: pnpmMatches ? `pnpm ${actualPnpm}` : `pnpm ${actualPnpm || 'unavailable'} does not match ${packageManager || 'the workspace requirement'}`,
    repairCommand: pnpmMatches ? undefined : 'corepack enable && corepack prepare pnpm@latest --activate',
    evidence: { actual: actualPnpm, expected: packageManager, output: commandOutput(pnpm) },
  }))
  return checks
}

export async function checkCommand(command, { executor = createDefaultExecutor(), id = `tool.${command}`, target, phase = 'runtime', args = ['--version'], blocked = true, repairCommand } = {}) {
  const result = await executor.run(command, args)
  const status = result.code === 0 ? 'PASS' : blocked ? 'BLOCKED' : 'FAIL'
  return makeCheck({ id, target, phase, status, message: result.code === 0 ? `${command} is available` : `${command} is unavailable`, repairCommand: result.code === 0 ? undefined : repairCommand ?? `Install or configure ${command}`, evidence: { command, output: commandOutput(result), code: result.code } })
}

export async function checkManifest(manifestPath, { executor = createDefaultExecutor(), id = 'repository.manifest.jsonc', target = 'repository' } = {}) {
  let source
  try { source = await executor.readFile(manifestPath) }
  catch (error) { return makeCheck({ id, target, status: 'FAIL', message: `Cannot read ${manifestPath}: ${error.message}`, repairCommand: `Restore ${manifestPath}` }) }
  try {
    const manifest = parseJsonc(source)
    const appid = typeof manifest?.appid === 'string' ? manifest.appid : ''
    return makeCheck({ id, target, status: 'PASS', message: appid ? 'manifest.json is valid JSONC' : 'manifest.json is valid JSONC; DCloud AppID is empty for debug-only use', evidence: { path: manifestPath, appid, releaseWarning: !appid } })
  }
  catch (error) {
    return makeCheck({ id, target, status: 'FAIL', message: `manifest.json is invalid JSONC: ${error.message}`, repairCommand: 'Fix packages/template/src/manifest.json', evidence: { path: manifestPath } })
  }
}

export async function checkRequiredFiles(paths, { executor = createDefaultExecutor(), id = 'repository.files', target = 'repository', phase = 'baseline' } = {}) {
  const missing = []
  for (const filePath of paths) if (!await executor.exists(filePath)) missing.push(filePath)
  return makeCheck({ id, target, phase, status: missing.length ? 'FAIL' : 'PASS', message: missing.length ? `Missing ${missing.length} required file(s)` : `All ${paths.length} required files exist`, repairCommand: missing.length ? `Restore: ${missing.join(', ')}` : undefined, evidence: { paths, missing } })
}

export async function checkDependencies(source, names, { executor = createDefaultExecutor(), id = 'repository.dependencies', target = 'repository' } = {}) {
  const missing = []
  for (const name of names) {
    const packagePath = path.join(source, 'node_modules', name, 'package.json')
    if (!await executor.exists(packagePath)) missing.push(name)
  }
  return makeCheck({ id, target, phase: 'baseline', status: missing.length ? 'FAIL' : 'PASS', message: missing.length ? `Dependencies unavailable: ${missing.join(', ')}` : 'Required dependencies are installed', repairCommand: missing.length ? `pnpm --dir ${source} install --frozen-lockfile` : undefined, evidence: { source, dependencies: names, missing } })
}

export async function checkLockfiles({ repo = registryRoot, source, executor = createDefaultExecutor({ cwd: repo }), target = 'repository' } = {}) {
  const checks = []
  for (const [scope, cwd] of [['workspace', repo], ['template', source]]) {
    const result = await executor.run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', '--lockfile-only', '--reporter=silent'], { cwd, timeoutMs: 120_000 })
    checks.push(makeCheck({
      id: `repository.lockfile.${scope}`,
      target,
      phase: 'baseline',
      status: result.code === 0 ? 'PASS' : 'FAIL',
      message: result.code === 0 ? `${scope} lockfile satisfies frozen-lockfile validation` : `${scope} lockfile failed frozen-lockfile validation`,
      repairCommand: result.code === 0 ? undefined : `pnpm --dir ${cwd} install --frozen-lockfile`,
      evidence: { cwd, output: result.output ?? `${result.stdout ?? ''}${result.stderr ?? ''}`, code: result.code },
    }))
  }
  return checks
}

export function expectedArtifacts(target, source) {
  const definition = TARGET_DEFINITIONS[target]
  return (definition?.artifacts ?? []).map(file => path.join(source, file))
}

export async function checkArtifacts(target, source, { executor = createDefaultExecutor(), id = `build.${target}.artifacts` } = {}) {
  const files = expectedArtifacts(target, source)
  const missing = []
  for (const filePath of files) {
    if (!await executor.exists(filePath)) missing.push(filePath)
  }
  return makeCheck({ id, target, phase: 'build', status: missing.length ? 'FAIL' : 'PASS', message: missing.length ? `Missing build artifacts: ${missing.map(file => path.relative(source, file)).join(', ')}` : `Build artifacts for ${target} are present`, repairCommand: missing.length ? `pnpm --dir ${source} run build:${TARGET_DEFINITIONS[target]?.buildTarget ?? target}` : undefined, evidence: { files, missing } })
}

export async function runTargetBuild(record, { executor = createDefaultExecutor(), runBuild = true } = {}) {
  if (!runBuild) return makeCheck({ id: `build.${record.target}.skipped`, target: record.target, phase: 'build', status: 'PASS', message: 'Build skipped by caller', evidence: { skipped: true } })
  const result = await executor.run('pnpm', ['--dir', record.source, 'run', record.buildScript], { cwd: path.dirname(record.source), timeoutMs: 240_000 })
  if (result.code !== 0) return makeCheck({ id: `build.${record.target}.command`, target: record.target, phase: 'build', status: 'FAIL', message: `Build command failed for ${record.target}`, repairCommand: `pnpm --dir ${record.source} run ${record.buildScript}`, evidence: { output: commandOutput(result), code: result.code } })
  return checkArtifacts(record.target, record.source, { executor })
}

export async function runAppCssSmoke(record, { executor = createDefaultExecutor(), scriptPath = path.join(registryRoot, 'scripts/template-tests/app-css-smoke.mjs') } = {}) {
  const result = await executor.run(process.execPath, [scriptPath], { cwd: record.source })
  return makeCheck({
    id: 'build.app.css-smoke',
    target: record.target,
    phase: 'build',
    status: result.code === 0 ? 'PASS' : 'FAIL',
    message: result.code === 0 ? 'App CSS compatibility smoke test passed' : 'App CSS compatibility smoke test failed',
    repairCommand: result.code === 0 ? undefined : `node ${scriptPath}`,
    evidence: { output: commandOutput(result), code: result.code, scriptPath },
  })
}

export async function listAndroidDevices({ executor = createDefaultExecutor() } = {}) {
  const result = await executor.run('adb', ['devices', '-l'])
  if (result.code !== 0) return { devices: [], result }
  const devices = commandOutput(result).split(/\r?\n/).slice(1).map(line => line.trim()).filter(Boolean).map(line => {
    const [id, state, ...attributes] = line.split(/\s+/)
    const evidence = Object.fromEntries(attributes.map(attribute => attribute.split(':')).filter(pair => pair.length === 2))
    return { id, state, ...evidence }
  })
  return { devices, result }
}

export function selectAndroidDevice(devices, requestedId) {
  const online = devices.filter(device => device.state === 'device')
  if (requestedId) return online.find(device => device.id === requestedId) ?? null
  return online.length === 1 ? online[0] : null
}

export async function checkAndroidDevice({ executor = createDefaultExecutor(), requestedId, target = 'app-android' } = {}) {
  const listed = await listAndroidDevices({ executor })
  const selected = selectAndroidDevice(listed.devices, requestedId)
  const online = listed.devices.filter(device => device.state === 'device')
  const valid = selected && (requestedId ? true : online.length === 1)
  return makeCheck({ id: 'android.device.online', target, phase: 'runtime', status: valid ? 'PASS' : 'BLOCKED', message: valid ? `Android device ${selected.id} is online` : `Expected exactly one online Android device, found ${online.length}`, repairCommand: valid ? undefined : 'adb devices', evidence: { devices: listed.devices, selected: selected?.id, output: commandOutput(listed.result) } })
}

export async function listIosSimulators({ executor = createDefaultExecutor(), available = true } = {}) {
  const args = ['simctl', 'list', 'devices', ...(available ? ['available'] : ['booted']), '-j']
  const result = await executor.run('xcrun', args)
  if (result.code !== 0) return { devices: [], result }
  try {
    const payload = JSON.parse(commandOutput(result))
    const devices = Object.entries(payload.devices ?? {}).flatMap(([runtime, entries]) => entries.map(device => ({ ...device, runtime }))).filter(device => device.runtime.includes('iOS-') || device.runtime.includes('iOS.'))
    return { devices, result }
  }
  catch { return { devices: [], result, parseError: true } }
}

export function selectIosSimulator(devices, configuredId) {
  const usable = devices.filter(device => device.isAvailable !== false)
  if (configuredId) return usable.find(device => device.udid === configuredId) ?? null
  if (usable.length === 1) return usable[0]
  const sorted = usable.filter(device => device.lastBootedAt).sort((a, b) => new Date(b.lastBootedAt) - new Date(a.lastBootedAt))
  if (sorted.length && (!sorted[1] || sorted[0].lastBootedAt !== sorted[1].lastBootedAt)) return sorted[0]
  return null
}

export async function checkIosSimulator({ executor = createDefaultExecutor(), configuredId, target = 'app-ios' } = {}) {
  const listed = await listIosSimulators({ executor, available: true })
  const selected = selectIosSimulator(listed.devices, configuredId)
  const booted = selected?.state === 'Booted'
  return makeCheck({ id: 'ios.simulator.available', target, phase: 'runtime', status: booted ? 'PASS' : 'BLOCKED', message: booted ? `iOS Simulator ${selected.name} (${selected.udid}) is booted` : selected ? `iOS Simulator ${selected.name} (${selected.udid}) is available but not booted` : `Could not select one available iOS Simulator from ${listed.devices.length}`, repairCommand: booted ? undefined : configuredId ? `xcrun simctl boot ${configuredId}` : 'Set DAILY_IOS_DEVICE_ID to an available iOS Simulator UDID, then run xcrun simctl boot <udid>', evidence: { devices: listed.devices, selected, booted } })
}

export async function checkWechat({ executor = createDefaultExecutor(), source, target = 'mp-weixin' } = {}) {
  const cliPath = process.env.WECHAT_DEVTOOLS_CLI ?? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
  const cli = await checkCommand(cliPath, { executor, id: 'wechat.devtools.cli', target, args: ['--version'], repairCommand: 'Install WeChat DevTools and enable its service port' })
  if (cli.status !== 'PASS') return [cli]
  const login = await executor.run('pnpm', ['exec', 'weapp', 'islogin'], { cwd: source })
  const output = commandOutput(login)
  const loggedIn = login.code === 0 && /"login"\s*:\s*true/i.test(output)
  return [cli, makeCheck({ id: 'wechat.login', target, phase: 'runtime', status: loggedIn ? 'PASS' : 'BLOCKED', message: loggedIn ? 'WeChat DevTools is logged in' : 'WeChat DevTools login is expired or its service port is unavailable', repairCommand: loggedIn ? undefined : `pnpm --dir ${source} exec weapp login`, evidence: { output, code: login.code } })]
}

export async function checkChrome({ executor = createDefaultExecutor(), target = 'h5' } = {}) {
  const configured = process.env.HMR_CHROME_PATH
  const candidates = [configured, process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome', 'chromium', 'chromium-browser'].filter(Boolean)
  try {
    const require = createRequire(import.meta.url)
    candidates.push(require('playwright').chromium.executablePath())
  }
  catch {}
  for (const candidate of candidates) {
    const result = await executor.run(candidate, ['--version'])
    if (result.code !== 0) continue
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('preflight-ok')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const headless = await executor.run(candidate, ['--headless=new', '--disable-gpu', '--no-sandbox', '--dump-dom', `http://127.0.0.1:${port}`])
    server.close()
    const status = headless.code === 0 ? 'PASS' : 'BLOCKED'
    return makeCheck({ id: 'h5.chrome', target, phase: 'runtime', status, message: status === 'PASS' ? `${candidate} is available and starts headless` : `${candidate} is installed but cannot start headless`, repairCommand: status === 'PASS' ? undefined : 'Start Chrome once interactively or set HMR_CHROME_PATH to a working browser', evidence: { path: candidate, version: commandOutput(result), headless: { code: headless.code, output: commandOutput(headless) } } })
  }
  return makeCheck({ id: 'h5.chrome', target, phase: 'runtime', status: 'BLOCKED', message: 'Chrome/Chromium is unavailable', repairCommand: 'Install Google Chrome or set HMR_CHROME_PATH', evidence: { candidates } })
}

export function matchesHBuilderX(version, compilerVersion, compilerPackageVersion = '') {
  if (!version || !compilerVersion) return false
  const alpha = /alpha|beta|rc/i.test(version)
  const compilerAlpha = /alpha|beta|rc/i.test(compilerPackageVersion || compilerVersion)
  const numeric = version.replace(/-(?:alpha|beta|rc).*$/i, '')
  const compilerNumeric = String(compilerVersion).replace(/-(?:alpha|beta|rc).*$/i, '')
  return alpha === compilerAlpha && (numeric === compilerNumeric || numeric.startsWith(`${compilerNumeric}.`))
}

export async function checkHBuilderX({ executor = createDefaultExecutor(), source, target = 'app', cliPath, checkActive = true } = {}) {
  let compilerVersion
  let compilerPackageVersion
  try {
    const packageJson = JSON.parse(await executor.readFile(path.join(source, 'node_modules/@dcloudio/vite-plugin-uni/package.json')))
    compilerVersion = packageJson['uni-app']?.compilerVersion
    compilerPackageVersion = packageJson.version
    if (!compilerVersion) throw new Error('Missing compilerVersion')
  }
  catch {
    return makeCheck({ id: 'app.hbuilderx.compiler', target, phase: 'runtime', status: 'FAIL', message: 'Could not determine uni-app compiler version', repairCommand: `pnpm --dir ${source} install --frozen-lockfile` })
  }
  const explicit = cliPath || process.env.HBUILDERX_CLI_PATH
  const candidates = explicit ? [explicit] : ['/Applications/HBuilderX.app/Contents/MacOS/cli', '/Applications/HBuilderX-Alpha.app/Contents/MacOS/cli']
  const installed = []
  for (const cli of candidates) {
    if (!(await executor.exists(cli))) continue
    const appPath = path.resolve(path.dirname(cli), '../..')
    const metadata = await executor.run('defaults', ['read', path.join(appPath, 'Contents/Info'), 'CFBundleShortVersionString'])
    const version = commandOutput(metadata).trim()
    installed.push({ cli, appPath, version, compatible: metadata.code === 0 && matchesHBuilderX(version, compilerVersion, compilerPackageVersion) })
  }
  const selected = installed.find(candidate => candidate.compatible)
  let active
  let status = selected ? 'PASS' : 'BLOCKED'
  let message = selected ? `HBuilderX ${selected.version} matches uni-app compiler ${compilerVersion}` : `uni-app compiler ${compilerVersion} requires a matching HBuilderX release channel`
  if (selected && checkActive) {
    const result = await executor.run(selected.cli, ['version'])
    const output = commandOutput(result).replace(/\u001b\[[0-9;]*m/g, '').trim()
    active = { code: result.code, output, timedOut: result.timedOut }
    // The macOS CLI may return exit 0 while redirecting to another running IDE.
    if (result.code !== 0 || !matchesHBuilderX(output, compilerVersion, compilerPackageVersion)) {
      status = 'BLOCKED'
      message = `HBuilderX CLI cannot reach the matching IDE: ${output || 'no version returned'}`
    }
  }
  return makeCheck({ id: 'app.hbuilderx.compiler', target, phase: 'runtime', status, message,
    repairCommand: status === 'PASS' ? undefined : 'Use the HBuilderX version and release channel matching the compiler; resolve any conflicting existing IDE session',
    evidence: { compilerVersion, compilerPackageVersion, installed, selected, active } })
}

// Preparation and runtime checks share the installed-version/channel selector.
// The caller owns cleanup only after a successful open initiated here.
export async function prepareHBuilderX({ source, executor = createDefaultExecutor(), onStarted = () => {} } = {}) {
  const installed = await checkHBuilderX({ source, executor, checkActive: false })
  if (installed.status !== 'PASS') return installed
  const selected = installed.evidence.selected
  const running = await executor.run('pgrep', ['-f', `${selected.appPath}/Contents/MacOS/`])
  if (running.code !== 0) {
    const another = await executor.run('pgrep', ['-f', '/HBuilderX[^/]*\\.app/Contents/MacOS/'])
    if (another.code === 0) {
      return { ...installed, status: 'BLOCKED', message: 'An existing HBuilderX session uses a different installation; resolve it before starting the matching IDE' }
    }
    const opened = await executor.run('open', ['-a', selected.appPath])
    if (opened.code !== 0) return { ...installed, status: 'BLOCKED', message: `Cannot open ${selected.appPath}: ${commandOutput(opened)}` }
    onStarted(selected)
  }
  return checkHBuilderX({ source, executor, cliPath: selected.cli })
}

export async function checkBaseline({ repo = registryRoot, source, packageManager, executor = createDefaultExecutor({ cwd: repo }), target = 'repository' } = {}) {
  const sourcePackage = await readPackageJson(source, executor)
  const checks = await checkNodeAndPnpm({ executor, packageManager, cwd: source, nodeRequirement: sourcePackage?.engines?.node, target })
  const rootFiles = [path.join(repo, 'templates.json'), path.join(repo, 'package.json'), path.join(source, 'package.json'), path.join(source, 'vite.config.ts'), path.join(source, 'src/tailwind.css'), path.join(source, 'src/pages.json'), path.join(source, 'src/manifest.json')]
  checks.push(await checkRequiredFiles(rootFiles, { executor, target }))
  checks.push(await checkManifest(path.join(source, 'src/manifest.json'), { executor, target }))
  checks.push(await checkDependencies(source, ['@dcloudio/vite-plugin-uni', '@dcloudio/uni-app', 'vite', 'vue', 'tailwindcss', 'weapp-tailwindcss', 'weapp-ide-cli'], { executor, target }))
  checks.push(await checkDependencies(repo, ['playwright', 'pngjs', 'jsonc-parser'], { executor, id: 'repository.tooling.dependencies', target }))
  checks.push(...await checkLockfiles({ repo, source, executor, target }))
  const bridge = path.join(source, '.hmr-artifacts/.file-event-bridge')
  if (await executor.exists(bridge)) checks.push(makeCheck({ id: 'repository.hmr.bridge', target, status: 'FAIL', message: 'A stale HMR file-event bridge exists', repairCommand: `rm -f ${bridge}`, evidence: { path: bridge } }))
  else checks.push(makeCheck({ id: 'repository.hmr.bridge', target, status: 'PASS', message: 'No stale HMR bridge found' }))
  return checks
}

export async function runPreflight({ repo = registryRoot, repoRoot, registry, selection, target, executor, runBuild = true, packageManager, prepare = false, environment = process.env } = {}) {
  repo = repoRoot ?? repo
  executor ??= createDefaultExecutor({ cwd: repo })
  const loaded = registry ?? await loadTemplateRegistry()
  const records = normalizeTargets(loaded, selection ?? target)
  if (records.length === 0) throw new Error('No registered targets selected')
  const checks = []
  const bySource = new Map()
  for (const record of records) bySource.set(record.source, record)
  for (const record of bySource.values()) {
    const sourcePackage = await readPackageJson(record.source, executor)
    checks.push(...await checkBaseline({ repo, source: record.source, packageManager: packageManager ?? sourcePackage?.packageManager, executor }))
  }
  const baselineFailed = aggregateStatus(checks) === 'FAIL'
  const targetResults = []
  const builtTargets = new Set()
  const appCssSmokeTargets = new Set()
  for (const record of records) {
    const targetChecks = []
    if (baselineFailed) {
      targetChecks.push(makeCheck({ id: `${record.target}.blocked-by-baseline`, target: record.target, phase: 'build', status: 'FAIL', message: 'Baseline checks failed; target build was not started', evidence: { baseline: checks.filter(check => check.status === 'FAIL').map(check => check.id) } }))
    }
    else {
      const buildKey = `${record.source}:${record.buildTarget}`
      if (builtTargets.has(buildKey)) {
        targetChecks.push(await checkArtifacts(record.target, record.source, { executor, id: `build.${record.target}.artifacts` }))
      }
      else {
        targetChecks.push(await runTargetBuild(record, { executor, runBuild }))
        if (runBuild) builtTargets.add(buildKey)
      }
      if (record.buildTarget === 'app' && runBuild && !appCssSmokeTargets.has(buildKey) && targetChecks.at(-1).status !== 'FAIL') {
        targetChecks.push(await runAppCssSmoke(record, { executor, scriptPath: path.join(repo, 'scripts/template-tests/app-css-smoke.mjs') }))
        appCssSmokeTargets.add(buildKey)
      }
      if (targetChecks.at(-1).status !== 'FAIL') targetChecks.push(...await runtimeChecks(record, { executor, prepare, environment }))
    }
    checks.push(...targetChecks)
    targetResults.push({ ...record, status: aggregateStatus(targetChecks), checks: targetChecks })
  }
  return { status: aggregateStatus(checks), targets: records, checks, targetResults, environment: { node: process.version, platform: process.platform, arch: process.arch, prepare } }
}

export async function writePreflightReport(summary, reportDir) {
  await mkdir(reportDir, { recursive: true })
  const report = { ...summary, generatedAt: summary.generatedAt ?? new Date().toISOString() }
  const summaryPath = path.join(reportDir, 'summary.json')
  const markdownPath = path.join(reportDir, 'summary.md')
  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  const lines = [
    '# 多端测试预检报告',
    '',
    `Overall: **${report.status}**`,
    '',
    '| Target | Status | Phase | Detail |',
    '| --- | --- | --- | --- |',
    ...(report.checks ?? []).map(check => `| ${check.target} | ${check.status} | ${check.phase} | ${String(check.message ?? '').replaceAll('|', '\\|')} |`),
    '',
  ]
  const repairs = (report.checks ?? []).filter(check => check.repairCommand)
  if (repairs.length > 0) {
    lines.push('## 修复命令', '')
    for (const check of repairs) lines.push(`- ${check.target} / ${check.id}: \`${String(check.repairCommand).replaceAll('`', '\\`')}\``)
    lines.push('')
  }
  await writeFile(markdownPath, `${lines.join('\n')}\n`, 'utf8')
  return { ...report, summaryPath, markdownPath, reportDir }
}

async function runtimeChecks(record, options) {
  if (record.target === 'h5') return [await checkChrome({ ...options, target: record.target })]
  if (record.target === 'mp-weixin') return checkWechat({ ...options, source: record.source, target: record.target })
  if (record.target === 'app-android') return [await checkHBuilderX({ ...options, source: record.source, target: record.target }), await checkAndroidDevice({ ...options, target: record.target })]
  if (record.target === 'app-ios') return [await checkHBuilderX({ ...options, source: record.source, target: record.target }), await checkIosSimulator({ ...options, configuredId: options.environment?.DAILY_IOS_DEVICE_ID, target: record.target })]
  if (record.target === 'mp-alipay' || record.target === 'mp-toutiao') return [makeCheck({ id: `${record.target}.runtime.manual`, target: record.target, phase: 'runtime', status: 'BLOCKED', message: `${record.target} artifact is ready; vendor IDE runtime verification is a manual step`, repairCommand: `Open dist/build/${record.target} in the ${record.target === 'mp-alipay' ? 'Alipay' : 'ByteDance'} mini-program IDE`, evidence: { manual: true } })]
  return []
}

async function readPackageJson(source, executor) {
  try { return JSON.parse(await executor.readFile(path.join(source, 'package.json'))) } catch { return undefined }
}

function parseJsonc(source) {
  try { return JSON.parse(source) }
  catch {
    const require = createRequire(import.meta.url)
    const jsonc = require('jsonc-parser')
    const errors = []
    const value = jsonc.parse(source, errors, { allowTrailingComma: true })
    if (errors.length) throw new Error(`JSONC parse errors: ${errors.map(error => error.error).join(', ')}`)
    return value
  }
}

function firstVersion(output) {
  return String(output ?? '').match(/\d+(?:\.\d+){1,3}/)?.[0] ?? ''
}

function commandOutput(result) {
  return String(result?.output ?? `${result?.stdout ?? ''}${result?.stderr ?? ''}`)
}

export { TARGET_DEFINITIONS as targetDefinitions }
