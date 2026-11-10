export class ApiError extends Error {
  constructor(code, retryAfter = 0) { super(code); this.code = code; this.retryAfter = retryAfter }
}
export function baseUrl(value = 'https://literaryuniverse.com') {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new ApiError('configuration')
  return url.origin
}
export function destination(base, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\s]/.test(path)) throw new ApiError('destination')
  const url = new URL(path, base)
  if (url.origin !== base) throw new ApiError('destination')
  return url.href
}
export async function request(url, { method = 'GET', token, json, form, signal } = {}) {
  const response = await fetch(url, { method, redirect: 'error', signal: signal ?? AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: json ? JSON.stringify(json) : form ? new URLSearchParams(form) : undefined,
  })
  const body = await bounded(response, 1_000_000)
  if (response.ok && body.length === 0) return {}
  let data
  try { data = JSON.parse(body.toString()) } catch { throw new ApiError('unavailable') }
  if (!response.ok) throw new ApiError(response.status === 401 ? 'signed_out' : response.status === 403 ? 'permission' : response.status === 429 ? 'rate_limited' : data.error || 'unavailable', response.status === 429 ? Math.min(3600, Math.max(1, Number(response.headers.get('Retry-After')) || 60)) : 0)
  return data
}
// Enforce the byte limit while receiving, before anything parses the body.
async function bounded(response, max) {
  const reader = response.body?.getReader(); const chunks = []; let size = 0
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); throw new ApiError('response_too_large') }; chunks.push(value) }
  return Buffer.concat(chunks)
}
/** Width and height from a PNG, JPEG or WebP header, or null for anything else. */
export function imageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR') return [b.readUInt32BE(16), b.readUInt32BE(20)]
  if (b.length > 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = b.toString('latin1', 12, 16)
    if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
    if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1] }
    if (chunk === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1]
    return null
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length && b[i] === 0xff;) {
      const marker = b[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return null
}
/** A cover is remote input: HTTPS only, no redirects, 2 MB, at most 4096 px a side. */
export async function image(url) {
  if (new URL(url).protocol !== 'https:') throw new ApiError('image')
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new ApiError('image')
  const bytes = await bounded(response, 2_000_000)
  const size = imageSize(bytes)
  if (!size || !size.every((n) => n > 0 && n <= 4096)) throw new ApiError('image')
  return bytes
}
