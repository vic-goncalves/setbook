import { Hono } from 'hono'
import { z } from 'zod'
import { parse } from './auth'
import { nowIso } from './crypto'
import type { AppBindings } from './env'
import { HttpError } from './errors'

/**
 * Saved Coach conversations. The browser owns the content and saves the whole conversation
 * after each turn (last write wins: one person, and a chat is only ever open in one place at
 * a time). The server stores it as given; it only checks shape and size.
 */

const MAX_BODY_CHARS = 900_000
const LIST_LIMIT = 100

const uuid = z.string().regex(/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/, 'Expected a UUID')
const chatSchema = z.object({
  title: z.string().trim().min(1).max(200),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.array(z.unknown()) }).passthrough()).max(400),
  decisions: z.record(z.enum(['approved', 'declined', 'failed'])).default({}),
})

export const chats = new Hono<AppBindings>()

chats.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, title, created_at, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
    .bind(c.get('auth').userId, LIST_LIMIT)
    .all<{ id: string; title: string; created_at: string; updated_at: string }>()
  return c.json({ chats: results.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at })) })
})

chats.get('/:id', async (c) => {
  const id = parse(uuid, c.req.param('id')).toUpperCase()
  const row = await c.env.DB.prepare('SELECT title, body, created_at, updated_at FROM chats WHERE user_id = ? AND id = ?')
    .bind(c.get('auth').userId, id)
    .first<{ title: string; body: string; created_at: string; updated_at: string }>()
  if (!row) throw new HttpError(404, 'not_found', 'That chat no longer exists.')
  const body = JSON.parse(row.body) as { messages: unknown[]; decisions: Record<string, string> }
  return c.json({ id, title: row.title, messages: body.messages, decisions: body.decisions, createdAt: row.created_at, updatedAt: row.updated_at })
})

chats.put('/:id', async (c) => {
  const id = parse(uuid, c.req.param('id')).toUpperCase()
  const raw = await c.req.text()
  if (raw.length > MAX_BODY_CHARS) throw new HttpError(413, 'chat_too_long', 'This chat is too long to save. Start a new one.')
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'invalid_request', 'Request body must be JSON.')
  }
  const chat = parse(chatSchema, json)
  const now = nowIso()
  await c.env.DB.prepare(
    `INSERT INTO chats (user_id, id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, id) DO UPDATE SET title = excluded.title, body = excluded.body, updated_at = excluded.updated_at`,
  )
    .bind(c.get('auth').userId, id, chat.title, JSON.stringify({ messages: chat.messages, decisions: chat.decisions }), now, now)
    .run()
  return c.json({ id, updatedAt: now })
})

chats.delete('/:id', async (c) => {
  const id = parse(uuid, c.req.param('id')).toUpperCase()
  await c.env.DB.prepare('DELETE FROM chats WHERE user_id = ? AND id = ?').bind(c.get('auth').userId, id).run()
  return c.body(null, 204)
})
