import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { Env } from './env'
import { HttpError } from './errors'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

let jwks: JWTVerifyGetKey | undefined

export function redirectUri(env: Env): string {
  return `${env.APP_ORIGIN}/v1/auth/google/callback`
}

export function authorizationUrl(env: Env, params: { state: string; nonce: string; codeChallenge: string }): string {
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: 'openid email profile',
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return url.toString()
}

export interface GoogleIdentity {
  subject: string
  email?: string
  name?: string
}

/**
 * Exchanges the authorization code and verifies the returned ID token's signature, issuer,
 * audience, expiry and nonce using jose against Google's published keys.
 */
export async function exchangeCode(env: Env, code: string, codeVerifier: string, expectedNonce: string): Promise<GoogleIdentity> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(500, 'misconfigured', 'Google sign-in is not configured on this server.')
  }
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(env),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  })
  if (!response.ok) throw new HttpError(401, 'google_exchange_failed', 'Google sign-in failed. Try again.')
  const { id_token: idToken } = (await response.json()) as { id_token?: string }
  if (!idToken) throw new HttpError(401, 'google_exchange_failed', 'Google did not return an identity.')

  jwks ??= createRemoteJWKSet(new URL(JWKS_URL))
  try {
    const { payload } = await jwtVerify(idToken, jwks, { issuer: ISSUERS, audience: env.GOOGLE_CLIENT_ID })
    if (payload.nonce !== expectedNonce) throw new Error('nonce mismatch')
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('missing subject')
    return {
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    }
  } catch {
    throw new HttpError(401, 'invalid_identity', 'Google sign-in could not be verified.')
  }
}

/** Test hook: lets tests point verification at a local key set. */
export function setJwksForTesting(keys: JWTVerifyGetKey | undefined) {
  jwks = keys
}
