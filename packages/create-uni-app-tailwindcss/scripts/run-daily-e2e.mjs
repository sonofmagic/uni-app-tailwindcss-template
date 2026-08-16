import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'uni-app-tailwindcss-daily-'))
let child
let interruptedSignal
let cleaningUp

process.once('exit', () => rmSync(temporaryRoot, { recursive: true, force: true }))

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interruptedSignal = signal
    stopChild()
  })
}

try {
  const result = await runPlaywright()
  process.exitCode = interruptedSignal
    ? interruptedSignal === 'SIGINT' ? 130 : 143
    : result.signal ? 1 : result.code ?? 1
}
finally {
  await cleanup()
}

function runPlaywright() {
  return new Promise((resolve) => {
    child = spawn(packageManagerCommand(), ['exec', 'playwright', 'test', '--config', 'playwright.daily.config.ts'], {
      cwd: packageRoot,
      detached: process.platform !== 'win32',
      env: { ...process.env, DAILY_E2E_TEMP_ROOT: temporaryRoot },
      stdio: 'inherit',
    })
    child.on('error', error => console.error(error))
    child.on('exit', (code, signal) => resolve({ code, signal }))
  })
}

function stopChild() {
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else child.kill('SIGTERM')
  }
  catch {}
}

function cleanup() {
  cleaningUp ??= rm(temporaryRoot, { recursive: true, force: true })
  return cleaningUp
}

function packageManagerCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}
