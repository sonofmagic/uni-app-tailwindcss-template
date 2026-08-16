import { createReadStream, promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(process.argv[2] ?? '')
const port = Number(process.argv[3])
if (!root || !Number.isInteger(port) || port <= 0) throw new Error('Usage: serve-static.mjs <root> <port>')

const contentTypes = new Map([
  ['.css', 'text/css'], ['.html', 'text/html'], ['.js', 'text/javascript'],
  ['.json', 'application/json'], ['.png', 'image/png'], ['.svg', 'image/svg+xml'],
])

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  let file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
  if (!file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(400).end('Bad request')
    return
  }
  try {
    if (!(await fs.stat(file)).isFile()) file = path.join(root, 'index.html')
  }
  catch {
    file = path.join(root, 'index.html')
  }
  response.setHeader('content-type', contentTypes.get(path.extname(file)) ?? 'application/octet-stream')
  createReadStream(file).pipe(response)
}).listen(port, '127.0.0.1')
