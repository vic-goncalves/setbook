import { env } from 'cloudflare:test'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import app from '../src/index'
import type { Env } from '../src/env'
import { setJwksForTesting } from '../src/google'

export const testEnv = env as unknown as Env

export async function call(path: string, init: RequestInit & { token?: string } = {}, overrides: Partial<Env> = {}) {
  const headers = new Headers(init.headers)
  if (init.token) headers.set('authorization', `Bearer ${init.token}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return app.fetch(new Request(`https://setbook.test${path}`, { ...init, headers, redirect: 'manual' }), { ...testEnv, ...overrides })
}

export async function json<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/** Signs in through the dev endpoint and returns native-style tokens. */
export async function devLogin(name: string) {
  const response = await call('/v1/auth/dev', { method: 'POST', body: JSON.stringify({ name }) })
  if (response.status !== 200) throw new Error(`dev login failed: ${response.status}`)
  return json<{ accessToken: string; refreshToken: string; user: { id: string } }>(response)
}

/** A stand-in for Google: a local signing key whose public half the server trusts in tests. */
export async function fakeGoogle() {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256' }
  setJwksForTesting(createLocalJWKSet({ keys: [jwk] }))
  return {
    idToken(claims: Record<string, unknown>, options: { audience?: string; issuer?: string; expiresIn?: string } = {}) {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(options.issuer ?? 'https://accounts.google.com')
        .setAudience(options.audience ?? testEnv.GOOGLE_CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? '5m')
        .sign(privateKey)
    },
  }
}

export function uuid() {
  return crypto.randomUUID().toUpperCase()
}

export const BENCH = '1E745624-563E-59EB-8458-DD9D29D3CC25'

export function template(id = uuid(), exerciseId = BENCH) {
  const now = new Date().toISOString()
  return {
    id,
    name: 'Push',
    revision: 1,
    exercises: [{ id: uuid(), exerciseId, restSeconds: 90, sets: [{ id: uuid(), type: 'working', targetReps: { min: 5, max: 8 } }] }],
    createdAt: now,
    updatedAt: now,
  }
}

export function session(overrides: Record<string, unknown> = {}, setOverrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  return {
    id: uuid(),
    name: 'Push',
    state: 'completed',
    startedAt: now,
    finishedAt: now,
    timeZoneIdentifier: 'UTC',
    exercises: [
      {
        id: uuid(),
        exerciseId: BENCH,
        exerciseName: 'Bench Press (Barbell)',
        measurement: { type: 'external_load_reps', loadConvention: 'total' },
        restSeconds: 90,
        sets: [{ id: uuid(), type: 'working', load: { value: 100, unit: 'kg' }, reps: 5, completedAt: now, ...setOverrides }],
      },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function push(token: string, mutations: object[]) {
  const response = await call('/v1/sync/push', { method: 'POST', token, body: JSON.stringify({ mutations }) })
  return { status: response.status, body: await json(response) }
}

export function mutation(entity: string, body: { id: string; [key: string]: unknown } | null, baseRevision = 0, extra: object = {}) {
  return { mutationId: crypto.randomUUID(), entity, id: body?.id ?? uuid(), baseRevision, body: body ?? undefined, deleted: body === null, ...extra }
}
