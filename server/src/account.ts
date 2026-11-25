import { Hono } from 'hono'
import { z } from 'zod'
import { parse } from './auth'
import { nowIso } from './crypto'
import type { AppBindings, Env } from './env'
import type { BodyMeasurement, Exercise, Session, Template } from './records'
import { publicUser } from './sessions'

export const account = new Hono<AppBindings>()

account.get('/me', async (c) => c.json(await publicUser(c.env, c.get('auth').userId)))

account.patch('/me', async (c) => {
  const patch = parse(
    z.object({ displayName: z.string().trim().max(100).nullable().optional(), massUnit: z.enum(['kg', 'lb']).nullable().optional() }),
    await c.req.json(),
  )
  const userId = c.get('auth').userId
  const current = await publicUser(c.env, userId)
  await c.env.DB.prepare('UPDATE users SET display_name = ?, mass_unit = ?, updated_at = ? WHERE id = ?')
    .bind(
      patch.displayName === undefined ? current.displayName : patch.displayName,
      patch.massUnit === undefined ? current.massUnit : patch.massUnit,
      nowIso(),
      userId,
    )
    .run()
  return c.json(await publicUser(c.env, userId))
})

/**
 * Deletes the account and everything it owns. Google tokens are never stored, so there is
 * no provider grant to revoke; the user can remove Setbook from their Google account settings.
 */
account.delete('/me', async (c) => {
  const userId = c.get('auth').userId
  await c.env.DB.batch(
    ['records', 'changes', 'mutations', 'auth_sessions', 'auth_identities', 'login_codes'].map((table) =>
      c.env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId),
    ).concat(c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId)),
  )
  return c.body(null, 204)
})

/** Same format as the iPhone app's JSON backup, so either can import the other's file. */
account.get('/export.json', async (c) => {
  const document = await backupDocument(c.env, c.get('auth').userId)
  return c.json(document, 200, { 'content-disposition': `attachment; filename="setbook-backup-${today()}.json"` })
})

account.get('/export/sets.csv', async (c) => {
  const { sessions } = await backupDocument(c.env, c.get('auth').userId)
  const lines = ['workout_id,workout_name,started_at,time_zone,exercise_id,exercise_name,load_convention,exercise_position,set_position,set_type,load,load_unit,reps,rir,completed_at']
  for (const session of sessions.filter((s) => s.state === 'completed')) {
    session.exercises.forEach((exercise, e) => {
      exercise.sets.forEach((set, s) => {
        lines.push(
          [
            session.id, csv(session.name), session.startedAt, session.timeZoneIdentifier, exercise.exerciseId, csv(exercise.exerciseName),
            exercise.measurement.loadConvention ?? '', e + 1, s + 1, set.type, set.load?.value ?? '', set.load?.unit ?? '',
            set.reps ?? '', set.rir ?? '', set.completedAt ?? '',
          ].join(','),
        )
      })
    })
  }
  return csvResponse(lines, 'setbook-sets')
})

account.get('/export/body-weight.csv', async (c) => {
  const { bodyMeasurements } = await backupDocument(c.env, c.get('auth').userId)
  const lines = ['id,measured_at,time_zone,weight,unit,note']
  for (const entry of bodyMeasurements) {
    lines.push([entry.id, entry.measuredAt, entry.timeZoneIdentifier, entry.mass.value, entry.mass.unit, csv(entry.note ?? '')].join(','))
  }
  return csvResponse(lines, 'setbook-body-weight')
})

async function backupDocument(env: Env, userId: string) {
  const { results } = await env.DB.prepare('SELECT entity, body FROM records WHERE user_id = ? AND deleted = 0')
    .bind(userId)
    .all<{ entity: string; body: string }>()
  const of = <T>(entity: string) => results.filter((r) => r.entity === entity).map((r) => JSON.parse(r.body) as T)
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    customExercises: of<Exercise>('exercise'),
    templates: of<Template>('template'),
    sessions: of<Session>('session').sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    bodyMeasurements: of<BodyMeasurement>('measurement').sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)),
  }
}

/** RFC 4180 quoting, matching the iPhone export. */
function csv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function csvResponse(lines: string[], name: string) {
  return new Response(lines.join('\n') + '\n', {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}-${today()}.csv"` },
  })
}

function today() {
  return new Date().toISOString().slice(0, 10)
}
