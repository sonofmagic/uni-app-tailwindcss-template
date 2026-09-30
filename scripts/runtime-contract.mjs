export class ExternalBlockError extends Error {}

export function runtimeStatus(results, requiredCount = results.length) {
  if (results.length !== requiredCount || results.length === 0) return 'FAIL'
  if (results.some(result => !['PASS', 'BLOCKED'].includes(result.status))) return 'FAIL'
  return results.some(result => result.status === 'BLOCKED') ? 'BLOCKED' : 'PASS'
}

export function statusExitCode(status) {
  return status === 'PASS' ? 0 : status === 'BLOCKED' ? 2 : 1
}

export async function runRuntimeLane(platform, execute, cleanup) {
  const result = { platform, status: 'FAIL', startedAt: new Date().toISOString() }
  const started = Date.now()
  try {
    Object.assign(result, await execute())
    result.status = 'PASS'
  }
  catch (error) {
    result.status = error instanceof ExternalBlockError ? 'BLOCKED' : 'FAIL'
    result.error = error instanceof Error ? error.message : String(error)
  }
  finally {
    try { await cleanup() }
    catch (error) {
      result.status = 'FAIL'
      result.error = [result.error, `Cleanup failed: ${error.message}`].filter(Boolean).join('; ')
    }
    result.durationMs = Date.now() - started
    result.finishedAt = new Date().toISOString()
  }
  return result
}

export function checkGitHubRun(run, expectedSha) {
  if (!run) return { status: 'BLOCKED', message: 'No matching Quality run found' }
  if (run.headSha !== expectedSha) return { status: 'FAIL', message: `Quality run commit ${run.headSha} does not match ${expectedSha}` }
  if (run.workflowName !== 'Quality') return { status: 'FAIL', message: `Expected Quality workflow, received ${run.workflowName}` }
  if (run.status !== 'completed') return { status: 'BLOCKED', message: `Quality run is ${run.status}` }
  return run.conclusion === 'success'
    ? { status: 'PASS', message: 'Quality workflow passed for the current commit' }
    : { status: 'FAIL', message: `Quality workflow concluded ${run.conclusion}` }
}
