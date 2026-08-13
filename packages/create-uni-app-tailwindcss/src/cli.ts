#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import prompts from 'prompts'

const templateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'template')
const options = parseArgs(process.argv.slice(2))
const targetArg = options.target
const targetDir = path.resolve(process.cwd(), targetArg ?? 'uni-app-tailwindcss-app')
const projectName = path.basename(targetDir)

async function main() {
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
  await copyTemplate(templateRoot, targetDir)
  await renamePackage(targetDir, projectName)

  console.log(`Created ${projectName}`)
  console.log(`cd ${projectName}`)
  console.log(`${packageManager} install`)
  console.log(`${packageManager} dev:h5`)
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
    if (!arg.startsWith('-') && !target) {
      target = arg
    }
  }

  return { packageManager, target }
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
