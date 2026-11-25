import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Thrown anywhere in a handler; rendered as `{ error: { code, message } }`. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export function renderError(error: unknown, c: Context) {
  if (error instanceof HttpError) {
    return c.json({ error: { code: error.code, message: error.message, details: error.details } }, error.status)
  }
  console.error('Unhandled error', error)
  return c.json({ error: { code: 'internal', message: 'Something went wrong.' } }, 500)
}
