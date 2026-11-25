import { Hono } from 'hono'
import { z } from 'zod'
import { parse } from './auth'
import { nowIso } from './crypto'
import type { AppBindings, Env } from './env'
import { HttpError } from './errors'
import { bodySchemas, entities, isBuiltInExercise, referencedExerciseIds, type Entity } from './records'

const MAX_MUTATIONS = 100
const PULL_LIMIT = 500

const mutationSchema = z.object({
  mutationId: z.string().min(8).max(64),
  entity: z.enum(entities),
  id: z.string().min(1).max(64),
  baseRevision: z.number().int().min(0),
  deleted: z.boolean().default(false),
  body: z.unknown().optional(),
})
type Mutation = z.infer<typeof mutationSchema>

export interface StoredRecord {
  revision: number
  deleted: boolean
  body: unknown
}

export type MutationResult =
  | { mutationId: string; status: 'applied'; revision: number }
  | { mutationId: string; status: 'conflict'; reason: 'stale' | 'active_exists'; current: StoredRecord | null }
  | { mutationId: string; status: 'rejected'; error: { code: string; message: string; details?: unknown } }

export const sync = new Hono<AppBindings>()

/**
 * Applies whole-record writes in order. Each one names the revision it was based on; a
 * mismatch is reported as a conflict with the server's copy and nothing is overwritten.
 * Retrying a mutation ID returns the original result instead of writing twice.
 */
sync.post('/push', async (c) => {
  const { mutations } = parse(z.object({ mutations: z.array(mutationSchema).max(MAX_MUTATIONS) }), await c.req.json())
  const results: MutationResult[] = []
  for (const mutation of mutations) {
    results.push(await apply(c.env, c.get('auth').userId, mutation))
  }
  return c.json({ results })
})

sync.get('/pull', async (c) => {
  const cursor = Number(c.req.query('cursor') ?? '0')
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new HttpError(400, 'invalid_request', 'Invalid cursor.')
  const { results } = await c.env.DB.prepare(
    `SELECT r.entity, r.id, r.revision, r.deleted, r.body, MAX(c.seq) AS seq
     FROM changes c JOIN records r ON r.user_id = c.user_id AND r.entity = c.entity AND r.id = c.id
     WHERE c.user_id = ? AND c.seq > ?
     GROUP BY r.entity, r.id
     ORDER BY seq
     LIMIT ?`,
  )
    .bind(c.get('auth').userId, cursor, PULL_LIMIT)
    .all<{ entity: Entity; id: string; revision: number; deleted: number; body: string | null; seq: number }>()
  const changes = results.map((row) => ({
    entity: row.entity,
    id: row.id,
    revision: row.revision,
    deleted: row.deleted === 1,
    body: row.body === null ? null : JSON.parse(row.body),
  }))
  const last = results.at(-1)
  return c.json({ changes, cursor: last ? last.seq : cursor, hasMore: results.length === PULL_LIMIT })
})

export async function apply(env: Env, userId: string, mutation: Mutation): Promise<MutationResult> {
  const { mutationId } = mutation
  const id = mutation.id.toUpperCase()

  const previous = await env.DB.prepare('SELECT response FROM mutations WHERE user_id = ? AND mutation_id = ?')
    .bind(userId, mutationId)
    .first<{ response: string }>()
  if (previous) return JSON.parse(previous.response) as MutationResult

  let bodyText: string | null = null
  if (!mutation.deleted) {
    const parsed = bodySchemas[mutation.entity].safeParse(mutation.body)
    if (!parsed.success) {
      return reject(mutationId, 'invalid_record', 'The record is invalid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
    }
    const body = parsed.data as { id: string }
    if (body.id.toUpperCase() !== id) return reject(mutationId, 'invalid_record', 'Record ID does not match.')
    if (mutation.entity === 'exercise' && isBuiltInExercise(id)) return reject(mutationId, 'invalid_record', 'Built-in exercises are read-only.')
    const missing = await missingExercises(env, userId, referencedExerciseIds(mutation.entity, body))
    if (missing.length > 0) return reject(mutationId, 'unknown_exercise', 'The record references exercises that do not exist.', missing)
    bodyText = JSON.stringify(mutation.body)
  }

  const current = await readRecord(env, userId, mutation.entity, id)
  const currentRevision = current?.revision ?? 0
  if (mutation.baseRevision !== currentRevision) {
    return { mutationId, status: 'conflict', reason: 'stale', current }
  }

  if (mutation.entity === 'session' && !mutation.deleted && (mutation.body as { state?: string }).state === 'active') {
    const other = await env.DB.prepare(
      `SELECT id FROM records WHERE user_id = ? AND entity = 'session' AND deleted = 0 AND id != ?
       AND json_extract(body, '$.state') = 'active' LIMIT 1`,
    )
      .bind(userId, id)
      .first<{ id: string }>()
    if (other) {
      return { mutationId, status: 'conflict', reason: 'active_exists', current: await readRecord(env, userId, 'session', other.id) }
    }
  }

  const revision = currentRevision + 1
  const result: MutationResult = { mutationId, status: 'applied', revision }
  const now = nowIso()
  try {
    // One atomic batch. The guard aborts everything if the revision moved since we read it.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO revision_guard (must_not_be_null)
         SELECT NULL WHERE COALESCE((SELECT revision FROM records WHERE user_id = ? AND entity = ? AND id = ?), 0) != ?`,
      ).bind(userId, mutation.entity, id, currentRevision),
      env.DB.prepare(
        `INSERT INTO records (user_id, entity, id, revision, deleted, body, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, entity, id) DO UPDATE SET
           revision = excluded.revision, deleted = excluded.deleted, body = excluded.body, updated_at = excluded.updated_at`,
      ).bind(userId, mutation.entity, id, revision, mutation.deleted ? 1 : 0, bodyText, now),
      env.DB.prepare('INSERT INTO changes (user_id, entity, id, revision) VALUES (?, ?, ?, ?)').bind(userId, mutation.entity, id, revision),
      env.DB.prepare('INSERT INTO mutations (user_id, mutation_id, response, created_at) VALUES (?, ?, ?, ?)').bind(
        userId,
        mutationId,
        JSON.stringify(result),
        now,
      ),
    ])
  } catch (error) {
    // Either the guard fired (a concurrent write won) or this mutation ID was just applied
    // by a concurrent retry. Re-read and report whichever happened.
    const replay = await env.DB.prepare('SELECT response FROM mutations WHERE user_id = ? AND mutation_id = ?')
      .bind(userId, mutationId)
      .first<{ response: string }>()
    if (replay) return JSON.parse(replay.response) as MutationResult
    if (String(error).includes('NOT NULL')) {
      return { mutationId, status: 'conflict', reason: 'stale', current: await readRecord(env, userId, mutation.entity, id) }
    }
    throw error
  }
  return result
}

export async function readRecord(env: Env, userId: string, entity: Entity, id: string): Promise<StoredRecord | null> {
  const row = await env.DB.prepare('SELECT revision, deleted, body FROM records WHERE user_id = ? AND entity = ? AND id = ?')
    .bind(userId, entity, id.toUpperCase())
    .first<{ revision: number; deleted: number; body: string | null }>()
  return row ? { revision: row.revision, deleted: row.deleted === 1, body: row.body === null ? null : JSON.parse(row.body) } : null
}

/** Referenced exercises must be built-in or one of this user's own (archived is fine). */
async function missingExercises(env: Env, userId: string, ids: string[]): Promise<string[]> {
  const custom = [...new Set(ids.map((id) => id.toUpperCase()))].filter((id) => !isBuiltInExercise(id))
  if (custom.length === 0) return []
  const { results } = await env.DB.prepare(
    `SELECT id FROM records WHERE user_id = ? AND entity = 'exercise' AND id IN (${custom.map(() => '?').join(', ')})`,
  )
    .bind(userId, ...custom)
    .all<{ id: string }>()
  const found = new Set(results.map((r) => r.id))
  return custom.filter((id) => !found.has(id))
}

function reject(mutationId: string, code: string, message: string, details?: unknown): MutationResult {
  return { mutationId, status: 'rejected', error: { code, message, details } }
}
