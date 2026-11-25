const encoder = new TextEncoder()

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256(value: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

/** Constant-time comparison for equal-length strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function addSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}
