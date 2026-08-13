import { loadTemplateRegistry } from './template-registry.mjs'

const registry = await loadTemplateRegistry()
const build = registry.templates.flatMap(template => template.targets.map(target => ({
  isDefault: template.id === registry.defaultTemplate,
  script: `build:${target}`,
  target,
  template: template.id,
})))
const hmr = registry.templates.flatMap(template => (template.hmrTargets ?? []).map(target => ({
  isDefault: template.id === registry.defaultTemplate,
  script: `test:hmr:${target}`,
  target,
  template: template.id,
})))

console.log(JSON.stringify({ build, hmr }))
