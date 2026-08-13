import { cp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../packages/template/dist/build/h5/', import.meta.url))
const destination = fileURLToPath(new URL('../dist/build/h5/', import.meta.url))

await rm(destination, { force: true, recursive: true })
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })

console.log(`Synced H5 output to ${destination}`)
