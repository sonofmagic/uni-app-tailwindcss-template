#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const cwd = process.cwd()
const args = parseArgs(process.argv.slice(2))
const platform = args.platform
const devScript = args.script ?? `dev:${platform}`
const timeoutMs = Number(args.timeout ?? 180_000)
const pollMs = Number(args.poll ?? 700)

const targetVueFile = path.join(cwd, 'src', 'components', 'WeappTailwindcss.vue')
const initialContent = 'before:content-[\'现在，让我们开始神奇的_tailwindcss_开发之旅吧！\']'
const updatedContent = 'before:content-[\'现在，让我们继续神奇的_tailwindcss_HMR_回归之旅吧！\']'
const initialCssContent = '现在，让我们开始神奇的 tailwindcss 开发之旅吧！'
const updatedCssContent = '现在，让我们继续神奇的 tailwindcss HMR 回归之旅吧！'
const iconNeedles = ['github-circle', 'mdi--star']
const styleExtensions = new Set(['.css', '.wxss', '.acss', '.ttss', '.qss'])

let devProcess
let originalTargetContent

main().catch((error) => {
  console.error(`\n[hmr-smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}).finally(async () => {
  await restoreTargetFile()
  await stopDevProcess()
})

async function main() {
  if (!platform) {
    throw new Error('Missing required argument: --platform <platform>')
  }

  originalTargetContent = await fs.readFile(targetVueFile, 'utf8')
  if (!originalTargetContent.includes(initialContent)) {
    throw new Error(`Cannot find Iconify content HMR fixture in ${path.relative(cwd, targetVueFile)}`)
  }

  console.log(`[hmr-smoke] platform=${platform}`)
  console.log(`[hmr-smoke] script=${devScript}`)

  const outputDir = path.join(cwd, 'dist', 'dev', platform)
  await fs.rm(outputDir, { recursive: true, force: true })
  devProcess = runDevScript(devScript)

  const initialSnapshot = await waitForCssSnapshot(outputDir, cssIncludesInitialFixture, 'initial Iconify CSS')
  console.log(`[hmr-smoke] initial css files=${initialSnapshot.files.length}`)

  const beforeMtime = await getLatestMtimeMs(outputDir)
  await fs.writeFile(targetVueFile, originalTargetContent.replace(initialContent, updatedContent), 'utf8')
  console.log(`[hmr-smoke] updated ${path.relative(cwd, targetVueFile)} content fixture`)

  await waitForDirMtimeBump(outputDir, beforeMtime)
  const updatedSnapshot = await waitForCssSnapshot(outputDir, cssIncludesUpdatedFixture, 'updated Iconify CSS')
  console.log(`[hmr-smoke] updated css files=${updatedSnapshot.files.length}`)
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
      FORCE_COLOR: '0',
    },
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[dev:${platform}] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[dev:${platform}:err] ${chunk}`)
  })
  child.on('exit', (code, signal) => {
    if (code !== null) {
      console.log(`[hmr-smoke] dev exited with code=${code}`)
    }
    if (signal) {
      console.log(`[hmr-smoke] dev terminated by signal=${signal}`)
    }
  })

  return child
}

async function waitForCssSnapshot(dir, predicate, phase) {
  const startedAt = Date.now()
  let lastSnapshot = { files: [], css: '' }

  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = await readCssSnapshot(dir)
    if (lastSnapshot.files.length > 0 && predicate(lastSnapshot.css)) {
      console.log(`[hmr-smoke] ${phase}: expected Iconify/content markers found`)
      return lastSnapshot
    }
    await sleep(pollMs)
  }

  throw new Error(
    `${phase}: timed out under ${path.relative(cwd, dir)}; files=${lastSnapshot.files.join(', ')}; cssTail=${lastSnapshot.css.slice(-1000)}`,
  )
}

async function readCssSnapshot(dir) {
  if (!existsSync(dir)) {
    return { files: [], css: '' }
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
        continue
      }
      if (styleExtensions.has(path.extname(entry.name))) {
        files.push(fullPath)
      }
    }
  }

  const cssParts = await Promise.all(files.sort().map(async file => await fs.readFile(file, 'utf8')))
  return {
    files: files.map(file => path.relative(cwd, file)),
    css: cssParts.join('\n'),
  }
}

function cssIncludesInitialFixture(css) {
  return cssIncludesIcons(css) && css.includes(initialCssContent)
}

function cssIncludesUpdatedFixture(css) {
  return cssIncludesIcons(css) && css.includes(updatedCssContent)
}

function cssIncludesIcons(css) {
  return iconNeedles.every(needle => css.includes(needle))
}

async function waitForDirMtimeBump(dir, beforeMtime) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const currentMtime = await getLatestMtimeMs(dir)
    if (currentMtime > beforeMtime) {
      console.log('[hmr-smoke] platform artifacts updated')
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
        continue
      }
      const stat = await fs.stat(fullPath)
      latest = Math.max(latest, stat.mtimeMs)
    }
  }
  return latest
}

async function restoreTargetFile() {
  if (!originalTargetContent) {
    return
  }
  await fs.writeFile(targetVueFile, originalTargetContent, 'utf8')
}

async function stopDevProcess() {
  if (!devProcess || devProcess.exitCode !== null) {
    return
  }

  if (process.platform !== 'win32' && devProcess.pid) {
    try {
      process.kill(-devProcess.pid, 'SIGTERM')
    }
    catch {
      devProcess.kill('SIGTERM')
    }
  }
  else {
    devProcess.kill('SIGTERM')
  }

  await waitForExit(devProcess, 8_000)
  if (devProcess.exitCode === null && devProcess.pid) {
    devProcess.kill('SIGKILL')
    await waitForExit(devProcess, 3_000)
  }
}

function waitForExit(child, timeout) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeout)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function parseArgs(rawArgs) {
  const parsed = {}
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    if (!arg.startsWith('--') || arg === '--') {
      continue
    }
    const key = arg.slice(2)
    const value = rawArgs[index + 1]
    if (!value || value.startsWith('--')) {
      parsed[key] = true
      continue
    }
    parsed[key] = value
    index += 1
  }
  return parsed
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
