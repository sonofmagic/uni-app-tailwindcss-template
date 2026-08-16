import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getTemplate, loadTemplateRegistry, resolveTemplateSource } from './template-registry.mjs'

const [templateId, testName, ...args] = process.argv.slice(2)
if (!templateId || !testName) {
  throw new Error('Usage: node scripts/run-template-test.mjs <template> <test> [...args]')
}

const registry = await loadTemplateRegistry()
const template = getTemplate(registry, templateId === '@default' ? undefined : templateId)
const templateRoot = resolveTemplateSource(template)
const testRoot = fileURLToPath(new URL('./template-tests/', import.meta.url))

if (testName === 'test:app-css:artifact') {
  await runTest('app-css-smoke.mjs', args)
}
else if (testName === 'test:app-css') {
  await run(packageManagerCommand(), ['--dir', templateRoot, 'run', 'build:app'])
  await runTest('app-css-smoke.mjs', args)
}
else if (testName === 'test:hmr') {
  await runTest('hmr-runtime.mjs', args)
}
else if (testName === 'test:hmr:all') {
  await runTest('hmr-runtime.mjs', ['--all', ...args])
}
else if (testName.startsWith('test:hmr:artifact:')) {
  const target = testName.slice('test:hmr:artifact:'.length)
  if (!template.hmrTargets.includes(target)) {
    throw new Error(`Template ${template.id} does not declare HMR artifact target ${target}`)
  }
  await runTest('hmr-smoke.mjs', ['--platform', target, '--script', `dev:${target}`, ...args])
}
else if (testName.startsWith('test:hmr:')) {
  const requestedPlatform = testName.slice('test:hmr:'.length)
  const platform = requestedPlatform.replace(/^app:/, 'app-')
  const supportedPlatforms = new Set(['h5', 'mp-weixin', 'app-android', 'app-ios'])
  if (!supportedPlatforms.has(platform)) {
    throw new Error(`Unsupported HMR runtime platform: ${platform}`)
  }
  await runTest('hmr-runtime.mjs', ['--platform', platform, ...args])
}
else {
  throw new Error(`Unknown template test: ${testName}`)
}

function runTest(file, testArgs) {
  return run(process.execPath, [path.join(testRoot, file), ...testArgs])
}

function packageManagerCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: templateRoot,
      stdio: 'inherit',
    })
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
