// Fictional companion API for previews. Loopback only; prints its origin, logs paths it served.
import { createServer } from 'node:http'
import { readFileSync, appendFileSync } from 'node:fs'
const [log] = process.argv.slice(2)
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const fixtures = JSON.parse(readFileSync(new URL('fixtures/api.json', import.meta.url), 'utf8')
  .replaceAll('{today}', day(0)).replaceAll('{yesterday}', day(-1)).replaceAll('{now}', new Date().toISOString()))
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname.replace('/api/companion/v1', '')
  if (log) appendFileSync(log, path + '\n')
  res.setHeader('content-type', 'application/json')
  if (req.method === 'POST') res.end('{"ok":true}')
  else if (path in fixtures) res.end(JSON.stringify(fixtures[path]))
  else res.writeHead(404).end('{"error":"not_found"}')
})
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`))
