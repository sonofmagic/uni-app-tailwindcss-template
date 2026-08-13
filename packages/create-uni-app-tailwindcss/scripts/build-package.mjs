import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as wait } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const lockPath = path.join(packageRoot, '.build-lock')
await acquireLock(lockPath)

try {
  await run('pnpm', ['exec', 'tsup', 'src/cli.ts', '--format', 'esm', '--out-dir', 'dist', '--clean'])
  await run(process.execPath, ['scripts/build-templates.mjs'])
}
finally {
  await rm(lockPath, { force: true, recursive: true })
}

async function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      await mkdir(lockPath)
      return
    }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      await wait(100)
    }
  }
  throw new Error('Timed out waiting for the package build lock')
}

function run(command, args) {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: packageRoot, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by ${signal}`))
        return
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? 'null'}`))
        return
      }
      resolve()
    })
  })
}
