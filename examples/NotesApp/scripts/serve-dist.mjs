import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, isAbsolute, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = normalize(fileURLToPath(new URL('../dist-web-test/', import.meta.url)))
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
}

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const filePath = normalize(join(root, relativePath))
    const pathFromRoot = relative(root, filePath)
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
      response.writeHead(403).end()
      return
    }
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) throw new Error('Not a file')
    response.writeHead(200, {
      'Content-Length': fileStat.size,
      'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(filePath).pipe(response)
  } catch (error) {
    process.stderr.write(
      `Static server could not serve ${request.url ?? '/'}: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    response.writeHead(404).end('Not found')
  }
}).listen(4177, '127.0.0.1', () => {
  process.stdout.write('Serving dist-web-test on http://127.0.0.1:4177\n')
})
