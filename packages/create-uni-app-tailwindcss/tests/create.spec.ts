import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const packageRoot = process.cwd()

test('scaffolds a project from the bundled template', async ({}, testInfo) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'uni-app-tailwindcss-'))
  const projectDir = path.join(dir, 'sample-app')

  try {
    await runCommand('pnpm', ['--dir', packageRoot, 'run', 'start', '--', projectDir, '--pm', 'pnpm'], packageRoot)
    const pkg = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('sample-app')
    await expectFile(path.join(projectDir, '.npmrc'))
    await expectFile(path.join(projectDir, 'src', 'pages.json'))
    await expectFile(path.join(projectDir, 'vite.config.ts'))
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }

  await testInfo.attach('scaffold-result', { body: 'ok', contentType: 'text/plain' })
})

async function expectFile(filePath: string) {
  const content = await readFile(filePath, 'utf8')
  expect(content.length).toBeGreaterThan(0)
}

function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`exit ${code ?? 'null'}`))
    })
  })
}
