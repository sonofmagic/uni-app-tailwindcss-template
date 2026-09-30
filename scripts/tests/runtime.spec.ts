import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCommand } from '../runtime-process.mjs'
import { ExternalBlockError, checkGitHubRun, runRuntimeLane, runtimeStatus, statusExitCode } from '../runtime-contract.mjs'
import { checkHBuilderX, matchesHBuilderX, prepareHBuilderX, runPreflight, checkNodeAndPnpm } from '../preflight-core.mjs'
import { connectWechatRuntime } from '../runtime-wechat.mjs'

describe('external commands', () => {
  it('captures output, exit status and spawn failures', async () => {
    const result = await runCommand(process.execPath, ['-e', 'console.log("out"); console.error("err"); process.exitCode = 3'])
    expect(result).toMatchObject({ code: 3, stdout: 'out\n', stderr: 'err\n', timedOut: false })
    const missing = await runCommand('/not-a-command', [], { timeoutMs: 1000 })
    expect(missing.code).toBe(1)
    expect(missing.output).toContain('ENOENT')
  })

  it('kills a timed-out command and its resistant child, retaining diagnostics', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'runtime-timeout-'))
    const marker = path.join(dir, 'heartbeat')
    try {
      const child = `const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'.'),20)`
      const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'});process.on('SIGTERM',()=>{});console.log('started');setInterval(()=>{},1000)`
      const result = await runCommand(process.execPath, ['-e', parent], { timeoutMs: 800, killGraceMs: 100 })
      expect(result).toMatchObject({ code: 124, timedOut: true })
      expect(result.output).toContain('started')
      expect(result.output).toContain('timed out')
      const before = await readFile(marker, 'utf8')
      await wait(150)
      expect(await readFile(marker, 'utf8')).toBe(before)
    }
    finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('supports cancellation without waiting for the command timeout', async () => {
    const controller = new AbortController()
    const result = await runCommand(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], {
      signal: controller.signal, timeoutMs: 5000,
      onData: () => controller.abort(),
    })
    expect(result).toMatchObject({ code: 130, aborted: true, timedOut: false })
  })
})

describe('runtime lanes and cleanup', () => {
  it('continues after a blocked or failed platform and always cleans up', async () => {
    const cleaned: string[] = []
    const results = []
    for (const platform of ['wechat', 'android', 'h5']) {
      results.push(await runRuntimeLane(platform, async () => {
        if (platform === 'wechat') throw new ExternalBlockError('login unavailable')
        if (platform === 'android') throw new Error('wrong pixels')
        return { screenshot: 'h5.png' }
      }, async () => { cleaned.push(platform) }))
    }
    expect(results.map(result => result.status)).toEqual(['BLOCKED', 'FAIL', 'PASS'])
    expect(cleaned).toEqual(['wechat', 'android', 'h5'])
    expect(statusExitCode(runtimeStatus(results))).toBe(1)
    expect(statusExitCode(runtimeStatus([results[0], results[2]]))).toBe(2)
    expect(runtimeStatus([results[2]], 2)).toBe('FAIL')
    expect(runtimeStatus([{ status: 'SKIP' }])).toBe('FAIL')
  })

  it('does not report PASS after failed cleanup', async () => {
    const result = await runRuntimeLane('h5', async () => ({}), async () => { throw new Error('restore failed') })
    expect(result.status).toBe('FAIL')
    expect(result.error).toContain('restore failed')
  })

  it.each(['success', 'failure', 'interruption'])('restores fixture source after %s', async (mode) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'runtime-fixture-'))
    const source = '{"pages":[{"path":"pages/index/index"}]}\n'
    const moduleUrl = new URL('../template-tests/hmr-fixture.mjs', import.meta.url).href
    try {
      await mkdir(path.join(dir, 'src'), { recursive: true })
      await writeFile(path.join(dir, 'src/pages.json'), source)
      await writeFile(path.join(dir, 'src/tailwind.css'), '@import "tailwindcss";\n')
      const code = `const {createFixtureController}=await import(${JSON.stringify(moduleUrl)});const f=await createFixtureController();try{await f.apply('initial');${mode === 'interruption' ? "process.kill(process.pid,'SIGKILL')" : mode === 'failure' ? "throw new Error('fixture assertion')" : ''}}finally{await f.restore()}`
      await runCommand(process.execPath, ['--input-type=module', '-e', code], { cwd: dir })
      await expect.poll(() => readFile(path.join(dir, 'src/pages.json'), 'utf8'), { timeout: 5000 }).toBe(source)
      await expect(readFile(path.join(dir, 'src/pages/__daily_hmr__/index.vue'))).rejects.toThrow()
      await expect(readFile(path.join(dir, '.hmr-artifacts/.fixture-backup.json'))).rejects.toThrow()
    }
    finally { await rm(dir, { recursive: true, force: true }) }
  })
})

describe('HBuilderX identity', () => {
  it.each([
    ['5.26.2026091802', '3.0.0-5020620260917001', true],
    ['5.26.2026091402-alpha', '3.0.0-5020620260917001', false],
    ['5.26.2026091402-alpha', '3.0.0-alpha-5020620260917001', true],
    ['5.27.2026100101', '3.0.0-5020620260917001', false],
  ])('matches version and channel: %s', (version, compiler, expected) => {
    expect(matchesHBuilderX(version, '5.26', compiler)).toBe(expected)
  })

  it.each([true, false])('preserves existing IDE sessions and tracks only owned starts: conflict=%s', async (conflict) => {
    const opened: string[] = []
    const owned: string[] = []
    const check = await prepareHBuilderX({
      source: '/template', onStarted: selected => owned.push(selected.appPath),
      executor: {
        async exists() { return true },
        async readFile() { return JSON.stringify({ version: '3.0.0-5020620260917001', 'uni-app': { compilerVersion: '5.26' } }) },
        async run(command: string, args: string[]) {
          if (command === 'pgrep') return { code: args[1].includes('[^/]') && conflict ? 0 : 1, output: '' }
          if (command === 'open') opened.push(args[1])
          return { code: 0, output: args.join(' ').includes('Alpha') ? '5.26.2026091402-alpha' : '5.26.2026091802' }
        },
      },
    })
    expect(check.status).toBe(conflict ? 'BLOCKED' : 'PASS')
    expect(opened).toEqual(conflict ? [] : ['/Applications/HBuilderX.app'])
    expect(owned).toEqual(opened)
  })

  it('blocks a successful CLI command redirected to a different running IDE', async () => {
    const result = await checkHBuilderX({
      source: '/template', cliPath: '/Applications/HBuilderX.app/Contents/MacOS/cli',
      executor: {
        async readFile() { return JSON.stringify({ version: '3.0.0-5020620260917001', 'uni-app': { compilerVersion: '5.26' } }) },
        async exists() { return true },
        async run(command: string) {
          return { code: 0, output: command === 'defaults' ? '5.26.2026091802' : '当前运行的cli与正在运行的HBuilderX不匹配，请尝试/Applications/HBuilderX-Alpha.app/Contents/MacOS下的cli' }
        },
      },
    })
    expect(result.status).toBe('BLOCKED')
    expect(result.evidence.selected.version).toBe('5.26.2026091802')
  })
})

describe('standalone package managers', () => {
  it('checks pnpm inside the generated project, not the repository', async () => {
    const checks = await checkNodeAndPnpm({
      packageManager: 'pnpm@12.4.1', cwd: '/generated/latest',
      executor: { async run(_command: string, _args: string[], options: { cwd?: string }) {
        return { code: 0, output: options.cwd === '/generated/latest' ? '12.4.1' : '12.8.1' }
      } },
    })
    expect(checks.find(check => check.id === 'runtime.pnpm.version').status).toBe('PASS')
  })
})

describe('preflight device selection', () => {
  it('continues independent builds after one target fails', async () => {
    const builds: string[] = []
    const result = await runPreflight({
      repo: '/repo', registry: { defaultTemplate: 'default', templates: [{ id: 'default', source: '/template', targets: ['mp-alipay', 'mp-toutiao'] }] },
      executor: {
        async exists(file: string) { return !file.endsWith('.file-event-bridge') },
        async readFile(file: string) { return file.endsWith('package.json') ? '{"packageManager":"pnpm@12.8.1"}' : '{}' },
        async run(command: string, args: string[]) {
          const build = args.find(arg => arg.startsWith('build:'))
          if (build) builds.push(build)
          return { code: build === 'build:mp-alipay' ? 1 : 0, output: '12.8.1' }
        },
      },
    })
    expect(builds).toEqual(['build:mp-alipay', 'build:mp-toutiao'])
    expect(result.targetResults.map(target => target.status)).toEqual(['FAIL', 'BLOCKED'])
  })

  it('passes the configured iOS device through the complete preflight pipeline', async () => {
    const result = await runPreflight({
      repo: '/repo', registry: { defaultTemplate: 'default', templates: [{ id: 'default', source: '/template', targets: ['app'] }] },
      selection: 'app-ios', runBuild: false, environment: { DAILY_IOS_DEVICE_ID: 'chosen' },
      executor: {
        async exists(file: string) { return !file.endsWith('.file-event-bridge') },
        async readFile(file: string) { return file.endsWith('package.json') ? JSON.stringify({ version: '3.0.0-5020620260917001', 'uni-app': { compilerVersion: '5.26' }, packageManager: 'pnpm@12.8.1' }) : '{}' },
        async run(command: string, args: string[]) {
          if (command === 'xcrun') return { code: 0, output: JSON.stringify({ devices: { 'SimRuntime.iOS-26': ['chosen', 'other'].map(udid => ({ udid, name: udid, state: 'Booted', isAvailable: true })) } }) }
          return { code: 0, output: command === 'pnpm' && args[0] === '--version' ? '12.8.1' : '5.26.2026091802' }
        },
      },
    })
    const selected = result.checks.find(check => check.id === 'ios.simulator.available')
    expect(selected.status).toBe('PASS')
    expect(selected.evidence.selected.udid).toBe('chosen')
  })
})

describe('WeChat sessions', () => {
  it('launches through weapp-ide-cli with the compiled project and reuses open sessions', async () => {
    const seen: unknown[] = []
    const program = { reLaunch() {} }
    const result = await connectWechatRuntime({ async launchAutomator(options: unknown) { seen.push(options); return program } }, { projectPath: '/template/dist/dev/mp-weixin', timeout: 240000 })
    expect(result).toBe(program)
    expect(seen).toEqual([{ projectPath: '/template/dist/dev/mp-weixin', timeout: 240000, preferOpenedSession: true }])
  })
  it('classifies connection failures without masking programming errors', async () => {
    const launchAutomator = async () => { throw new Error('port unavailable') }
    await expect(connectWechatRuntime({ launchAutomator, isDevtoolsHttpPortError: () => true }, {})).rejects.toBeInstanceOf(ExternalBlockError)
    await expect(connectWechatRuntime({ launchAutomator }, {})).rejects.not.toBeInstanceOf(ExternalBlockError)
  })
})

describe('GitHub verification', () => {
  const run = { workflowName: 'Quality', headSha: 'abc', status: 'completed', conclusion: 'success' }
  it('requires the correct commit and workflow', () => {
    expect(checkGitHubRun(run, 'abc').status).toBe('PASS')
    expect(checkGitHubRun(run, 'other').status).toBe('FAIL')
    expect(checkGitHubRun({ ...run, workflowName: 'Release' }, 'abc').status).toBe('FAIL')
  })
  it('distinguishes missing, running and failed runs', () => {
    expect(checkGitHubRun(undefined, 'abc').status).toBe('BLOCKED')
    expect(checkGitHubRun({ ...run, status: 'in_progress' }, 'abc').status).toBe('BLOCKED')
    expect(checkGitHubRun({ ...run, conclusion: 'failure' }, 'abc').status).toBe('FAIL')
  })
  it('keeps release history and runtime unit tests in CI', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    expect(await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8')).toContain('fetch-depth: 0')
    expect(await readFile(path.join(root, '.github/workflows/hmr-multi-platform.yml'), 'utf8')).toContain('pnpm test:e2e:daily:unit')
  })
})
