#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  compareContracts,
  supportedSources,
  validateLifecycleSummary,
} from '../packages/create-uni-app-tailwindcss/scripts/daily-contract.mjs'

const root = path.resolve(process.argv[2] ?? '')
const expectedNodes = (process.env.DAILY_NODE_VERSIONS ?? '22,24').split(',')
if (!process.argv[2]) throw new Error('Usage: validate-daily-contracts.mjs <artifact-directory>')

const files = await findFiles(root)
const summaryFiles = files.filter(file => path.basename(file) === 'summary.json')
const entries = []
const failures = []

for (const file of summaryFiles) {
  const summary = JSON.parse(await fs.readFile(file, 'utf8'))
  if (!supportedSources.includes(summary.source)) continue
  const node = String(summary.node ?? '').replace(/^v/, '').split('.')[0]
  const key = `${summary.source}/node-${node}`
  entries.push({ file, key, node, source: summary.source, summary })
  for (const failure of validateLifecycleSummary(summary)) failures.push(`${key}: ${failure}`)
}

for (const node of expectedNodes) {
  for (const source of supportedSources) {
    const key = `${source}/node-${node}`
    if (!entries.some(entry => entry.key === key)) failures.push(`${key}: lifecycle summary is missing`)
  }
  const pair = entries.filter(entry => entry.node === node)
  if (pair.length === supportedSources.length) {
    const contracts = await Promise.all(supportedSources.map(async (source) => {
      const entry = pair.find(candidate => candidate.source === source)
      return JSON.parse(await fs.readFile(path.join(path.dirname(entry.file), 'contract.json'), 'utf8'))
    }))
    const comparison = compareContracts(contracts[0], contracts[1])
    if (!comparison.matches) failures.push(`node-${node}: candidate and npm latest contracts differ (${comparison.candidate} != ${comparison.latest})`)
  }
}

const lines = [
  '# Daily user journey contract',
  '',
  `Lifecycle combinations: **${entries.length}/${supportedSources.length * expectedNodes.length}**`,
  `Result: **${failures.length === 0 ? 'PASS' : 'FAIL'}**`,
  '',
  '| Source / Node | Status | Coverage |',
  '| --- | --- | --- |',
  ...entries.sort((left, right) => left.key.localeCompare(right.key)).map(({ key, summary }) =>
    `| ${key} | ${summary.status} | ${summary.coverage.executed}/${summary.coverage.required} (${summary.coverage.percent}%) |`),
  '',
]
if (failures.length > 0) lines.push('## Failures', '', ...failures.map(failure => `- ${failure}`), '')
const markdown = `${lines.join('\n')}\n`
await fs.writeFile(path.join(root, 'daily-contract-summary.md'), markdown)
process.stdout.write(markdown)
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
if (failures.length > 0) process.exitCode = 1

async function findFiles(directory) {
  const found = []
  const stack = [directory]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(absolute)
      else found.push(absolute)
    }
  }
  return found
}
