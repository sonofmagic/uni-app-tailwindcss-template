import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { compareContracts, resolveSources, supportedSources } from './daily-contract.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = path.resolve(packageRoot, '../..')
const args = parseArgs(process.argv.slice(2))
const requestedSource = args.source ?? 'all'
const sources = resolveSources(requestedSource)
const reportBase = path.resolve(repoRoot, args['report-dir'] ?? 'packages/template/.hmr-artifacts/user-journey')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'uni-app-tailwindcss-user-'))
const activeChildren = new Set()
const results = []
let contractComparison
let interruptedSignal

process.once('exit', () => rmSync(temporaryRoot, { recursive: true, force: true }))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interruptedSignal = signal
    for (const child of activeChildren) stopChild(child)
  })
}

await fs.mkdir(reportBase, { recursive: true })
try {
  for (const source of sources) {
    if (interruptedSignal) break
    const sourceRoot = path.join(temporaryRoot, source)
    const projectRoot = path.join(sourceRoot, 'daily-user-app')
    const reportRoot = path.join(reportBase, source, `node-${process.versions.node.split('.')[0]}`)
    await fs.mkdir(sourceRoot, { recursive: true })
    await fs.rm(reportRoot, { recursive: true, force: true })
    await fs.mkdir(reportRoot, { recursive: true })
    const startedAt = Date.now()
    try {
      await scaffold(source, sourceRoot, projectRoot)
      const contract = await createContract(projectRoot, source)
      await fs.writeFile(path.join(reportRoot, 'contract.json'), `${JSON.stringify(contract, null, 2)}\n`)
      const result = await runPlaywright(source, projectRoot, reportRoot)
      results.push({ source, status: result.code === 0 ? 'PASS' : 'FAIL', durationMs: Date.now() - startedAt })
    }
    catch (error) {
      results.push({ source, status: 'FAIL', durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (sources.length === 2) contractComparison = await compareSourceContracts()
}
finally {
  const sourcesComplete = results.length === sources.length
  const sourcesPassed = sourcesComplete && results.every(result => result.status === 'PASS')
  const contractPassed = !contractComparison || contractComparison.matches
  await fs.writeFile(path.join(reportBase, 'runner-summary.json'), `${JSON.stringify({
    coverage: `${results.length}/${sources.length}`,
    contractComparison,
    generatedAt: new Date().toISOString(),
    results,
    status: sourcesPassed && contractPassed ? 'PASS' : 'FAIL',
  }, null, 2)}\n`)
  await fs.rm(temporaryRoot, { recursive: true, force: true })
}

process.exitCode = interruptedSignal
  ? interruptedSignal === 'SIGINT' ? 130 : 143
  : results.length === sources.length
    && results.every(result => result.status === 'PASS')
    && (!contractComparison || contractComparison.matches) ? 0 : 1

async function scaffold(source, sourceRoot, projectRoot) {
  let launcher
  if (source === 'latest') {
    launcher = (target, options = [], rejectOnFailure = true, input) => run('pnpm', [
      'create', 'uni-app-tailwindcss@latest', target, ...options,
    ], sourceRoot, {}, rejectOnFailure, input)
  }
  else {
    const packRoot = path.join(sourceRoot, 'pack')
    await fs.mkdir(packRoot, { recursive: true })
    await run('pnpm', ['pack', '--pack-destination', packRoot], packageRoot)
    const tarballs = (await fs.readdir(packRoot)).filter(file => file.endsWith('.tgz'))
    if (tarballs.length !== 1) throw new Error(`Expected one candidate tarball, found ${tarballs.length}`)
    launcher = (target, options = [], rejectOnFailure = true, input) => run('pnpm', [
      'dlx', path.join(packRoot, tarballs[0]), target, ...options,
    ], sourceRoot, {}, rejectOnFailure, input)
  }

  await launcher(projectRoot, ['--template=default', '--pm=pnpm'])
  const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  if (pkg.name !== path.basename(projectRoot)) throw new Error(`Generated package name is ${pkg.name}`)

  const defaultRoot = path.join(sourceRoot, 'default-template-app')
  await launcher(defaultRoot, ['--pm=pnpm'])
  if (!(await exists(path.join(defaultRoot, 'src/pages.json')))) throw new Error('Default template did not generate pages.json')

  const unknown = await launcher(path.join(sourceRoot, 'unknown-template-app'), ['--template=missing-template', '--pm=pnpm'], false)
  if (unknown.code === 0) throw new Error('Unknown template was accepted')

  const existingRoot = path.join(sourceRoot, 'existing-app')
  const marker = path.join(existingRoot, 'keep.txt')
  await fs.mkdir(existingRoot, { recursive: true })
  await fs.writeFile(marker, 'keep\n')
  const existing = await launcher(existingRoot, ['--template=default', '--pm=pnpm'], false, '\n')
  if (existing.code !== 0 || await fs.readFile(marker, 'utf8') !== 'keep\n') {
    throw new Error('Existing directory was overwritten without confirmation')
  }
}

async function createContract(projectRoot, source) {
  const files = await listFiles(projectRoot)
  const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const normalizedPackage = {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
    packageManager: pkg.packageManager,
    scripts: pkg.scripts ?? {},
  }
  const sourceFiles = []
  for (const relative of files.filter(file => !['package.json'].includes(file))) {
    const content = await fs.readFile(path.join(projectRoot, relative))
    sourceFiles.push({ path: relative, sha256: createHash('sha256').update(content).digest('hex') })
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ normalizedPackage, sourceFiles }))
    .digest('hex')
  return { fingerprint, node: process.version, normalizedPackage, source, sourceFiles }
}

async function compareSourceContracts() {
  const major = process.versions.node.split('.')[0]
  const contracts = await Promise.all(supportedSources.map(source => fs.readFile(
    path.join(reportBase, source, `node-${major}`, 'contract.json'),
    'utf8',
  ).then(JSON.parse)))
  const comparison = compareContracts(contracts[0], contracts[1])
  await fs.writeFile(path.join(reportBase, `contract-comparison-node-${major}.json`), `${JSON.stringify(comparison, null, 2)}\n`)
  return comparison
}

function runPlaywright(source, projectRoot, reportRoot) {
  return run(packageManagerCommand(), [
    'exec', 'playwright', 'test', '--config', 'playwright.daily.config.ts',
  ], packageRoot, {
    DAILY_E2E_TEMP_ROOT: path.dirname(projectRoot),
    USER_JOURNEY_PROJECT_ROOT: projectRoot,
    USER_JOURNEY_REPORT_DIR: reportRoot,
    USER_JOURNEY_SOURCE: source,
  }, false)
}

function run(command, commandArgs, cwd, extraEnv = {}, rejectOnFailure = true, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command, commandArgs, {
      cwd,
      detached: process.platform !== 'win32',
      env: { ...process.env, ...extraEnv, FORCE_COLOR: '0' },
      stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    })
    if (input !== undefined) child.stdin.end(input)
    activeChildren.add(child)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      activeChildren.delete(child)
      const result = { code, signal }
      if (rejectOnFailure && (signal || code !== 0)) reject(new Error(`${command} exited with ${signal ?? code ?? 'unknown status'}`))
      else resolve(result)
    })
  })
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

async function listFiles(root) {
  const files = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (['dist', 'node_modules', 'playwright-report', 'test-results'].includes(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(absolute)
      else files.push(path.relative(root, absolute).split(path.sep).join('/'))
    }
  }
  return files.sort()
}

function stopChild(child) {
  if (child.exitCode !== null) return
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else child.kill('SIGTERM')
  }
  catch {}
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) continue
    const separator = value.indexOf('=')
    if (separator !== -1) parsed[value.slice(2, separator)] = value.slice(separator + 1)
    else if (values[index + 1] && !values[index + 1].startsWith('--')) parsed[value.slice(2)] = values[++index]
    else parsed[value.slice(2)] = true
  }
  return parsed
}

function packageManagerCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}
