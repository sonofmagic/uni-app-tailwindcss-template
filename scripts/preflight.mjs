#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadTemplateRegistry, repoRoot } from './template-registry.mjs'
import {
  createDefaultExecutor,
  prepareHBuilderX,
  expandTargets,
  runPreflight,
  selectIosSimulator,
  writePreflightReport,
} from './preflight-core.mjs'

const args = parseArgs(process.argv.slice(2))
const reportDir = path.resolve(args['report-dir'] ?? path.join(repoRoot, 'packages/template/.hmr-artifacts/preflight'))

try {
  const registry = await loadTemplateRegistry()
  const executor = createDefaultExecutor({ cwd: repoRoot })
  const cleanup = args.prepare ? await prepareEnvironment(registry, args.target, executor) : async () => {}
  let report
  try {
    const summary = await runPreflight({
      repo: repoRoot,
      registry,
      selection: args.target,
      prepare: Boolean(args.prepare),
      runBuild: !Boolean(args['skip-build']),
      executor,
    })
    report = await writePreflightReport(summary, reportDir)
    await writeTargetEvidence(report, reportDir)
    printSummary(report)
    process.exitCode = report.status === 'FAIL' ? 1 : report.status === 'BLOCKED' ? 2 : 0
  }
  finally {
    await cleanup()
  }
}
catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  await mkdir(reportDir, { recursive: true })
  const report = {
    status: 'FAIL',
    generatedAt: new Date().toISOString(),
    error: message,
    checks: [{ id: 'preflight.runner', target: 'repository', phase: 'baseline', status: 'FAIL', message, repairCommand: 'Review the command output and rerun pnpm test:preflight', evidence: {} }],
    targets: [],
    targetResults: [],
  }
  await writeFile(path.join(reportDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(path.join(reportDir, 'summary.md'), `# 多端测试预检报告\n\nOverall: **FAIL**\n\n- ${message}\n`, 'utf8')
  console.error(`[preflight] FAIL - ${message}`)
  process.exitCode = 1
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const separator = key.indexOf('=')
    if (separator !== -1) {
      parsed[key.slice(0, separator)] = key.slice(separator + 1)
    }
    else if (values[index + 1] && !values[index + 1].startsWith('--')) {
      parsed[key] = values[++index]
    }
    else {
      parsed[key] = true
    }
  }
  return parsed
}

async function writeTargetEvidence(summary, outputDir) {
  await Promise.all((summary.targetResults ?? []).map(async (target) => {
    const lines = []
    for (const check of target.checks ?? []) {
      lines.push(`[${check.status}] ${check.id}: ${check.message}`)
      if (check.evidence?.output) lines.push(check.evidence.output)
    }
    const filename = `target-${target.target}.log`
    await writeFile(path.join(outputDir, filename), `${lines.join('\n')}\n`, 'utf8')
  }))
}

function printSummary(summary) {
  console.log(`\n[preflight] Overall: ${summary.status}`)
  for (const target of summary.targetResults ?? []) {
    console.log(`[preflight] ${target.target}: ${target.status}`)
  }
  console.log(`[preflight] Report: ${summary.summaryPath}`)
}

async function prepareEnvironment(registry, selection, executor) {
  const targets = expandTargets(registry, selection)
  const shouldPrepareIos = targets.some(target => target.target === 'app-ios')
  const shouldPrepareApp = targets.some(target => target.target === 'app-android' || target.target === 'app-ios')
  const ownedSimulators = []
  const ownedApplications = []
  if (shouldPrepareIos && process.platform === 'darwin') {
    const listed = await executor.run('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])
    if (listed.code === 0) {
      try {
        const devices = Object.entries(JSON.parse(listed.output).devices ?? {})
          .flatMap(([runtime, entries]) => entries.map(device => ({ ...device, runtime })))
          .filter(device => device.runtime.includes('iOS-') || device.runtime.includes('iOS.'))
        const selected = selectIosSimulator(devices, process.env.DAILY_IOS_DEVICE_ID)
        if (selected && selected.state !== 'Booted') {
          const boot = await executor.run('xcrun', ['simctl', 'boot', selected.udid])
          if (boot.code === 0 || /already booted|current state: Booted/i.test(boot.output ?? '')) {
            if (boot.code === 0) ownedSimulators.push(selected.udid)
            await executor.run('xcrun', ['simctl', 'bootstatus', selected.udid, '-b'])
          }
        }
      }
      catch (error) {
        console.warn(`[preflight] --prepare could not prepare iOS Simulator: ${error.message}`)
      }
    }
  }
  if (shouldPrepareApp && process.platform === 'darwin') {
    const sources = [...new Set(targets.filter(target => target.target.startsWith('app-')).map(target => target.source))]
    for (const source of sources) {
      await prepareHBuilderX({ source, executor, onStarted: ({ appPath }) => {
        ownedApplications.push(path.basename(appPath, '.app'))
      } })
    }
  }
  return async () => {
    for (const udid of ownedSimulators.reverse()) {
      await executor.run('xcrun', ['simctl', 'shutdown', udid])
    }
    for (const application of ownedApplications.reverse()) {
      await executor.run('osascript', ['-e', `tell application "${application}" to quit`])
    }
  }
}
