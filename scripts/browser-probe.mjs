import { once } from 'node:events'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const executablePath = process.argv[2]
if (!executablePath || !path.isAbsolute(executablePath)) {
  throw new Error('Browser probe requires an absolute executable path')
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('preflight-ok')
})
let browser
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  browser = await chromium.launch({ executablePath, headless: true, timeout: 10_000 })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`, { timeout: 10_000 })
  if (await page.locator('body').innerText() !== 'preflight-ok') {
    throw new Error('Browser could not read the loopback response')
  }
  console.log('preflight-ok')
}
catch (error) {
  console.error(error)
  process.exitCode = 1
}
finally {
  try { await browser?.close() }
  finally { server.closeAllConnections(); server.close() }
}
