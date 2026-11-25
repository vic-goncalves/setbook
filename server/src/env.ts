export interface Env {
  DB: D1Database
  APP_ORIGIN: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SIGNING_KEY: string
  DEV_AUTH: string
  /** Comma-separated origins allowed to call the API from a browser and receive sign-in redirects. */
  WEB_ORIGINS: string
}

export interface AuthContext {
  userId: string
  sessionId: string
}

export type AppBindings = { Bindings: Env; Variables: { auth: AuthContext } }
