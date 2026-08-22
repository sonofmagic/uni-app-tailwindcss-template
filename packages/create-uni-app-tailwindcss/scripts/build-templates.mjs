import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTemplateRegistry, resolveTemplateSource } from '../../../scripts/template-registry.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const outputRoot = path.join(packageRoot, 'dist', 'templates')
const temporaryRoot = await mkdtemp(path.join(packageRoot, 'dist', '.templates-'))
const registry = await loadTemplateRegistry()
const excludedSegments = new Set([
  '.hmr-artifacts',
  'dist',
  'node_modules',
  'pnpm-lock.yaml',
  'playwright-report',
  'test-results',
])
const repositoryOnlyDependencies = new Set([
  '@dcloudio/uni-automator',
  '@playwright/test',
  'playwright',
  'pngjs',
])

try {
  for (const template of registry.templates) {
    const sourceRoot = resolveTemplateSource(template)
    await cp(sourceRoot, path.join(temporaryRoot, template.id), {
      filter: source => {
        const segments = path.relative(sourceRoot, source).split(path.sep)
        return segments.every(segment => !excludedSegments.has(segment))
      },
      recursive: true,
    })
    const bundledRoot = path.join(temporaryRoot, template.id)
    await sanitizePackage(path.join(bundledRoot, 'package.json'))
    await rename(path.join(bundledRoot, '.npmrc'), path.join(bundledRoot, '_npmrc'))
  }

  const bundledRegistry = {
    defaultTemplate: registry.defaultTemplate,
    templates: registry.templates.map(({ source: _source, ...template }) => template),
    version: registry.version,
  }
  await writeFile(path.join(temporaryRoot, 'registry.json'), `${JSON.stringify(bundledRegistry, null, 2)}\n`)

  await rm(outputRoot, { force: true, recursive: true })
  await rename(temporaryRoot, outputRoot)
}

catch (error) {
  await rm(temporaryRoot, { force: true, recursive: true })
  throw error
}
finally {
  await rm(temporaryRoot, { force: true, recursive: true })
}

async function sanitizePackage(packagePath) {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const dependency of repositoryOnlyDependencies) {
      delete pkg[section]?.[dependency]
    }
  }
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
}
