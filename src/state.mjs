import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, rename, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ApiError } from './http.mjs'
export const stateDirectory = (base) => join(process.env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'literary-universe-omarchy', createHash('sha256').update(base).digest('hex'))
export async function readState(dir) {
  try { return JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) } catch (error) { if (error.code === 'ENOENT') return {}; throw new ApiError('local_storage') }
}
export async function writeState(dir, state) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const temp = join(dir, `state.${process.pid}.tmp`)
  await writeFile(temp, JSON.stringify(state), { mode: 0o600 })
  await rename(temp, join(dir, 'state.json'))
}
/** Serializes refresh-token rotation and local edits across monitors/processes. */
export async function withLock(dir, run) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
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
