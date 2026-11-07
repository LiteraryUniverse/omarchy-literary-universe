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
  const reader = response.body?.getReader(); const chunks = []; let size = 0
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1_000_000) { await reader.cancel(); throw new ApiError('response_too_large') }; chunks.push(value) }
  if (response.ok && size === 0) return {}
  let data
  try { data = JSON.parse(Buffer.concat(chunks).toString()) } catch { throw new ApiError('unavailable') }
  if (!response.ok) throw new ApiError(response.status === 401 ? 'signed_out' : response.status === 403 ? 'permission' : response.status === 429 ? 'rate_limited' : data.error || 'unavailable', response.status === 429 ? Math.min(3600, Math.max(1, Number(response.headers.get('Retry-After')) || 60)) : 0)
  return data
}
