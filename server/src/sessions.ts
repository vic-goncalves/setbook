import { SignJWT, jwtVerify } from 'jose'
import type { AuthContext, Env } from './env'
import { addSeconds, nowIso, randomToken, sha256 } from './crypto'
import { HttpError } from './errors'

export const ACCESS_TOKEN_SECONDS = 15 * 60
export const REFRESH_TOKEN_SECONDS = 60 * 60 * 24 * 60
const ISSUER = 'setbook'

export type Client = 'web' | 'ios' | 'dev'

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: PublicUser
}

export interface PublicUser {
  id: string
  displayName: string | null
  email: string | null
  massUnit: 'kg' | 'lb' | null
}

function signingKey(env: Env): Uint8Array {
  if (!env.SESSION_SIGNING_KEY || env.SESSION_SIGNING_KEY.length < 32) {
    throw new HttpError(500, 'misconfigured', 'SESSION_SIGNING_KEY must be set to at least 32 characters.')
  }
  return new TextEncoder().encode(env.SESSION_SIGNING_KEY)
}

export async function signAccessToken(env: Env, userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
    .sign(signingKey(env))
}

export async function verifyAccessToken(env: Env, token: string): Promise<AuthContext> {
  try {
    const { payload } = await jwtVerify(token, signingKey(env), { issuer: ISSUER, algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('claims')
    return { userId: payload.sub, sessionId: payload.sid }
  } catch {
    throw new HttpError(401, 'unauthorized', 'Your session has expired. Sign in again.')
  }
}

export async function publicUser(env: Env, userId: string): Promise<PublicUser> {
  const row = await env.DB.prepare('SELECT id, display_name, email, mass_unit FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; display_name: string | null; email: string | null; mass_unit: 'kg' | 'lb' | null }>()
  if (!row) throw new HttpError(401, 'unauthorized', 'This account no longer exists.')
  return { id: row.id, displayName: row.display_name, email: row.email, massUnit: row.mass_unit }
}

/** Starts a new refresh-token family (a fresh sign-in). */
export async function createSession(env: Env, userId: string, client: Client): Promise<IssuedTokens> {
  return issue(env, userId, client, crypto.randomUUID())
}

async function issue(env: Env, userId: string, client: Client, familyId: string): Promise<IssuedTokens> {
  const sessionId = crypto.randomUUID()
  const refreshToken = randomToken()
  await env.DB.prepare(
    `INSERT INTO auth_sessions (id, user_id, family_id, refresh_hash, expires_at, created_at, client)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, userId, familyId, await sha256(refreshToken), addSeconds(REFRESH_TOKEN_SECONDS), nowIso(), client)
    .run()
  return {
    accessToken: await signAccessToken(env, userId, sessionId),
    refreshToken,
    expiresIn: ACCESS_TOKEN_SECONDS,
    user: await publicUser(env, userId),
  }
}

/**
 * Exchanges a refresh token for a new pair. Each refresh token works once: presenting one
 * that was already rotated means it leaked, so the whole family is revoked.
 */
export async function rotateSession(env: Env, refreshToken: string): Promise<IssuedTokens> {
  const row = await env.DB.prepare(
    'SELECT id, user_id, family_id, expires_at, rotated_at, revoked_at, client FROM auth_sessions WHERE refresh_hash = ?',
  )
    .bind(await sha256(refreshToken))
    .first<{ id: string; user_id: string; family_id: string; expires_at: string; rotated_at: string | null; revoked_at: string | null; client: Client }>()
  if (!row) throw new HttpError(401, 'unauthorized', 'Sign in again.')
  if (row.rotated_at || row.revoked_at) {
    await revokeFamily(env, row.family_id)
    throw new HttpError(401, 'unauthorized', 'Sign in again.')
  }
  if (row.expires_at < nowIso()) throw new HttpError(401, 'unauthorized', 'Sign in again.')

  // Mark rotated only if nobody else just did; a lost race means a concurrent reuse.
  const marked = await env.DB.prepare('UPDATE auth_sessions SET rotated_at = ? WHERE id = ? AND rotated_at IS NULL AND revoked_at IS NULL')
    .bind(nowIso(), row.id)
    .run()
  if (marked.meta.changes !== 1) {
    await revokeFamily(env, row.family_id)
    throw new HttpError(401, 'unauthorized', 'Sign in again.')
  }
  return issue(env, row.user_id, row.client, row.family_id)
}

export async function revokeByRefreshToken(env: Env, refreshToken: string): Promise<void> {
  const row = await env.DB.prepare('SELECT family_id FROM auth_sessions WHERE refresh_hash = ?')
    .bind(await sha256(refreshToken))
    .first<{ family_id: string }>()
  if (row) await revokeFamily(env, row.family_id)
}

async function revokeFamily(env: Env, familyId: string): Promise<void> {
  await env.DB.prepare('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?').bind(nowIso(), familyId).run()
}

/** Finds the user for a provider identity, creating both on first sign-in. Never keyed by email. */
export async function findOrCreateUser(
  env: Env,
  provider: string,
  subject: string,
  profile: { email?: string; name?: string },
): Promise<string> {
  const existing = await env.DB.prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?')
    .bind(provider, subject)
    .first<{ user_id: string }>()
  if (existing) return existing.user_id

  const userId = crypto.randomUUID()
  const now = nowIso()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, display_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(
      userId,
      profile.name ?? null,
      profile.email ?? null,
      now,
      now,
    ),
    env.DB.prepare('INSERT INTO auth_identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      provider,
      subject,
      userId,
      profile.email ?? null,
      now,
    ),
  ])
  return userId
}
