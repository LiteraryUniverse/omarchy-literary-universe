#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { ApiError, baseUrl, destination, request } from './http.mjs'
import { accessToken, login, logout } from './auth.mjs'
import { stateDirectory, readState, writeState, withLock, plainMarkup, pendingNotifications } from './state.mjs'
const exec = promisify(execFile)
const allowed = new Set(['refresh', 'login', 'logout', 'draft', 'capture', 'taskAdd', 'taskComplete', 'read', 'snooze', 'open'])
const text = (s, max = 20000) => { if (typeof s !== 'string' || s.length > max) throw new ApiError('input'); return s }
async function notify(title, body) {
  // The shell's notification service owns Do Not Disturb. Never bypass it.
  await exec('notify-send', ['--app-name=Literary Universe', '--', plainMarkup(title), plainMarkup(body)], { timeout: 5000 }).catch(() => {})
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
    if (typeof summary.userId !== 'string' || !Array.isArray(summary.tasks)) throw new ApiError('response')
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
    const currentSummary = ['taskAdd', 'taskComplete'].includes(input.action) ? await api('/summary') : summary
    // A Novu outage must not make notes or tasks unusable.
    const values = await Promise.allSettled([api('/scratchpad'), api('/notifications'), api('/article')])
    const errors = []
    const value = (index, key, fallback) => { if (values[index].status === 'fulfilled') return values[index].value; errors.push(key); return fallback }
    const scratchpad = value(0, 'scratchpad', null)
    const notifications = value(1, 'notifications', { available: false, items: [] })
    const article = value(2, 'article', state.article || null)
    if (values[2].status === 'fulfilled') state.article = article
    const snapshot = { signedIn: true, ...currentSummary, scratchpad, notifications, article, draft: state.drafts[userId]?.text || '', pending: Boolean(state.drafts[userId]?.pending), errors, retryAfter: Math.max(0, ...values.filter(v => v.status === 'rejected').map(v => v.reason.retryAfter || 0)) }
    if (input.background === true) {
      const prefs = input.preferences || {}
      const previous = state.notifications?.userId === userId ? state.notifications : null
      for (const item of pendingNotifications(previous, notifications.items || [])) {
        const isMessage = item.category === 'new-message'
        const isRelease = ['new-chapter', 'story-finished', 'changelog'].includes(item.category)
        if ((isMessage && prefs.messages === true) || (isRelease && prefs.releases === true)) await notify('Literary Universe', item.title)
      }
      if (prefs.diary === true && summary.diary?.due && state.diaryShown !== `${userId}:${summary.diary.date}` && !(state.snooze?.userId === userId && state.snooze.until > Date.now())) {
        await notify('Literary Universe', text(input.diaryLabel || 'Diary', 200))
        state.diaryShown = `${userId}:${summary.diary.date}`
      }
    }
    if (notifications.available) state.notifications = { userId, checkedAt: Date.now(), ids: notifications.items.map((n) => n.id) }
    await writeState(dir, state)
    return snapshot
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let raw = ''
    for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 40000) throw new ApiError('input'); if (raw.includes('\n')) break }
    console.log(JSON.stringify(await run(JSON.parse(raw))))
  } catch (error) {
    // Code-only errors: never echo upstream bodies, credentials or user text.
    console.log(JSON.stringify({ error: error instanceof ApiError ? error.code : 'unavailable', retryAfter: error.retryAfter || 0 }))
    process.exitCode = 1
  }
}
