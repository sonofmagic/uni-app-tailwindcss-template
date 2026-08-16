import { describe, expect, it } from 'vitest'
import {
  aggregateStatus,
  compareContracts,
  lifecycleCoverage,
  resolveSources,
  runCleanup,
  validateTargetArtifact,
  validateLifecycleSummary,
  withTimeout,
} from '../../packages/create-uni-app-tailwindcss/scripts/daily-contract.mjs'

describe('daily user journey contract', () => {
  it('resolves candidate, latest, and all sources', () => {
    expect(resolveSources('candidate')).toEqual(['candidate'])
    expect(resolveSources('latest')).toEqual(['latest'])
    expect(resolveSources('all')).toEqual(['candidate', 'latest'])
    expect(() => resolveSources('local')).toThrow('--source must be candidate, latest, or all')
  })

  it('compares normalized generated-project fingerprints', () => {
    expect(compareContracts({ fingerprint: 'same' }, { fingerprint: 'same' }).matches).toBe(true)
    expect(compareContracts({ fingerprint: 'candidate' }, { fingerprint: 'latest' })).toEqual({
      candidate: 'candidate', latest: 'latest', matches: false,
    })
  })

  it('uses FAIL over BLOCKED over PASS', () => {
    expect(aggregateStatus(['PASS', 'BLOCKED'])).toBe('BLOCKED')
    expect(aggregateStatus(['BLOCKED', 'FAIL'])).toBe('FAIL')
    expect(aggregateStatus(['PASS', 'PASS'])).toBe('PASS')
    expect(aggregateStatus(['PASS', 'SKIP'])).toBe('FAIL')
  })

  it('counts BLOCKED as executed but rejects missing or skipped stages', () => {
    const complete = lifecycleCoverage(['build', 'runtime'], [
      { name: 'build', status: 'PASS' },
      { name: 'runtime', status: 'BLOCKED' },
    ])
    expect(complete).toMatchObject({ executed: 2, percent: 100, required: 2, status: 'BLOCKED' })
    expect(validateLifecycleSummary({ coverage: complete, stages: complete.results })).toEqual([])

    const incomplete = lifecycleCoverage(['build', 'runtime'], [{ name: 'build', status: 'PASS' }])
    expect(incomplete).toMatchObject({ executed: 1, percent: 50, status: 'FAIL' })
    expect(validateLifecycleSummary({ coverage: incomplete, stages: incomplete.results })).toHaveLength(2)
  })

  it('validates required five-target artifact markers without dumping bundles', () => {
    expect(validateTargetArtifact(
      'mp-weixin',
      ['app.json', 'app.js', 'app.wxss', 'pages/daily-user/index.wxml'],
      'daily-user-updated background: #dc2626',
      '/repo',
    )).toEqual([])
    expect(validateTargetArtifact('mp-alipay', ['app.json'], 'bundle', '/repo')).toEqual([
      'mp-alipay: missing app.js',
      'mp-alipay: missing app.acss',
      'mp-alipay: missing pages/daily-user/index.axml',
      'mp-alipay: missing daily-user-updated marker',
      'mp-alipay: missing updated color marker',
    ])
  })

  it('times out work and runs all interruption cleanup actions in reverse order', async () => {
    await expect(withTimeout(() => new Promise(resolve => setTimeout(resolve, 25)), 5)).rejects.toThrow('Timed out after 5ms')
    const order: string[] = []
    const errors = await runCleanup([
      async () => { order.push('first') },
      async () => { order.push('second'); throw new Error('cleanup failure') },
      async () => { order.push('third') },
    ])
    expect(order).toEqual(['third', 'second', 'first'])
    expect(errors).toHaveLength(1)
  })
})
