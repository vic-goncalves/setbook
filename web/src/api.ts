import type { Entity } from './domain/types'

export const API_ORIGIN: string = (import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:8787').replace(/\/$/, '')
export const DEV_AUTH = import.meta.env.VITE_DEV_AUTH === 'true'

export interface User {
  id: string
  displayName: string | null
  email: string | null
  massUnit: 'kg' | 'lb' | null
}

interface Session {
  accessToken: string
  refreshToken: string
  expiresAt: number
  user: User
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const SESSION_KEY = 'setbook.session'
const VERIFIER_KEY = 'setbook.pkce'

let session: Session | null = readSession()
let refreshing: Promise<Session> | null = null
const signedOutListeners = new Set<() => void>()

function readSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null
  } catch {
    return null
  }
}

function writeSession(next: Session | null) {
  session = next
  if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next))
  else localStorage.removeItem(SESSION_KEY)
}

export function currentUser(): User | null {
  return session?.user ?? null
}

export function onSignedOut(listener: () => void) {
  signedOutListeners.add(listener)
  return () => signedOutListeners.delete(listener)
}

// MARK: Sign-in (Google with PKCE; the same flow as the iPhone app)

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export async function startGoogleSignIn() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)))
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const returnTo = `${location.origin}${location.pathname}`
  const url = new URL(`${API_ORIGIN}/v1/auth/google/start`)
  url.search = new URLSearchParams({ platform: 'web', challenge, return_to: returnTo }).toString()
  location.assign(url.toString())
}

const signInErrors: Record<string, string> = {
  google_not_configured: "Google sign-in isn't set up on the server yet. See the README's Google step.",
  access_denied: 'Sign-in was cancelled.',
  invalid_identity: "Google sign-in couldn't be verified. Try again.",
}

/** Finishes sign-in when Google sends the browser back with ?code=. Returns true if signed in. */
export async function completeSignInFromUrl(): Promise<boolean> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const error = params.get('error')
  if (!code && !error) return false
  history.replaceState(null, '', `${location.pathname}${location.hash}`)
  if (error) throw new ApiError(401, error, signInErrors[error] ?? `Sign-in didn't complete (${error}).`)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  if (!verifier) throw new ApiError(401, 'missing_verifier', 'Sign-in expired. Try again.')
  adopt(await post('/v1/auth/exchange', { code, verifier }))
  return true
}

export async function devSignIn(name: string) {
  adopt(await post('/v1/auth/dev', { name }))
}

export async function signOut() {
  const refreshToken = session?.refreshToken
  writeSession(null)
  if (refreshToken) await post('/v1/auth/logout', { refreshToken }).catch(() => undefined)
}

function adopt(response: unknown) {
  const r = response as { accessToken: string; refreshToken: string; expiresIn: number; user: User }
  writeSession({ accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: Date.now() + (r.expiresIn - 30) * 1000, user: r.user })
}

// MARK: Requests

async function post(path: string, body: unknown) {
  return send('POST', path, body, undefined)
}

async function send(method: string, path: string, body: unknown, token: string | undefined): Promise<unknown> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 204) return null
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.code ?? `http_${response.status}`, data?.error?.message ?? `Request failed (${response.status}).`)
  }
  return data
}

async function refresh(): Promise<Session> {
  refreshing ??= (async () => {
    try {
      const stale = session
      if (!stale) throw new ApiError(401, 'signed_out', 'Sign in to continue.')
      adopt(await post('/v1/auth/refresh', { refreshToken: stale.refreshToken }))
      return session as Session
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        writeSession(null)
        signedOutListeners.forEach((l) => l())
      }
      throw error
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  if (!session) throw new ApiError(401, 'signed_out', 'Sign in to continue.')
  let current = session.expiresAt > Date.now() ? session : await refresh()
  try {
    return (await send(method, path, body, current.accessToken)) as T
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    current = await refresh()
    return (await send(method, path, body, current.accessToken)) as T
  }
}

/**
 * A signed-in POST whose response body is read as a stream (the chat). Refreshes the access
 * token first if needed; errors before the stream starts are thrown like `api()` errors.
 */
export async function apiStream(path: string, body: unknown, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  if (!session) throw new ApiError(401, 'signed_out', 'Sign in to continue.')
  const open = (token: string) =>
    fetch(`${API_ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal })
  let response = await open(session.expiresAt > Date.now() ? session.accessToken : (await refresh()).accessToken)
  if (response.status === 401) response = await open((await refresh()).accessToken)
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null)
    throw new ApiError(response.status, data?.error?.code ?? `http_${response.status}`, data?.error?.message ?? `Request failed (${response.status}).`)
  }
  return response.body
}

export async function updateProfile(patch: Partial<Pick<User, 'displayName' | 'massUnit'>>) {
  const user = await api<User>('PATCH', '/v1/me', patch)
  if (session) writeSession({ ...session, user })
  return user
}

export async function deleteAccount() {
  await api('DELETE', '/v1/me')
  writeSession(null)
}

export async function download(path: string, filename: string) {
  if (!session) return
  const token = session.expiresAt > Date.now() ? session.accessToken : (await refresh()).accessToken
  const response = await fetch(`${API_ORIGIN}${path}`, { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) throw new ApiError(response.status, 'export_failed', 'Export failed.')
  const url = URL.createObjectURL(await response.blob())
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  link.click()
  URL.revokeObjectURL(url)
}

// MARK: Sync wire types

export interface Mutation {
  mutationId: string
  entity: Entity
  id: string
  baseRevision: number
  deleted: boolean
  body?: unknown
}

export interface StoredRecord {
  revision: number
  deleted: boolean
  body: unknown
}

export type MutationResult =
  | { mutationId: string; status: 'applied'; revision: number }
  | { mutationId: string; status: 'conflict'; reason: string; current: StoredRecord | null }
  | { mutationId: string; status: 'rejected'; error: { message: string } }

export interface PullPage {
  changes: ({ entity: Entity; id: string } & StoredRecord)[]
  cursor: number
  hasMore: boolean
}
