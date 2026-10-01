import { describe, expect, it } from 'vitest'
import { checkChrome } from '../preflight-core.mjs'

describe('browser discovery for Playwright', () => {
  it('resolves a PATH command before both probing and handing it to HMR', async () => {
    const calls: Array<{ command: string, args: string[] }> = []
    const result = await checkChrome({
      configured: '', candidates: ['google-chrome'],
      executor: { async run(command: string, args: string[]) {
        calls.push({ command, args })
        if (command === 'which' || command === 'where') return { code: 0, output: '/usr/bin/google-chrome\n' }
        return { code: 0, output: args.includes('--version') ? 'Chrome 153' : 'preflight-ok' }
      } },
    })
    expect(result.status).toBe('PASS')
    expect(result.evidence.path).toBe('/usr/bin/google-chrome')
    expect(calls[1]).toEqual({ command: '/usr/bin/google-chrome', args: ['--version'] })
    expect(calls[2].command).toBe(process.execPath)
    expect(calls[2].args[0]).toMatch(/browser-probe\.mjs$/)
    expect(calls[2].args[1]).toBe(result.evidence.path)
  })

  it.each([
    { code: 1, output: 'Browser closed before startup' },
    { code: 124, output: 'Command timed out', timedOut: true },
    { code: 0, output: 'unexpected page' },
  ])('falls back when the first browser cannot render loopback: %j', async (failure) => {
    const result = await checkChrome({
      configured: '', candidates: ['/broken/chrome', '/working/chromium'],
      executor: { async run(_command: string, args: string[]) {
        if (args.includes('--version')) return { code: 0, output: 'Chrome 153' }
        return args[1] === '/broken/chrome' ? failure : { code: 0, output: 'preflight-ok' }
      } },
    })
    expect(result.status).toBe('PASS')
    expect(result.evidence.path).toBe('/working/chromium')
    expect(result.evidence.attempts[0].headless.output).toBe(failure.output)
    expect(result.evidence.attempts).toHaveLength(2)
  })

  it('honors an explicit browser and does not silently replace it', async () => {
    const calls: string[] = []
    const result = await checkChrome({
      configured: '/chosen/chrome', candidates: ['/working/chromium'],
      executor: { async run(command: string) { calls.push(command); return { code: 1, output: 'ENOENT' } } },
    })
    expect(result.status).toBe('BLOCKED')
    expect(calls).toEqual(['/chosen/chrome'])
    expect(result.evidence.attempts[0].output).toBe('ENOENT')
  })

  it('resolves relative paths against the executor directory, including spaces', async () => {
    const result = await checkChrome({
      configured: './browsers/Chrome Test',
      executor: { cwd: '/workspace', async run(_command: string, args: string[]) {
        return { code: 0, output: args.includes('--version') ? 'Chrome 153' : 'preflight-ok' }
      } },
    })
    expect(result.status).toBe('PASS')
    expect(result.evidence.path).toBe('/workspace/browsers/Chrome Test')
  })

  it('reports missing PATH commands as blockers with diagnostics', async () => {
    const result = await checkChrome({
      configured: '', candidates: ['missing-browser'],
      executor: { async run() { return { code: 1, output: '' } } },
    })
    expect(result.status).toBe('BLOCKED')
    expect(result.evidence.attempts[0].error).toContain('PATH')
  })
})
