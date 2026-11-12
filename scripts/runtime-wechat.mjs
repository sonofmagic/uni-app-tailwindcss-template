import { ExternalBlockError } from './runtime-contract.mjs'

export async function connectWechatRuntime(api, options) {
  try {
    return await api.launchAutomator({ ...options, preferOpenedSession: true })
  }
  catch (error) {
    const environmentErrors = [
      api.isAutomatorLoginError, api.isDevtoolsHttpPortError,
      api.isAutomatorWsConnectError, api.isDevtoolsExtensionContextInvalidatedError,
      api.isAutomatorPortInUseError, api.isAutomatorProtocolTimeoutError,
    ]
    if (environmentErrors.some(classify => classify?.(error)) || isWechatProjectAccessError(error)) {
      throw new ExternalBlockError(`WeChat DevTools session unavailable: ${error.message}`, { cause: error })
    }
    throw error
  }
}

export async function closeWechatRuntime(api, program, journalPath) {
  const errors = []
  try { await program?.close() }
  catch (error) { errors.push(error) }
  if (journalPath) {
    try {
      await api.cleanupManagedWechatProjects({ journalPath, scope: 'process' })
      const records = await api.readManagedWechatProjectRecords(journalPath)
      if (records.some(record => !api.isManagedWechatProjectFullyReleased(record))) {
        throw new Error(`WeChat project cleanup is incomplete; inspect ${journalPath}`)
      }
    }
    catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('; '))
}

function isWechatProjectAccessError(error) {
  const text = String(error?.message ?? error)
  return /(?:code\s*:?\s*10|登录用户不是该小程序的开发者|not\s+(?:a|the)\s+developer|HTTP automator fallback failed with status 5\d\d)/i.test(text)
}
