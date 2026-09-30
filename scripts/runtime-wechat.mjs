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
    if (environmentErrors.some(classify => classify?.(error))) {
      throw new ExternalBlockError(`WeChat DevTools session unavailable: ${error.message}`, { cause: error })
    }
    throw error
  }
}
