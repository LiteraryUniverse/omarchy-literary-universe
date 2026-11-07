import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../src/bridge.mjs'

test('bridge preserves ambiguous captures and isolates drafts when accounts change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lu-bridge-'))
  const oldPath = process.env.PATH, oldState = process.env.XDG_STATE_HOME
  let userId = 'alice', failCapture = true
  const captures = []
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    res.setHeader('content-type', 'application/json')
    assert.equal(req.headers.authorization, 'Bearer test-token')
    if(req.url.endsWith('/summary')) res.end(JSON.stringify({userId,tasks:[],diary:{due:false}}))
    else if(req.url.endsWith('/capture')) { captures.push(JSON.parse(body)); if(failCapture){failCapture=false;res.writeHead(503).end('{"error":"unavailable"}')}else res.end('{"ok":true}') }
    else if(req.url.endsWith('/scratchpad')) res.end('{"text":"Existing"}')
    else if(req.url.endsWith('/notifications')) res.end('{"available":true,"items":[],"hasMore":false}')
    else if(req.url.endsWith('/article')) res.end('null')
    else res.writeHead(404).end('{}')
  })
  try {
    await mkdir(join(dir,'bin'))
    await writeFile(join(dir,'bin/secret-tool'), '#!/bin/sh\nprintf \'%s\' \'{"accessToken":"test-token","refreshToken":"test-refresh","clientId":"test-client","expiresAt":4102444800000}\'\n', {mode:0o700})
    process.env.PATH = `${dir}/bin:${oldPath}`; process.env.XDG_STATE_HOME = dir
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    const base=`http://127.0.0.1:${server.address().port}`
    await run({action:'refresh'},base)
    await run({action:'draft',userId:'alice',text:'Keep this note'},base)
    userId='bob'
    assert.equal((await run({action:'refresh'},base)).draft,'')
    await assert.rejects(run({action:'capture',userId:'alice',text:'Keep this note'},base),/account_changed/)
    userId='alice'
    assert.equal((await run({action:'refresh'},base)).draft,'Keep this note')
    const uncertain=await run({action:'capture',userId:'alice',text:'Keep this note'},base)
    assert.equal(uncertain.pending,true)
    const retried=await run({action:'capture',userId:'alice',text:'Do not replace the pending operation'},base)
    assert.equal(retried.draft,'')
    assert.deepEqual(captures[0],captures[1])
    assert.equal(captures[1].text,'Keep this note')
  } finally {
    process.env.PATH=oldPath
    if(oldState===undefined)delete process.env.XDG_STATE_HOME;else process.env.XDG_STATE_HOME=oldState
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await rm(dir,{recursive:true,force:true})
  }
})
