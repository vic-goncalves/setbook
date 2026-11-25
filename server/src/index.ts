import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { account } from './account'
import { allowedOrigins, auth, requireAuth } from './auth'
import type { AppBindings } from './env'
import { HttpError, renderError } from './errors'
import { sync } from './sync'

const app = new Hono<AppBindings>()

app.onError(renderError)
// The web app is served from GitHub Pages, a different origin. Tokens travel in the
// Authorization header, never cookies, so credentials stay off.
app.use('/v1/*', async (c, next) =>
  cors({ origin: allowedOrigins(c.env), allowHeaders: ['authorization', 'content-type'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'], maxAge: 86400 })(c, next),
)
app.use('/v1/*', async (c, next) => {
  await next()
  c.header('cache-control', 'no-store')
  c.header('x-content-type-options', 'nosniff')
})

app.get('/v1/health', (c) => c.json({ ok: true }))
app.route('/v1/auth', auth)

app.use('/v1/*', requireAuth)
app.route('/v1', account)
app.route('/v1/sync', sync)

app.all('/v1/*', () => {
  throw new HttpError(404, 'not_found', 'Not found.')
})

export default app
