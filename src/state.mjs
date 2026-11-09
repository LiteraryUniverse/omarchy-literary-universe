import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, readdir, writeFile, rename, open, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ApiError } from './http.mjs'
export const stateDirectory = (base) => join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'literary-universe-omarchy', createHash('sha256').update(base).digest('hex'))
export async function readState(dir) {
  try { return JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) } catch (error) { if (error.code === 'ENOENT') return {}; throw new ApiError('local_storage') }
}
async function privateDirectory(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
}
async function writePrivate(dir, name, data) {
  await privateDirectory(dir)
  const temp = join(dir, `.${name}.${randomUUID()}.tmp`)
  await writeFile(temp, data, { mode: 0o600, flag: 'wx' })
  await rename(temp, join(dir, name))
}
export const writeState = (dir, state) => writePrivate(dir, 'state.json', JSON.stringify(state))
/** Keeps one downloaded cover per URL and returns its file URL for Qt. */
export async function cachedCover(dir, url, download) {
  const name = `cover-${createHash('sha256').update(url).digest('hex').slice(0, 32)}`
  if (!(await stat(join(dir, name)).catch(() => null))) await writePrivate(dir, name, await download(url))
  for (const entry of await readdir(dir)) if (entry.startsWith('cover-') && entry !== name) await rm(join(dir, entry), { force: true })
  return pathToFileURL(join(dir, name)).href
}
/** Serializes refresh-token rotation and local edits across monitors/processes. */
export async function withLock(dir, run) {
  await privateDirectory(dir)
  const lock = await open(join(dir, 'lock'), 'a', 0o600)
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', lock.fd] })
      child.on('error', () => reject(new ApiError('local_storage')))
      child.on('exit', (code) => code === 0 ? resolve() : reject(new ApiError('busy')))
    })
    return await run()
  } finally { await lock.close() }
}
export function plainMarkup(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').slice(0, 1000)
}
export function pendingNotifications(previous, items, now = Date.now()) {
  if (!previous?.checkedAt) return []
  const seen = new Set(previous.ids || [])
  return items.filter((n) => !n.read && !seen.has(n.id) && Date.parse(n.createdAt) >= Math.max(previous.checkedAt, now - 300000))
}
