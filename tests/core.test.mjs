import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readdir, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { baseUrl, destination, image, imageSize, request } from '../src/http.mjs'
import { callbackHandler } from '../src/auth.mjs'
import { cachedCover, pendingNotifications, plainMarkup, readState, writeState, withLock } from '../src/state.mjs'

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
test('cover headers give real dimensions and anything else is refused', async () => {
  const png = Buffer.alloc(33); png.writeUInt32BE(0x89504e47, 0); png.write('IHDR', 12, 'latin1'); png.writeUInt32BE(600, 16); png.writeUInt32BE(900, 20)
  assert.deepEqual(imageSize(png), [600, 900])
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x03, 0x84, 0x02, 0x58, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(imageSize(jpeg), [600, 900])
  const webp = Buffer.alloc(40); webp.write('RIFF', 0, 'latin1'); webp.write('WEBPVP8X', 8, 'latin1'); webp.writeUIntLE(599, 24, 3); webp.writeUIntLE(899, 27, 3)
  assert.deepEqual(imageSize(webp), [600, 900])
  assert.equal(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
  await assert.rejects(image('http://lu.test/cover.png'), /image/)
})
test('covers are cached privately, one per URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lu-cover-'))
  let downloads = 0
  const download = async () => { downloads++; return Buffer.from('bytes') }
  try {
    const first = await cachedCover(dir, 'https://cdn.test/a.png', download)
    assert.equal(await cachedCover(dir, 'https://cdn.test/a.png', download), first)
    assert.match(first, /^file:\/\/.*cover-[0-9a-f]{32}$/)
    await cachedCover(dir, 'https://cdn.test/b.png', download)
    assert.equal(downloads, 2)
    const covers = (await readdir(dir)).filter((f) => f.startsWith('cover-'))
    assert.equal(covers.length, 1)
    assert.equal((await stat(join(dir, covers[0]))).mode & 0o777, 0o600)
    assert.equal((await stat(dir)).mode & 0o777, 0o700)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
