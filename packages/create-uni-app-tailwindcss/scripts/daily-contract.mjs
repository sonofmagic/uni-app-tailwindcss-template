export const supportedSources = ['candidate', 'latest']
export const targetRequiredArtifacts = {
  app: ['manifest.json', 'app-service.js', 'app.css'],
  'mp-weixin': ['app.json', 'app.js', 'app.wxss', 'pages/daily-user/index.wxml'],
  'mp-alipay': ['app.json', 'app.js', 'app.acss', 'pages/daily-user/index.axml'],
  'mp-toutiao': ['app.json', 'app.js', 'app.ttss', 'pages/daily-user/index.ttml'],
}

export function resolveSources(requested = 'all') {
  if (requested === 'all') return [...supportedSources]
  if (!supportedSources.includes(requested)) {
    throw new Error('--source must be candidate, latest, or all')
  }
  return [requested]
}

export function compareContracts(candidate, latest) {
  return {
    candidate: candidate.fingerprint,
    latest: latest.fingerprint,
    matches: candidate.fingerprint === latest.fingerprint,
  }
}

export function aggregateStatus(statuses) {
  if (statuses.includes('FAIL') || statuses.includes('MISSING') || statuses.includes('SKIP')) return 'FAIL'
  if (statuses.includes('BLOCKED')) return 'BLOCKED'
  return statuses.length > 0 && statuses.every(status => status === 'PASS') ? 'PASS' : 'FAIL'
}

export function lifecycleCoverage(requiredStages, stages) {
  const byName = new Map(stages.map(stage => [stage.name, stage]))
  const results = requiredStages.map(name => byName.get(name) ?? {
    durationMs: 0,
    error: 'Stage was not executed',
    name,
    status: 'MISSING',
  })
  const executed = results.filter(stage => !['MISSING', 'SKIP'].includes(stage.status)).length
  return {
    executed,
    percent: Math.round(executed / requiredStages.length * 100),
    required: requiredStages.length,
    results,
    status: aggregateStatus(results.map(stage => stage.status)),
  }
}

export function validateLifecycleSummary(summary) {
  const failures = []
  if (summary.coverage?.executed !== summary.coverage?.required || summary.coverage?.percent !== 100) {
    failures.push(`coverage is ${summary.coverage?.executed ?? 0}/${summary.coverage?.required ?? 0} (${summary.coverage?.percent ?? 0}%)`)
  }
  const silent = (summary.stages ?? []).filter(stage => ['MISSING', 'SKIP'].includes(stage.status))
  if (silent.length > 0) failures.push(`unexecuted stages: ${silent.map(stage => stage.name).join(', ')}`)
  return failures
}

export function validateTargetArtifact(target, files, content, repoRoot = '') {
  const failures = []
  for (const required of targetRequiredArtifacts[target] ?? []) {
    if (!files.includes(required)) failures.push(`${target}: missing ${required}`)
  }
  const normalized = content.toLowerCase()
  if (!content.includes('daily-user-updated')) failures.push(`${target}: missing daily-user-updated marker`)
  if (!normalized.includes('#dc2626') && !normalized.includes('rgb(220,38,38)')) failures.push(`${target}: missing updated color marker`)
  if (repoRoot && content.includes(repoRoot)) failures.push(`${target}: repository path leaked into artifact`)
  return failures
}

export async function withTimeout(task, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

export async function runCleanup(actions) {
  const errors = []
  for (const action of [...actions].reverse()) {
    try {
      await action()
    }
    catch (error) {
      errors.push(error)
    }
  }
  return errors
}
