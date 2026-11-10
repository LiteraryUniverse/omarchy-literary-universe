#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { ApiError, baseUrl, destination, image, request } from './http.mjs'
import { accessToken, login, logout } from './auth.mjs'
import { stateDirectory, readState, writeState, withLock, plainMarkup, pendingNotifications, cachedCover } from './state.mjs'
const exec = promisify(execFile)
const allowed = new Set(['refresh', 'login', 'logout', 'draft', 'capture', 'taskAdd', 'taskComplete', 'read', 'snooze', 'open'])
const text = (s, max = 20000) => { if (typeof s !== 'string' || s.length > max) throw new ApiError('input'); return s }
async function notify(label) {
  // The shell's notification service owns Do Not Disturb. Never bypass it.
  // argv is visible to other local processes, so banners carry only a fixed UI label, never LU content.
  await exec('notify-send', ['--app-name=Literary Universe', '--', 'Literary Universe', plainMarkup(String(label).slice(0, 200))], { timeout: 5000 }).catch(() => {})
}
export async function run(input, base = baseUrl(process.env.LU_COMPANION_URL)) {
  if (!input || !allowed.has(input.action)) throw new ApiError('input')
  if (input.action === 'open') { await exec('xdg-open', [destination(base, input.path)], { timeout: 5000 }); return { ok: true } }
  const dir = stateDirectory(base)
  return withLock(dir, async () => {
    let state = await readState(dir)
    state.drafts ??= {}
    if (input.action === 'login') { await login(base); input = { ...input, action: 'refresh' } }
    if (input.action === 'logout') { await logout(base); delete state.userId; delete state.snapshot; await writeState(dir, state); return { signedIn: false } }
    if (input.action === 'draft') {
      if (!state.userId || input.userId !== state.userId) throw new ApiError('signed_out')
      const draft = state.drafts[state.userId] || { id: randomUUID(), text: '' }
      if (draft.pending) throw new ApiError('pending_capture')
      state.drafts[state.userId] = { ...draft, text: text(input.text) }
      await writeState(dir, state)
      return { draftSaved: true }
    }
    const token = await accessToken(base)
    const api = (path, json) => request(`${base}/api/companion/v1${path}`, { token, method: json ? 'POST' : 'GET', json })
    const summary = await api('/summary')
    if (typeof summary.userId !== 'string') throw new ApiError('response')
    const userId = summary.userId
    const draft = state.drafts[userId] || { id: randomUUID(), text: '' }
    if (input.action !== 'refresh' && input.userId !== userId) throw new ApiError('account_changed')
    state.userId = userId
    if (input.action === 'capture') {
      // Persist before sending. If the connection drops after commit, retry the same UUID/text.
      if (!draft.pending) { draft.text = text(input.text).trim(); draft.pending = true }
      if (!draft.text) throw new ApiError('input')
      state.drafts[userId] = draft
      await writeState(dir, state)
      try { await api('/capture', { id: draft.id, text: draft.text }) } catch (error) { return { error: error.code || 'unavailable', pending: true, retryAfter: error.retryAfter || 0 } }
      state.drafts[userId] = { id: randomUUID(), text: '' }
      await writeState(dir, state)
    } else if (input.action === 'taskAdd') {
      await api('/tasks', { action: 'add', itemId: text(input.id, 100), fields: { title: text(input.text, 500) } })
    } else if (input.action === 'taskComplete') {
      await api('/tasks', { action: 'complete', itemId: text(input.id, 180), version: input.version, completed: true })
    } else if (input.action === 'read') {
      await api('/notifications/read', { id: text(input.id, 180) })
    } else if (input.action === 'snooze') {
      state.snooze = { userId, until: Date.now() + 30 * 60000 }
      state.diaryShown = null
    }
    // A Novu outage must not make notes or tasks unusable.
    const values = await Promise.allSettled([api('/scratchpad'), api('/notifications'), api('/article'), api('/tasks')])
    const errors = []
    const value = (index, key, fallback) => { if (values[index].status === 'fulfilled') return values[index].value; errors.push(key); return fallback }
    const scratchpad = value(0, 'scratchpad', null)
    const notifications = value(1, 'notifications', { available: false, items: [] })
    const article = value(2, 'article', state.article || null)
    const tasks = value(3, 'tasks', { items: [] })
    if (values[2].status === 'fulfilled') state.article = article
    // Qt never loads a remote URL: covers are fetched with limits and shown from the private state directory.
    const cover = summary.resume?.cover ? await cachedCover(dir, summary.resume.cover, image).catch(() => null) : null
    const resume = summary.resume ? { ...summary.resume, cover } : null
    const snapshot = { signedIn: true, ...summary, resume, tasks: tasks.items, scratchpad, notifications, article, draft: state.drafts[userId]?.text || '', pending: Boolean(state.drafts[userId]?.pending), errors, retryAfter: Math.max(0, ...values.filter(v => v.status === 'rejected').map(v => v.reason.retryAfter || 0)) }
    if (input.background === true) {
      const prefs = input.preferences || {}
      const previous = state.notifications?.userId === userId ? state.notifications : null
      const fresh = pendingNotifications(previous, notifications.items || [])
      if (prefs.messages === true && fresh.some((n) => n.category === 'new-message')) await notify(input.messageLabel || 'New message')
      if (prefs.releases === true && fresh.some((n) => ['new-chapter', 'story-finished', 'changelog'].includes(n.category))) await notify(input.releaseLabel || 'New release')
      if (prefs.diary === true && summary.diary?.due && state.diaryShown !== `${userId}:${summary.diary.date}` && !(state.snooze?.userId === userId && state.snooze.until > Date.now())) {
        await notify(input.diaryLabel || 'Diary')
        state.diaryShown = `${userId}:${summary.diary.date}`
      }
    }
    if (notifications.available) state.notifications = { userId, checkedAt: Date.now(), ids: notifications.items.map((n) => n.id) }
    await writeState(dir, state)
    return snapshot
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Whole-run deadline: login waits up to five minutes; nothing else should come close.
  setTimeout(() => { console.log(JSON.stringify({ error: 'timeout', retryAfter: 0 })); process.exit(1) }, 330_000).unref()
  try {
    let raw = ''
    for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 128000) throw new ApiError('input'); if (raw.includes('\n')) break }
    console.log(JSON.stringify(await run(JSON.parse(raw))))
  } catch (error) {
    // Code-only errors: never echo upstream bodies, credentials or user text.
    console.log(JSON.stringify({ error: error instanceof ApiError ? error.code : 'unavailable', retryAfter: error.retryAfter || 0 }))
    process.exitCode = 1
  }
}
