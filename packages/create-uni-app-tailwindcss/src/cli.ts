#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import prompts from 'prompts'

const templatesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'templates')
const options = parseArgs(process.argv.slice(2))
const targetArg = options.target
const targetDir = path.resolve(process.cwd(), targetArg ?? 'uni-app-tailwindcss-app')
const projectName = path.basename(targetDir)

async function main() {
  const registry = await loadTemplateRegistry()
  const template = await resolveTemplate(registry, options.template)
  const packageManager = await resolvePackageManager(options.packageManager)
  if (await exists(targetDir)) {
    const result = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: `Directory ${projectName} exists. Overwrite it?`,
      initial: false,
    })
    if (!result.overwrite) return
    await rm(targetDir, { recursive: true, force: true })
  }

  await mkdir(targetDir, { recursive: true })
  await copyTemplate(path.join(templatesRoot, template.id), targetDir)
  await renamePackage(targetDir, projectName)

  console.log(`Created ${projectName}`)
  console.log(`Template: ${template.id}`)
  console.log(`cd ${projectName}`)
  console.log(`${packageManager} install`)
  console.log(`${packageManager} dev:h5`)
}

type Template = {
  id: string
  name: string
  description: string
}

type TemplateRegistry = {
  defaultTemplate: string
  templates: Template[]
  version: number
}

async function loadTemplateRegistry(): Promise<TemplateRegistry> {
  return JSON.parse(await readFile(path.join(templatesRoot, 'registry.json'), 'utf8'))
}

async function copyTemplate(source: string, target: string) {
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const targetName = entry.name === '_npmrc' ? '.npmrc' : entry.name
    const targetPath = path.join(target, targetName)
    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true })
      await copyTemplate(sourcePath, targetPath)
      continue
    }
    await cp(sourcePath, targetPath)
  }
}

async function renamePackage(targetDir: string, name: string) {
  const pkgPath = path.join(targetDir, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  pkg.name = name
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

async function exists(filePath: string) {
  try {
    await readdir(filePath)
    return true
  }
  catch {
    return false
  }
}

function parseArgs(args: string[]) {
  let packageManager: string | undefined
  let template: string | undefined
  let target: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') {
      continue
    }
    if (arg === '--pm' || arg === '--package-manager') {
      packageManager = args[index + 1]
      index += 1
      continue
    }
    if (arg.startsWith('--pm=')) {
      packageManager = arg.slice('--pm='.length)
      continue
    }
    if (arg.startsWith('--package-manager=')) {
      packageManager = arg.slice('--package-manager='.length)
      continue
    }
    if (arg === '--template') {
      template = args[index + 1]
      index += 1
      continue
    }
    if (arg.startsWith('--template=')) {
      template = arg.slice('--template='.length)
      continue
    }
    if (!arg.startsWith('-') && !target) {
      target = arg
    }
  }

  return { packageManager, target, template }
}

async function resolveTemplate(registry: TemplateRegistry, templateId?: string) {
  if (templateId) {
    const template = registry.templates.find(item => item.id === templateId)
    if (!template) {
      throw new Error(`Unknown template "${templateId}". Available templates: ${registry.templates.map(item => item.id).join(', ')}`)
    }
    return template
  }

  if (!process.stdin.isTTY || registry.templates.length === 1) {
    return registry.templates.find(item => item.id === registry.defaultTemplate) ?? registry.templates[0]
  }

  const response = await prompts({
    type: 'select',
    name: 'template',
    message: 'Template',
    choices: registry.templates.map(template => ({
      description: template.description,
      title: template.name,
      value: template.id,
    })),
    initial: Math.max(0, registry.templates.findIndex(item => item.id === registry.defaultTemplate)),
  })

  return registry.templates.find(item => item.id === response.template)
    ?? registry.templates.find(item => item.id === registry.defaultTemplate)
    ?? registry.templates[0]
}

async function resolvePackageManager(packageManager?: string) {
  const managers = ['pnpm', 'npm', 'yarn', 'bun']
  if (packageManager && managers.includes(packageManager)) {
    return packageManager
  }
  if (!process.stdin.isTTY) {
    return 'pnpm'
  }

  const response = await prompts({
    type: 'select',
    name: 'packageManager',
    message: 'Package manager',
    choices: managers.map(manager => ({ title: manager, value: manager })),
    initial: 0,
  })

  return response.packageManager ?? 'pnpm'
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
