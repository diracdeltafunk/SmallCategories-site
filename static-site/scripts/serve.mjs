import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = resolve(SITE_DIR, 'dist')
const PORT = Number(process.env.PORT || 8000)
const TYPES = {
  '.bin': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function safePath(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
  const path = resolve(DIST_DIR, relative)
  return path === DIST_DIR || path.startsWith(`${DIST_DIR}${sep}`) ? path : null
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    let path = safePath(url.pathname)
    if (!path) {
      response.writeHead(400).end('Bad request')
      return
    }
    const details = await stat(path).catch(() => null)
    if (!details?.isFile()) path = resolve(DIST_DIR, 'index.html')
    const body = await readFile(path)
    response.writeHead(200, {
      'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    response.end(body)
  } catch (error) {
    console.error(error)
    response.writeHead(500).end('Preview server error')
  }
})

server.listen(PORT, () => {
  console.log(`SmallCats preview: http://127.0.0.1:${PORT}`)
})
