import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const packageRoot = process.cwd()
const repoRoot = path.resolve(packageRoot, '../..')
const registry = JSON.parse(readFileSync(path.join(repoRoot, 'templates.json'), 'utf8'))

for (const template of registry.templates) {
  test(`scaffolds the ${template.id} template`, async ({}, testInfo) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'uni-app-tailwindcss-'))
    const projectDir = path.join(dir, `${template.id}-app`)

    try {
      await runCommand('pnpm', [
        '--dir', packageRoot, 'run', 'start', '--', projectDir,
        '--template', template.id,
        '--pm', 'pnpm',
      ], packageRoot)
      const pkg = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'))
      expect(pkg.name).toBe(`${template.id}-app`)
      await expectFile(path.join(projectDir, '.npmrc'))
      await expectFile(path.join(projectDir, 'src', 'pages.json'))
      await expectFile(path.join(projectDir, 'vite.config.ts'))
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }

    await testInfo.attach('scaffold-result', { body: template.id, contentType: 'text/plain' })
  })
}

test('rejects an unknown template', async () => {
  const result = await runCommand('pnpm', [
    '--dir', packageRoot, 'run', 'start', '--', 'unused-app',
    '--template', 'missing-template',
  ], packageRoot, false)
  expect(result.code).not.toBe(0)
  expect(result.output).toContain('Unknown template "missing-template"')
})

async function expectFile(filePath: string) {
  const content = await readFile(filePath, 'utf8')
  expect(content.length).toBeGreaterThan(0)
}

function runCommand(command: string, args: string[], cwd: string, inherit = true) {
  return new Promise<{ code: number | null, output: string }>((resolve, reject) => {
    let output = ''
    const child = spawn(command, args, {
      cwd,
      stdio: inherit ? 'inherit' : 'pipe',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    })

    child.stdout?.on('data', chunk => output += chunk)
    child.stderr?.on('data', chunk => output += chunk)

    child.on('exit', (code) => {
      if (code === 0 || !inherit) {
        resolve({ code, output })
        return
      }
      reject(new Error(`exit ${code ?? 'null'}`))
    })
  })
}
