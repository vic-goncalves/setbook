import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { AppBindings, Env } from './env'
import { addSeconds, nowIso, randomToken, safeEqual, sha256 } from './crypto'
import { HttpError } from './errors'
import { authorizationUrl, exchangeCode } from './google'
import {
  createSession,
  findOrCreateUser,
  revokeByRefreshToken,
  rotateSession,
  verifyAccessToken,
} from './sessions'

export const IOS_REDIRECT = 'setbook://auth'
const STATE_SECONDS = 10 * 60
const LOGIN_CODE_SECONDS = 120

export const auth = new Hono<AppBindings>()

/**
 * Begins Google sign-in. Both clients use the same flow: they keep a PKCE verifier, send its
 * S256 `challenge`, and later redeem a one-time code with it. The web app also says where to
 * return to, which must be on an allowed origin.
 */
auth.get('/google/start', async (c) => {
  const platform = c.req.query('platform') === 'web' ? 'web' : 'ios'
  const appChallenge = c.req.query('challenge')
  if (!appChallenge?.match(/^[A-Za-z0-9_-]{43}$/)) throw new HttpError(400, 'invalid_request', 'Missing or invalid PKCE challenge.')
  let returnTo: string = IOS_REDIRECT
  if (platform === 'web') {
    returnTo = c.req.query('return_to') ?? ''
    if (!isAllowedReturn(c.env, returnTo)) throw new HttpError(400, 'invalid_request', 'That return address is not allowed.')
  }
  if (!c.env.GOOGLE_CLIENT_ID) return failedRedirect(returnTo, 'google_not_configured')
  const state = randomToken()
  const nonce = randomToken()
  const codeVerifier = randomToken(48)
  await c.env.DB.prepare(
    'INSERT INTO oauth_states (state, nonce, code_verifier, platform, app_challenge, return_to, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(state, nonce, codeVerifier, platform, appChallenge, returnTo, addSeconds(STATE_SECONDS))
    .run()
  return c.redirect(authorizationUrl(c.env, { state, nonce, codeChallenge: await sha256(codeVerifier) }))
})

auth.get('/google/callback', async (c) => {
  const state = c.req.query('state')
  const code = c.req.query('code')
  if (!state) throw new HttpError(400, 'invalid_request', 'Missing state.')
  const row = await c.env.DB.prepare('DELETE FROM oauth_states WHERE state = ? RETURNING nonce, code_verifier, app_challenge, return_to, expires_at')
    .bind(state)
    .first<{ nonce: string; code_verifier: string; app_challenge: string; return_to: string; expires_at: string }>()
  if (!row || row.expires_at < nowIso()) throw new HttpError(400, 'invalid_state', 'This sign-in link expired. Start again.')
  if (!code) return failedRedirect(row.return_to, c.req.query('error') ?? 'cancelled')

  let userId: string
  try {
    const identity = await exchangeCode(c.env, code, row.code_verifier, row.nonce)
    userId = await findOrCreateUser(c.env, 'google', identity.subject, identity)
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return failedRedirect(row.return_to, error.code)
    throw error
  }
  const loginCode = randomToken()
  await c.env.DB.prepare('INSERT INTO login_codes (code_hash, user_id, app_challenge, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(loginCode), userId, row.app_challenge, addSeconds(LOGIN_CODE_SECONDS))
    .run()
  return c.redirect(withQuery(row.return_to, { code: loginCode }))
})

/** The client redeems the one-time code together with its PKCE verifier. */
auth.post('/exchange', async (c) => {
  const { code, verifier } = parse(z.object({ code: z.string().min(1), verifier: z.string().min(43).max(128) }), await c.req.json())
  const row = await c.env.DB.prepare(
    'UPDATE login_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL RETURNING user_id, app_challenge, expires_at',
  )
    .bind(nowIso(), await sha256(code))
    .first<{ user_id: string; app_challenge: string; expires_at: string }>()
  if (!row || row.expires_at < nowIso() || !safeEqual(await sha256(verifier), row.app_challenge)) {
    throw new HttpError(401, 'invalid_code', 'This sign-in code is invalid or expired.')
  }
  return c.json(await createSession(c.env, row.user_id, 'ios'))
})

auth.post('/refresh', async (c) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string().min(1) }), await c.req.json())
  return c.json(await rotateSession(c.env, refreshToken))
})

auth.post('/logout', async (c) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string().min(1) }), await c.req.json())
  await revokeByRefreshToken(c.env, refreshToken)
  return c.body(null, 204)
})

/** Local development only: sign in as a named test user without Google. */
auth.post('/dev', async (c) => {
  if (c.env.DEV_AUTH !== 'true') throw new HttpError(404, 'not_found', 'Not found.')
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(50) }), await c.req.json())
  const userId = await findOrCreateUser(c.env, 'dev', name.toLowerCase(), { name })
  return c.json(await createSession(c.env, userId, 'dev'))
})

/** Requires a valid access token and attaches the verified user. Identity never comes from the body. */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const header = c.req.header('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to continue.')
  c.set('auth', await verifyAccessToken(c.env, token))
  await next()
}

/** True when `url` is on one of the configured web origins. */
export function isAllowedReturn(env: Env, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return allowedOrigins(env).includes(parsed.origin)
}

export function allowedOrigins(env: Env): string[] {
  return (env.WEB_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
}

function withQuery(url: string, params: Record<string, string>): string {
  const target = new URL(url)
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
  return target.toString()
}

function failedRedirect(returnTo: string, reason: string) {
  return new Response(null, { status: 302, headers: { location: withQuery(returnTo, { error: reason }) } })
}

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new HttpError(400, 'invalid_request', 'The request is invalid.', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  }
  return result.data
}

export type { Env }
