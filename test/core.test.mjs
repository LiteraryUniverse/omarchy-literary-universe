import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { baseUrl, destination, request } from '../src/http.mjs'
import { callbackHandler } from '../src/auth.mjs'
import { pendingNotifications, plainMarkup, readState, writeState, withLock } from '../src/state.mjs'

test('only HTTPS or explicit loopback deployments, and internal destinations', () => {
  for (const url of ['http://remote.test', 'https://user:pass@lu.test', 'https://lu.test/?token=a']) assert.throws(() => baseUrl(url))
  for (const path of ['//evil.test', '/\\evil.test', 'javascript:alert(1)', '/bad\nurl']) assert.throws(() => destination('https://lu.test', path))
  assert.equal(destination('https://lu.test', '/diary/today'), 'https://lu.test/diary/today')
})
test('callback checks state and path before accepting a code', () => {
  let code
  const handler = callbackHandler('expected', (error, value) => { assert.equal(error, null); code = value })
  const res = { writeHead() { return this }, end() {} }
  handler({method:'GET',url:'/callback?state=wrong&code=stolen'},res)
  assert.equal(code, undefined)
  handler({method:'GET',url:'/callback?state=expected&code=ok'},res)
  assert.equal(code,'ok')
})
test('suppresses initial, old, read and repeated notification banners', () => {
  const now = Date.now()
  const items = [{id:'new',createdAt:new Date(now).toISOString(),read:false},{id:'old',createdAt:new Date(now-3600000).toISOString(),read:false}]
  assert.deepEqual(pendingNotifications(null,items,now),[])
  assert.deepEqual(pendingNotifications({checkedAt:now-60000,ids:[]},items,now).map(n=>n.id),['new'])
  assert.deepEqual(pendingNotifications({checkedAt:now-60000,ids:['new']},items,now),[])
  assert.equal(plainMarkup('<img src="https://tracker">'), '&lt;img src="https://tracker"&gt;')
})
test('drafts survive atomic saves, permissions are private and the lock excludes peers', async () => {
  const dir = await mkdtemp(join(tmpdir(),'lu-companion-'))
  try {
    await withLock(dir, async () => {
      await assert.rejects(withLock(dir,async()=>{}), /busy/)
      await writeState(dir,{drafts:{alice:{id:'uuid',text:'My note'}}})
    })
    assert.equal((await readState(dir)).drafts.alice.text,'My note')
    assert.equal((await stat(join(dir,'state.json'))).mode & 0o777, 0o600)
    await withLock(dir,async()=>{})
  } finally { await rm(dir,{recursive:true,force:true}) }
})
test('HTTP bounds responses, refuses redirects, carries rate limits and accepts empty revoke', async () => {
  const server = createServer((req,res)=>{
    if(req.url==='/limit')res.writeHead(429,{'Retry-After':'90'}).end('{"error":"limited"}')
    else if(req.url==='/redirect')res.writeHead(302,{Location:'/empty'}).end()
    else if(req.url==='/big')res.end('x'.repeat(1000001))
    else res.writeHead(204).end()
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${server.address().port}`
  try {
    await assert.rejects(request(base+'/limit'),e=>e.code==='rate_limited'&&e.retryAfter===90)
    await assert.rejects(request(base+'/redirect'))
    await assert.rejects(request(base+'/big'),/response_too_large/)
    assert.deepEqual(await request(base+'/empty'),{})
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)) }
})
