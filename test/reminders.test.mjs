import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../src/bridge.mjs'
import { stateDirectory, readState, writeState } from '../src/state.mjs'

test('reminders honor opt-in, daily deduplication and snooze; notification banners do not replay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lu-reminders-'))
  const oldPath = process.env.PATH, oldState = process.env.XDG_STATE_HOME
  let diary = { due: true, date: '2026-11-07' }, items = []
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url.endsWith('/summary')) res.end(JSON.stringify({ userId: 'alice', diary }))
    else if (req.url.endsWith('/notifications')) res.end(JSON.stringify({ available: true, items }))
    else if (req.url.endsWith('/scratchpad')) res.end('{"text":""}')
    else if (req.url.endsWith('/tasks')) res.end('{"items":[]}')
    else res.end('null')
  })
  try {
    await mkdir(join(dir, 'bin'))
    await writeFile(join(dir, 'bin/secret-tool'), '#!/bin/sh\nprintf \'%s\' \'{"accessToken":"token","refreshToken":"refresh","clientId":"client","expiresAt":4102444800000}\'\n', { mode: 0o700 })
    await writeFile(join(dir, 'bin/notify-send'), `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(join(dir, 'banners'))}, JSON.stringify(process.argv.slice(2))+'\\n')\n`, { mode: 0o700 })
    process.env.PATH = `${dir}/bin:${oldPath}`; process.env.XDG_STATE_HOME = dir
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const banners = async () => (await readFile(join(dir, 'banners'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse)
    const refresh = preferences => run({ action: 'refresh', background: true, preferences, diaryLabel: 'Deník' }, base)
    await refresh({})
    assert.equal((await banners()).length, 0)
    await refresh({ diary: true })
    await refresh({ diary: true })
    assert.equal((await banners()).length, 1)
    assert.equal((await banners())[0].at(-1), 'Deník')
    await run({ action: 'snooze', userId: 'alice' }, base)
    await refresh({ diary: true })
    assert.equal((await banners()).length, 1)
    const state = await readState(stateDirectory(base)); state.snooze.until = 1
    await writeState(stateDirectory(base), state)
    await refresh({ diary: true })
    assert.equal((await banners()).length, 2)
    diary = { due: false, date: '2026-11-08' }
    items = [{ id: 'message', category: 'new-message', createdAt: new Date().toISOString(), title: '<b>Message</b>' }]
    await refresh({ diary: true, messages: true })
    await refresh({ diary: true, messages: true })
    assert.equal((await banners()).length, 3)
    assert.equal((await banners())[2].at(-1), '&lt;b&gt;Message&lt;/b&gt;')
    items.unshift({ id: 'release', category: 'new-chapter', createdAt: new Date().toISOString(), title: 'New chapter' })
    await refresh({ messages: true, releases: false })
    await refresh({ messages: true, releases: true })
    assert.equal((await banners()).length, 3)
  } finally {
    process.env.PATH = oldPath
    if (oldState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = oldState
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})
