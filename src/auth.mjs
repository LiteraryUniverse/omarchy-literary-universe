// The browser/loopback flow follows LiteraryUniverse/cli's MIT-licensed OAuth client.
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ApiError, request } from './http.mjs'
const exec = promisify(execFile)
const scopes = 'companion:read companion:write scratchpad:read scratchpad:write'
const account = (base) => createHash('sha256').update(base).digest('hex')

export async function keyring(base, value) {
  const attrs = ['service', 'literary-universe-omarchy', 'account', account(base)]
  if (value === undefined) {
    try { const { stdout } = await exec('secret-tool', ['lookup', ...attrs], { timeout: 5000, maxBuffer: 32_768 }); return JSON.parse(stdout) } catch { throw new ApiError('signed_out') }
  }
  if (value === null) { await exec('secret-tool', ['clear', ...attrs], { timeout: 5000 }).catch(() => { throw new ApiError('keyring') }); return }
  await new Promise((resolve, reject) => {
    const child = execFile('secret-tool', ['store', '--label=Literary Universe for Omarchy', ...attrs], { timeout: 10000 }, (error) => error ? reject(new ApiError('keyring')) : resolve())
    child.stdin.end(JSON.stringify(value))
  })
}
export async function discover(base) {
  const metadata = await request(`${base}/.well-known/oauth-authorization-server`)
  for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) {
    if (typeof metadata[key] !== 'string' || new URL(metadata[key]).origin !== base) throw new ApiError('configuration')
  }
  return metadata
}
function session(clientId, token) {
  if (typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string' || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new ApiError('oauth')
  return { clientId, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000 }
}
export function callbackHandler(state, settle) {
  return (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || url.pathname !== '/callback' || url.searchParams.get('state') !== state) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Literary Universe: return to Omarchy.')
    const code = url.searchParams.get('code')
    settle(code ? null : new ApiError('denied'), code)
  }
}
export async function login(base) {
  // Fail before opening the browser if the Secret Service tool is missing.
  await exec('secret-tool', ['--help'], { timeout: 5000 }).catch(() => { throw new ApiError('keyring') })
  const metadata = await discover(base)
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url')
  let settle
  const code = new Promise((resolve, reject) => { settle = (error, value) => error ? reject(error) : resolve(value) })
  code.catch(() => {})
  const server = createServer(callbackHandler(state, settle))
  const timer = setTimeout(() => settle(new ApiError('timeout')), 300_000)
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const redirectUri = `http://127.0.0.1:${server.address().port}/callback`
    const registered = await request(metadata.registration_endpoint, { method: 'POST', json: { client_name: 'Literary Universe for Omarchy', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: scopes } })
    if (typeof registered.client_id !== 'string') throw new ApiError('oauth')
    const url = new URL(metadata.authorization_endpoint)
    url.search = new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: redirectUri, scope: scopes, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
    await exec('xdg-open', [url.href], { timeout: 10000 })
    const token = await request(metadata.token_endpoint, { method: 'POST', form: { grant_type: 'authorization_code', code: await code, client_id: registered.client_id, redirect_uri: redirectUri, code_verifier: verifier } })
    await keyring(base, session(registered.client_id, token))
  } finally { clearTimeout(timer); server.closeAllConnections(); server.close() }
}
export async function accessToken(base) {
  let current = await keyring(base)
  if (!current.accessToken || !current.refreshToken || !Number.isFinite(current.expiresAt)) throw new ApiError('signed_out')
  if (current.expiresAt < Date.now() + 60000) {
    const metadata = await discover(base)
    try {
      const token = await request(metadata.token_endpoint, { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: current.refreshToken, client_id: current.clientId } })
      current = session(current.clientId, token)
      await keyring(base, current)
    } catch (error) { if (['invalid_grant', 'signed_out'].includes(error.code)) { await keyring(base, null); throw new ApiError('signed_out') }; throw error }
  }
  return current.accessToken
}
export async function logout(base) {
  const current = await keyring(base)
  const metadata = await discover(base)
  // Preserve the credential on failure so revocation can be retried.
  await request(metadata.revocation_endpoint, { method: 'POST', form: { client_id: current.clientId, token: current.refreshToken, token_type_hint: 'refresh_token' } })
  await keyring(base, null)
}
