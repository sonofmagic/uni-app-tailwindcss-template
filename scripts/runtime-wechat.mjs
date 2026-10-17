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

function isWechatProjectAccessError(error) {
  const text = String(error?.message ?? error)
  return /(?:code\s*:?\s*10|登录用户不是该小程序的开发者|not\s+(?:a|the)\s+developer|HTTP automator fallback failed with status 5\d\d)/i.test(text)
}
