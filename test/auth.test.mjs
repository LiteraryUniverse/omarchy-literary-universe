import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { login, keyring, accessToken, logout } from '../src/auth.mjs'

test('public client uses supported scopes and PKCE, rotates refresh tokens and revokes before clearing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lu-oauth-'))
  const oldPath = process.env.PATH
  let base, challenge, revoked = false, failRevoke = true, failures = []
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk
      res.setHeader('content-type', 'application/json')
      if (req.url === '/.well-known/oauth-authorization-server') {
        res.end(JSON.stringify(Object.fromEntries(['authorization', 'token', 'registration', 'revocation'].map(k => [`${k}_endpoint`, `${base}/${k}`]))))
      } else if (req.url === '/registration') {
        const client = JSON.parse(body)
        assert.equal(client.scope, 'companion:read tasks:read tasks:write notifications:read notifications:write scratchpad:read scratchpad:write')
        assert.equal(client.token_endpoint_auth_method, 'none')
        assert.ok(client.grant_types.includes('refresh_token'))
        res.end('{"client_id":"public-client"}')
      } else if (req.url.startsWith('/authorization?')) {
        const url = new URL(req.url, base), callback = new URL(url.searchParams.get('redirect_uri'))
        challenge = url.searchParams.get('code_challenge')
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
        callback.search = new URLSearchParams({ code: 'code', state: url.searchParams.get('state') })
        await fetch(callback)
        res.end('{}')
      } else if (req.url === '/token') {
        const form = new URLSearchParams(body)
        assert.equal(form.get('client_id'), 'public-client')
        if (form.get('grant_type') === 'authorization_code') {
          assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), challenge)
          res.end('{"access_token":"first","refresh_token":"refresh-first","expires_in":3600}')
        } else {
          assert.equal(form.get('refresh_token'), 'refresh-first')
          res.end('{"access_token":"rotated","refresh_token":"refresh-rotated","expires_in":3600}')
        }
      } else if (req.url === '/revocation') {
        assert.equal(new URLSearchParams(body).get('token'), 'refresh-rotated')
        if (failRevoke) res.writeHead(503).end('{"error":"unavailable"}')
        else { revoked = true; res.writeHead(204).end() }
      } else res.writeHead(404).end('{}')
    } catch (error) { failures.push(error); res.writeHead(500).end('{}') }
  })
  try {
    await mkdir(join(dir, 'bin'))
    await writeFile(join(dir, 'bin/secret-tool'), `#!/usr/bin/env node\nconst fs=require('fs'),p=${JSON.stringify(join(dir, 'credential'))};switch(process.argv[2]){case '--help':break;case 'lookup':process.stdout.write(fs.readFileSync(p));break;case 'store':fs.writeFileSync(p,fs.readFileSync(0),{mode:0o600});break;case 'clear':fs.rmSync(p);break}\n`, { mode: 0o700 })
    await writeFile(join(dir, 'bin/xdg-open'), '#!/usr/bin/env node\nfetch(process.argv[2]).then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})\n', { mode: 0o700 })
    process.env.PATH = `${dir}/bin:${oldPath}`
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
    await login(base)
    assert.equal(await accessToken(base), 'first')
    await keyring(base, { ...await keyring(base), expiresAt: 1 })
    assert.equal(await accessToken(base), 'rotated')
    await assert.rejects(logout(base), /unavailable/)
    assert.equal((await keyring(base)).refreshToken, 'refresh-rotated')
    failRevoke = false
    await logout(base)
    assert.ok(revoked)
    await assert.rejects(keyring(base), /signed_out/)
    assert.deepEqual(failures, [])
  } finally {
    process.env.PATH = oldPath
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})
