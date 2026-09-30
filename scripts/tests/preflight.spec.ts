import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  aggregateStatus,
  checkAndroidDevice,
  checkHBuilderX,
  checkIosSimulator,
  checkNodeAndPnpm,
  checkWechat,
  checkVersion,
  createDefaultExecutor,
  expandTargets,
  normalizeTargets,
  runPreflight,
  selectAndroidDevice,
  selectIosSimulator,
  writePreflightReport,
} from '../preflight-core.mjs'

const registry = {
  defaultTemplate: 'default',
  templates: [{
    id: 'default',
    source: 'packages/template',
    targets: ['h5', 'app', 'mp-weixin', 'mp-alipay', 'mp-toutiao'],
  }],
}

function selectedId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  const selected = candidate.device ?? candidate.simulator ?? candidate.selection ?? value
  if (typeof selected === 'string') return selected
  if (selected && typeof selected === 'object') {
    const item = selected as Record<string, unknown>
    return (item.udid ?? item.id ?? item.serial) as string | undefined
  }
  return undefined
}

describe('preflight target normalization', () => {
  it('expands the registered matrix and splits App into Android and iOS lanes', () => {
    const normalized = normalizeTargets(registry)
    expect(normalized.map(target => target.target)).toEqual([
      'h5',
      'app-android',
      'app-ios',
      'mp-weixin',
      'mp-alipay',
      'mp-toutiao',
    ])
    expect(normalizeTargets(registry, 'app,mp-weixin').map(target => target.target)).toEqual([
      'app-android', 'app-ios', 'mp-weixin',
    ])

    const expanded = expandTargets(registry)
    const ids = expanded.map((target: unknown) => typeof target === 'string' ? target : (target as Record<string, unknown>).target ?? (target as Record<string, unknown>).id)
    expect(ids).toEqual(expect.arrayContaining([
      'h5', 'app-android', 'app-ios', 'mp-weixin', 'mp-alipay', 'mp-toutiao',
    ]))
  })

  it('rejects unknown target names instead of silently dropping them', () => {
    expect(() => normalizeTargets(registry, 'h5,unknown-platform')).toThrow(/unknown|unsupported|target/i)
  })
})

describe('preflight status and version helpers', () => {
  it('provides the injectable executor surface used by checks and tests', () => {
    const executor = createDefaultExecutor({ cwd: '/tmp' })
    expect(executor).toMatchObject({
      cwd: '/tmp',
      run: expect.any(Function),
      commandExists: expect.any(Function),
      exists: expect.any(Function),
      readFile: expect.any(Function),
      stat: expect.any(Function),
    })
  })

  it('keeps FAIL over BLOCKED over PASS', () => {
    expect(aggregateStatus(['PASS', 'PASS'])).toBe('PASS')
    expect(aggregateStatus(['PASS', 'BLOCKED'])).toBe('BLOCKED')
    expect(aggregateStatus(['BLOCKED', 'FAIL'])).toBe('FAIL')
    expect(aggregateStatus([])).toBe('FAIL')
  })

  it('checks Node and tool versions against a minimum or exact range', () => {
    expect(checkVersion('22.5.0', '>=22')).toBe(true)
    expect(checkVersion('21.9.0', '>=22')).toBe(false)
    expect(checkVersion('5.0.1', '5.0.1')).toBe(true)
    expect(checkVersion('5.0.2', '5.0.1')).toBe(false)
    expect(checkVersion('not-a-version', '>=22')).toBe(false)
  })

  it.each([
    ['22.17.0', 'FAIL'], ['22.18.0', 'PASS'], ['22.19.0', 'PASS'],
    ['23.11.0', 'FAIL'], ['24.10.0', 'FAIL'], ['24.11.0', 'PASS'],
    ['26.0.0', 'PASS'], ['24.11.0-rc.1', 'FAIL'],
  ])('checks the declared Node engine range for %s', async (nodeVersion, status) => {
    const pkg = JSON.parse(await readFile(new URL('../../packages/template/package.json', import.meta.url), 'utf8'))
    const checks = await checkNodeAndPnpm({
      nodeVersion,
      nodeRequirement: pkg.engines.node,
      packageManager: pkg.packageManager,
      executor: { async run() { return { code: 0, output: `${pkg.packageManager.split('@')[1]}\n` } } },
    })
    expect(checks[0].status).toBe(status)
    expect(checks[0].evidence.required).toBe(pkg.engines.node)
    expect(checks[1].status).toBe('PASS')
  })
})

describe('preflight device selection', () => {
  it('requires exactly one online Android device unless a requested serial is supplied', () => {
    const devices = [
      { id: 'emulator-5554', state: 'device', model: 'Pixel_8' },
      { id: 'offline-device', state: 'offline', model: 'Pixel_7' },
    ]
    expect(selectedId(selectAndroidDevice(devices))).toBe('emulator-5554')
    expect(selectedId(selectAndroidDevice([
      ...devices,
      { id: 'second', state: 'device', model: 'Pixel_6' },
    ]))).toBeUndefined()
    expect(selectedId(selectAndroidDevice(devices, 'missing'))).toBeUndefined()
    expect(selectedId(selectAndroidDevice(devices, 'emulator-5554'))).toBe('emulator-5554')
  })

  it('honours a configured iOS simulator and otherwise chooses the most recently booted one', () => {
    const devices = [
      { udid: 'old', name: 'iPhone 14', state: 'Shutdown', isAvailable: true, lastBootedAt: '2026-09-20T00:00:00Z' },
      { udid: 'recent', name: 'iPhone 16', state: 'Booted', isAvailable: true, lastBootedAt: '2026-09-22T00:00:00Z' },
    ]
    expect(selectedId(selectIosSimulator(devices, 'old'))).toBe('old')
    expect(selectedId(selectIosSimulator(devices))).toBe('recent')
    expect(selectedId(selectIosSimulator(devices, 'missing'))).toBeUndefined()
  })
})

describe('preflight runtime checks', () => {
  it('checks HBuilderX against the compilerVersion in vite-plugin-uni', async () => {
    const previous = process.env.HBUILDERX_CLI_PATH
    process.env.HBUILDERX_CLI_PATH = '/opt/HBuilderX/cli'
    try {
      const check = await checkHBuilderX({
        source: '/tmp/uni-template',
        executor: {
          async readFile() {
            return JSON.stringify({ 'uni-app': { compilerVersion: '4.29.2026090101' } })
          },
          async exists() { return true },
          async run() { return { code: 0, output: '4.29.2026090101\n' } },
        },
      })
      expect(check.status).toBe('PASS')
      expect(check.evidence.compilerVersion).toBe('4.29.2026090101')
    }
    finally {
      if (previous === undefined) delete process.env.HBUILDERX_CLI_PATH
      else process.env.HBUILDERX_CLI_PATH = previous
    }
  })

  it('blocks Android when zero or multiple devices are online', async () => {
    const one = await checkAndroidDevice({
      executor: {
        async run() { return { code: 0, output: 'List of devices attached\nemulator-5554\tdevice model:Pixel_8\n' } },
      },
    })
    expect(one.status).toBe('PASS')
    const many = await checkAndroidDevice({
      executor: {
        async run() { return { code: 0, output: 'List of devices attached\none\tdevice\ntwo\tdevice\n' } },
      },
    })
    expect(many.status).toBe('BLOCKED')
    expect(many.id).toBe('android.device.online')
  })

  it('selects an available iOS simulator and reports an invalid configured UDID as BLOCKED', async () => {
    const output = JSON.stringify({ devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
        { udid: 'ios-18', name: 'iPhone 16', state: 'Booted', isAvailable: true, lastBootedAt: '2026-09-22T00:00:00Z' },
      ],
    } })
    const executor = { async run() { return { code: 0, output } } }
    expect((await checkIosSimulator({ executor })).status).toBe('PASS')
    expect((await checkIosSimulator({ executor, configuredId: 'missing' })).status).toBe('BLOCKED')
  })

  it('requires a logged-in WeChat DevTools service', async () => {
    const checks = await checkWechat({
      source: '/tmp/uni-template',
      executor: {
        async run(_command: string, args: string[]) {
          return args.includes('islogin')
            ? { code: 0, output: '{"login":true}' }
            : { code: 0, output: 'WeChat DevTools 1.0.0' }
        },
      },
    })
    expect(checks.map(check => check.status)).toEqual(['PASS', 'PASS'])
    expect(checks.map(check => check.id)).toEqual(['wechat.devtools.cli', 'wechat.login'])
  })
})

describe('preflight reports', () => {
  it('returns machine-readable check evidence for each selected target', async () => {
    const root = path.resolve('/tmp/preflight-test')
    const reportDir = path.join(root, 'report')
    const testRegistry = {
      defaultTemplate: 'default',
      templates: [{ id: 'default', source: root, targets: ['h5'] }],
    }
    const result = await runPreflight({
      repoRoot: root,
      repo: root,
      registry: testRegistry,
      executor: {
        async run(command: string, args: string[]) {
          if (command === 'pnpm' && args.length === 1 && args[0] === '--version') {
            return { code: 0, output: '12.8.1\n' }
          }
          return { code: 0, output: 'Chrome Headless 140.0.0\n' }
        },
        async exists() { return true },
        async readFile(filePath: string) {
          return filePath.endsWith('package.json')
            ? JSON.stringify({ packageManager: 'pnpm@12.8.1', engines: { node: '^22.18.0 || >=24.11.0' } })
            : '{}'
        },
      },
      // The report contract is independent of whether an optional runtime is
      // available on the host running this unit test.
      runBuild: false,
    })

    expect(result).toMatchObject({ status: expect.stringMatching(/^(PASS|BLOCKED|FAIL)$/) })
    expect(result.checks.length).toBeGreaterThan(0)
    expect(result.checks.find(check => check.id === 'runtime.node.version')?.evidence.required).toBe('^22.18.0 || >=24.11.0')
    expect(result.checks.every(check => check.id && check.target && check.phase && check.status)).toBe(true)
    expect(result.targetResults).toHaveLength(1)
    expect(result.targetResults[0].target).toBe('h5')

    const report = await writePreflightReport(result, reportDir)
    const summary = JSON.parse(await readFile(report.summaryPath, 'utf8')) as typeof result & { summaryPath: string }
    expect(summary.status).toBe(result.status)
    expect(summary.checks.every(check => check.id && check.target && check.phase && check.status)).toBe(true)
    expect((await readFile(report.markdownPath, 'utf8'))).toMatch(/多端测试预检报告|Overall/)
  })
})
