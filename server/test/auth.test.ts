import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '../src/crypto'
import { TOKEN_URL } from '../src/google'
import { call, devLogin, fakeGoogle, json, testEnv } from './helpers'

const realFetch = globalThis.fetch

/** Answers Google's token endpoint with the given ID token; everything else is real. */
function mockGoogleToken(idToken: string | (() => Promise<string>)) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url === TOKEN_URL) {
      const token = typeof idToken === 'string' ? idToken : await idToken()
      return new Response(JSON.stringify({ id_token: token }), { headers: { 'content-type': 'application/json' } })
    }
    return realFetch(input, init)
  })
}

const WEB_RETURN = 'https://web.test/setbook/'

async function startGoogle(query: string) {
  const response = await call(`/v1/auth/google/start?${query}`)
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location') ?? '')
  const state = location.searchParams.get('state') ?? ''
  const row = await testEnv.DB.prepare('SELECT nonce FROM oauth_states WHERE state = ?').bind(state).first<{ nonce: string }>()
  return { location, state, nonce: row?.nonce ?? '' }
}

async function webStart(verifier: string) {
  return startGoogle(`platform=web&challenge=${await sha256(verifier)}&return_to=${encodeURIComponent(WEB_RETURN)}`)
}

afterEach(() => vi.restoreAllMocks())

describe('Google sign-in (web)', () => {
  const verifier = 'w'.repeat(60)

  it('sends the user to Google with PKCE, state and nonce', async () => {
    const { location, state, nonce } = await webStart(verifier)
    expect(location.origin).toBe('https://accounts.google.com')
    expect(location.searchParams.get('client_id')).toBe(testEnv.GOOGLE_CLIENT_ID)
    expect(location.searchParams.get('redirect_uri')).toBe('https://setbook.test/v1/auth/google/callback')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('nonce')).toBe(nonce)
    expect(state).toHaveLength(43)
  })

  it('creates the account on first sign-in and restores it on the next', async () => {
    const google = await fakeGoogle()
    const signIn = async (email: string) => {
      const { state, nonce } = await webStart(verifier)
      mockGoogleToken(() => google.idToken({ sub: 'google-subject-1', email, name: 'Vic', nonce }))
      const callback = await call(`/v1/auth/google/callback?state=${state}&code=abc`)
      vi.restoreAllMocks()
      expect(callback.status).toBe(302)
      const back = new URL(callback.headers.get('location') ?? '')
      expect(`${back.origin}${back.pathname}`).toBe(WEB_RETURN)
      expect(callback.headers.get('set-cookie')).toBeNull()
      const exchange = await call('/v1/auth/exchange', { method: 'POST', body: JSON.stringify({ code: back.searchParams.get('code'), verifier }) })
      expect(exchange.status).toBe(200)
      return json<{ accessToken: string; user: { id: string } }>(exchange)
    }
    const first = await signIn('a@example.com')
    const second = await signIn('changed@example.com')
    expect(second.user.id).toBe(first.user.id)
    expect((await json(await call('/v1/me', { token: second.accessToken }))).id).toBe(first.user.id)
  })

  it.each([
    ['wrong nonce', { nonce: 'not-the-nonce' }, {}],
    ['wrong audience', {}, { audience: 'someone-else' }],
    ['wrong issuer', {}, { issuer: 'https://evil.example' }],
    ['expired token', {}, { expiresIn: '-1m' }],
  ])('rejects an ID token with %s and sends the browser back with an error', async (_, claims, options) => {
    const google = await fakeGoogle()
    const { state, nonce } = await webStart(verifier)
    mockGoogleToken(() => google.idToken({ sub: 'x', nonce, ...claims }, options))
    const callback = await call(`/v1/auth/google/callback?state=${state}&code=abc`)
    const back = new URL(callback.headers.get('location') ?? '')
    expect(back.searchParams.get('error')).toBe('invalid_identity')
    expect(back.searchParams.get('code')).toBeNull()
  })

  it('refuses a reused state', async () => {
    const google = await fakeGoogle()
    const { state, nonce } = await webStart(verifier)
    mockGoogleToken(() => google.idToken({ sub: 'y', nonce }))
    expect((await call(`/v1/auth/google/callback?state=${state}&code=abc`)).status).toBe(302)
    expect((await call(`/v1/auth/google/callback?state=${state}&code=abc`)).status).toBe(400)
  })

  it('only returns to allowed origins', async () => {
    const challenge = await sha256(verifier)
    const evil = await call(`/v1/auth/google/start?platform=web&challenge=${challenge}&return_to=${encodeURIComponent('https://evil.example/')}`)
    expect(evil.status).toBe(400)
  })

  it('explains when Google is not configured', async () => {
    const response = await call(
      `/v1/auth/google/start?platform=web&challenge=${await sha256(verifier)}&return_to=${encodeURIComponent(WEB_RETURN)}`,
      {},
      { GOOGLE_CLIENT_ID: '' },
    )
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe('google_not_configured')
  })

  it('allows API calls from the web origin only', async () => {
    const allowed = await call('/v1/me', { method: 'OPTIONS', headers: { origin: 'https://web.test', 'access-control-request-method': 'GET' } })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://web.test')
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull()
    const denied = await call('/v1/me', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } })
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('Google sign-in (iOS)', () => {
  it('hands the app a one-time code that only its PKCE verifier can redeem', async () => {
    const google = await fakeGoogle()
    const verifier = 'v'.repeat(43) + 'erifier-for-the-ios-app'
    const challenge = await sha256(verifier)
    const { state, nonce } = await startGoogle(`platform=ios&challenge=${challenge}`)
    mockGoogleToken(() => google.idToken({ sub: 'ios-subject', nonce }))
    const callback = await call(`/v1/auth/google/callback?state=${state}&code=abc`)
    vi.restoreAllMocks()
    const redirect = new URL(callback.headers.get('location') ?? '')
    expect(redirect.protocol).toBe('setbook:')
    expect(callback.headers.get('set-cookie')).toBeNull()
    const code = redirect.searchParams.get('code') ?? ''

    const wrong = await call('/v1/auth/exchange', { method: 'POST', body: JSON.stringify({ code, verifier: 'w'.repeat(50) }) })
    expect(wrong.status).toBe(401)
    // A failed attempt burns the code, so a stolen code can't be brute-forced either.
    const right = await call('/v1/auth/exchange', { method: 'POST', body: JSON.stringify({ code, verifier }) })
    expect(right.status).toBe(401)
  })

  it('issues native tokens for the right verifier, once', async () => {
    const google = await fakeGoogle()
    const verifier = 'a'.repeat(64)
    const { state, nonce } = await startGoogle(`platform=ios&challenge=${await sha256(verifier)}`)
    mockGoogleToken(() => google.idToken({ sub: 'ios-subject-2', nonce }))
    const callback = await call(`/v1/auth/google/callback?state=${state}&code=abc`)
    vi.restoreAllMocks()
    const code = new URL(callback.headers.get('location') ?? '').searchParams.get('code') ?? ''
    const exchange = await call('/v1/auth/exchange', { method: 'POST', body: JSON.stringify({ code, verifier }) })
    expect(exchange.status).toBe(200)
    const tokens = await json(exchange)
    expect(tokens.refreshToken).toHaveLength(43)
    expect((await call('/v1/me', { token: tokens.accessToken })).status).toBe(200)
    expect((await call('/v1/auth/exchange', { method: 'POST', body: JSON.stringify({ code, verifier }) })).status).toBe(401)
  })

  it('requires a well-formed challenge', async () => {
    expect((await call('/v1/auth/google/start?platform=ios&challenge=short')).status).toBe(400)
  })
})

describe('sessions', () => {
  it('rotates refresh tokens and revokes the family when an old one is replayed', async () => {
    const first = await devLogin('rotator')
    const rotated = await call('/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: first.refreshToken }) })
    expect(rotated.status).toBe(200)
    const second = await json(rotated)
    expect(second.refreshToken).not.toBe(first.refreshToken)

    const replay = await call('/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: first.refreshToken }) })
    expect(replay.status).toBe(401)
    const afterTheft = await call('/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: second.refreshToken }) })
    expect(afterTheft.status).toBe(401)
  })

  it('stores only hashes of refresh tokens', async () => {
    const tokens = await devLogin('hasher')
    const raw = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE refresh_hash = ?').bind(tokens.refreshToken).first<{ n: number }>()
    const hashed = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE refresh_hash = ?').bind(await sha256(tokens.refreshToken)).first<{ n: number }>()
    expect(raw?.n).toBe(0)
    expect(hashed?.n).toBe(1)
  })

  it('logout revokes the refresh token', async () => {
    const tokens = await devLogin('leaver')
    expect((await call('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: tokens.refreshToken }) })).status).toBe(204)
    expect((await call('/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: tokens.refreshToken }) })).status).toBe(401)
  })

  it('rejects missing, garbage and tampered access tokens', async () => {
    const tokens = await devLogin('checker')
    expect((await call('/v1/me')).status).toBe(401)
    expect((await call('/v1/me', { token: 'garbage' })).status).toBe(401)
    const [header, payload, signature] = tokens.accessToken.split('.')
    const forged = JSON.parse(atob((payload ?? '').replaceAll('-', '+').replaceAll('_', '/')))
    forged.sub = 'someone-else'
    const forgedPayload = btoa(JSON.stringify(forged)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    expect((await call('/v1/me', { token: `${header}.${forgedPayload}.${signature}` })).status).toBe(401)
  })

  it('dev sign-in does not exist unless explicitly enabled', async () => {
    const response = await call('/v1/auth/dev', { method: 'POST', body: JSON.stringify({ name: 'x' }) }, { DEV_AUTH: 'false' })
    expect(response.status).toBe(404)
  })
})
