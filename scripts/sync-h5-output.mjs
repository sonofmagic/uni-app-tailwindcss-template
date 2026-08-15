import { cp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import { getTemplate, loadTemplateRegistry, resolveTemplateSource } from './template-registry.mjs'

const registry = await loadTemplateRegistry()
const template = getTemplate(registry, process.argv[2])
const source = path.join(resolveTemplateSource(template), 'dist', 'build', 'h5')
const destination = fileURLToPath(new URL('../dist/build/h5/', import.meta.url))

await rm(destination, { force: true, recursive: true })
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })

console.log(`Synced H5 output to ${destination}`)
