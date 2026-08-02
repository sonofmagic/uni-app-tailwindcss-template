#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createFixtureController, getFixtureState, targetVueFile } from './hmr-fixture.mjs'

const cwd = process.cwd()
const args = parseArgs(process.argv.slice(2))
const platform = args.platform
const devScript = args.script ?? `dev:${platform}`
const timeoutMs = Number(args.timeout ?? 180_000)
const pollMs = Number(args.poll ?? 700)
const artifactTypes = new Map([
  ['.css', 'styles'],
  ['.js', 'scripts'],
  ['.wxml', 'templates'],
  ['.wxss', 'styles'],
])

let devProcess
let fixture
let interrupted = false

installSignalHandler('SIGINT')
installSignalHandler('SIGTERM')
process.once('exit', () => fixture?.restoreSync())

main().catch((error) => {
  console.error(`\n[hmr-smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}).finally(async () => {
  await fixture?.restore()
  await stopDevProcess()
})

async function main() {
  if (!platform) {
    throw new Error('Missing required argument: --platform <platform>')
  }

  fixture = await createFixtureController()
  await fixture.apply('initial')

  console.log(`[hmr-smoke] platform=${platform}`)
  console.log(`[hmr-smoke] script=${devScript}`)

  const outputDir = path.join(cwd, 'dist', 'dev', platform)
  await fs.rm(outputDir, { recursive: true, force: true })
  devProcess = runDevScript(devScript)

  const initialSnapshot = await waitForArtifactSnapshot(outputDir, 'initial')
  console.log(`[hmr-smoke] initial artifact files=${initialSnapshot.files.length}`)

  const beforeMtime = await getLatestMtimeMs(outputDir)
  await fixture.apply('updated')
  console.log(`[hmr-smoke] updated ${path.relative(cwd, targetVueFile)} fixture`)

  await waitForDirMtimeBump(outputDir, beforeMtime)
  const updatedSnapshot = await waitForArtifactSnapshot(outputDir, 'updated')
  console.log(`[hmr-smoke] updated artifact files=${updatedSnapshot.files.length}`)
  console.log('[hmr-smoke] PASS')
}

function runDevScript(scriptName) {
  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const child = spawn(pnpmCommand, ['run', scriptName], {
    cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CHOKIDAR_INTERVAL: '200',
      CHOKIDAR_USEPOLLING: 'true',
      FORCE_COLOR: '0',
      HMR_SMOKE_USE_POLLING: 'true',
    },
  })

  child.stdout.on('data', chunk => process.stdout.write(`[dev:${platform}] ${chunk}`))
  child.stderr.on('data', chunk => process.stderr.write(`[dev:${platform}:err] ${chunk}`))
  return child
}

async function waitForArtifactSnapshot(dir, stateName) {
  const state = getFixtureState(stateName)
  const hex = state.colorClass.match(/#[0-9a-f]+/i)?.[0]
  const height = state.heightClass.slice(3, -1)
  const radius = state.radiusClass.slice(9, -1)
  const transformedColor = `bg-_b_h${hex.slice(1)}_B`
  const startedAt = Date.now()
  let lastSnapshot = { files: [], scripts: '', styles: '', templates: '' }
  let assertions = {}

  while (Date.now() - startedAt < timeoutMs) {
    if (interrupted) {
      throw new Error('Interrupted while waiting for artifact HMR evidence')
    }
    lastSnapshot = await readArtifactSnapshot(dir)
    assertions = {
      baseUtilities: lastSnapshot.templates.includes('flex') && lastSnapshot.templates.includes('font-bold'),
      scriptClass: lastSnapshot.scripts.includes(transformedColor)
        && lastSnapshot.scripts.includes('wx_cborder-blue-500')
        && lastSnapshot.scripts.includes('not-wx_cborder-rose-500'),
      styleColor: lastSnapshot.styles.toLowerCase().includes(hex.toLowerCase()),
      styleHeight: lastSnapshot.styles.includes(height),
      stylePlatformVariant: lastSnapshot.styles.includes('wx_cborder-blue-500'),
      stylePseudo: lastSnapshot.styles.includes(state.pseudo),
      styleRadius: lastSnapshot.styles.includes(radius),
      templateArbitraryValues: lastSnapshot.templates.includes(`h-_b${height}_B`)
        && lastSnapshot.templates.includes(`rounded-_b${radius}_B`),
      templateText: lastSnapshot.templates.includes(state.text),
    }
    if (lastSnapshot.files.length > 0 && Object.values(assertions).every(Boolean)) {
      console.log(`[hmr-smoke] ${stateName}: template, script and style markers found`)
      return lastSnapshot
    }
    await sleep(pollMs)
  }

  throw new Error(`${stateName}: timed out under ${path.relative(cwd, dir)}; assertions=${JSON.stringify(assertions)}; files=${lastSnapshot.files.join(', ')}`)
}

async function readArtifactSnapshot(dir) {
  if (!existsSync(dir)) {
    return { files: [], scripts: '', styles: '', templates: '' }
  }
  const files = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      }
      else if (artifactTypes.has(path.extname(entry.name))) {
        files.push({ path: fullPath, type: artifactTypes.get(path.extname(entry.name)) })
      }
    }
  }
  const content = { scripts: [], styles: [], templates: [] }
  for (const file of files.sort((left, right) => left.path.localeCompare(right.path))) {
    content[file.type].push(await fs.readFile(file.path, 'utf8'))
  }
  return {
    files: files.map(file => path.relative(cwd, file.path)),
    scripts: content.scripts.join('\n'),
    styles: content.styles.join('\n'),
    templates: content.templates.join('\n'),
  }
}

async function waitForDirMtimeBump(dir, beforeMtime) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (interrupted) {
      throw new Error('Interrupted while waiting for incremental rebuild')
    }
    if (await getLatestMtimeMs(dir) > beforeMtime) {
      return
    }
    await sleep(Math.min(pollMs, 500))
  }
  throw new Error(`Timed out waiting for incremental rebuild under ${path.relative(cwd, dir)}`)
}

async function getLatestMtimeMs(dir) {
  if (!existsSync(dir)) {
    return 0
  }
  let latest = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      }
      else {
        latest = Math.max(latest, (await fs.stat(fullPath)).mtimeMs)
      }
    }
  }
  return latest
}

async function stopDevProcess() {
  if (!devProcess || devProcess.exitCode !== null) {
    return
  }
  try {
    process.kill(-devProcess.pid, 'SIGTERM')
  }
  catch {
    devProcess.kill('SIGTERM')
  }
  await Promise.race([new Promise(resolve => devProcess.once('exit', resolve)), sleep(8_000)])
  if (devProcess.exitCode === null) {
    devProcess.kill('SIGKILL')
  }
}

function installSignalHandler(signal) {
  process.once(signal, () => {
    interrupted = true
    process.exitCode = 1
    fixture?.restoreSync()
    void stopDevProcess()
  })
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
