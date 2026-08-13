import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../', import.meta.url))
export const registryPath = path.join(repoRoot, 'templates.json')

export async function loadTemplateRegistry() {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))

  if (registry.version !== 1 || !Array.isArray(registry.templates) || registry.templates.length === 0) {
    throw new Error('templates.json must contain a non-empty version 1 template registry')
  }

  const ids = new Set()
  for (const template of registry.templates) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(template.id)) {
      throw new Error(`Invalid template id: ${template.id}`)
    }
    if (ids.has(template.id)) {
      throw new Error(`Duplicate template id: ${template.id}`)
    }
    ids.add(template.id)

    if (!template.name || !template.description || !Array.isArray(template.targets) || template.targets.length === 0) {
      throw new Error(`Template ${template.id} is missing required metadata`)
    }

    if (!Array.isArray(template.hmrTargets) || !Array.isArray(template.smokeText)) {
      throw new Error(`Template ${template.id} must declare hmrTargets and smokeText arrays`)
    }

    const source = resolveTemplateSource(template)
    const packagePath = path.join(source, 'package.json')
    await access(packagePath)
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
    const requiredScripts = [
      ...template.targets.map(target => `build:${target}`),
      ...template.hmrTargets.map(target => `test:hmr:${target}`),
    ]
    for (const script of requiredScripts) {
      if (!pkg.scripts?.[script]) {
        throw new Error(`Template ${template.id} does not define script ${script}`)
      }
    }
  }

  if (!ids.has(registry.defaultTemplate)) {
    throw new Error(`Default template does not exist: ${registry.defaultTemplate}`)
  }

  return registry
}

export function resolveTemplateSource(template) {
  const source = path.resolve(repoRoot, template.source)
  const relative = path.relative(repoRoot, source)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Template source must stay inside the repository: ${template.source}`)
  }
  return source
}

export function getTemplate(registry, id = registry.defaultTemplate) {
  const template = registry.templates.find(item => item.id === id)
  if (!template) {
    throw new Error(`Unknown template "${id}". Available templates: ${registry.templates.map(item => item.id).join(', ')}`)
  }
  return template
}
