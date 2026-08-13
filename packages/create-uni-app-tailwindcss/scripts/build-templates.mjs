import { cp, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTemplateRegistry, resolveTemplateSource } from '../../../scripts/template-registry.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const outputRoot = path.join(packageRoot, 'dist', 'templates')
const temporaryRoot = await mkdtemp(path.join(packageRoot, 'dist', '.templates-'))
const registry = await loadTemplateRegistry()

try {
  for (const template of registry.templates) {
    const sourceRoot = resolveTemplateSource(template)
    await cp(sourceRoot, path.join(temporaryRoot, template.id), {
      filter: source => {
        const segments = path.relative(sourceRoot, source).split(path.sep)
        return !segments.includes('node_modules') && !segments.includes('dist')
      },
      recursive: true,
    })
    await rename(
      path.join(temporaryRoot, template.id, '.npmrc'),
      path.join(temporaryRoot, template.id, '_npmrc'),
    )
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
