export interface Env {
  DB: D1Database
  APP_ORIGIN: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SIGNING_KEY: string
  DEV_AUTH: string
  /** Comma-separated origins allowed to call the API from a browser and receive sign-in redirects. */
  WEB_ORIGINS: string
  /** Secret. Without it, POST /v1/chat answers 503. */
  ANTHROPIC_API_KEY?: string
  /** Model for the in-app coach; defaults to DEFAULT_CHAT_MODEL in chat.ts. */
  CHAT_MODEL?: string
  /** Local development only (ignored unless DEV_AUTH is "true"): a stand-in for the Anthropic API. */
  ANTHROPIC_BASE_URL?: string
}

export interface AuthContext {
  userId: string
  sessionId: string
}

export type AppBindings = { Bindings: Env; Variables: { auth: AuthContext } }
