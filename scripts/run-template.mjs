import { spawn } from 'node:child_process'
import process from 'node:process'
import { getTemplate, loadTemplateRegistry, resolveTemplateSource } from './template-registry.mjs'

const [templateId, script, ...args] = process.argv.slice(2)
if (!templateId || !script) {
  throw new Error('Usage: node scripts/run-template.mjs <template> <script> [...args]')
}

const registry = await loadTemplateRegistry()
const template = getTemplate(registry, templateId === '@default' ? undefined : templateId)
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const child = spawn(packageManager, ['--dir', resolveTemplateSource(template), 'run', script, ...args], {
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})

child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
