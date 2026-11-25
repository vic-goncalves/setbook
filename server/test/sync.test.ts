import { describe, expect, it } from 'vitest'
import backup from '../../contracts/fixtures/backup.json'
import { bodySchemas } from '../src/records'
import { BENCH, call, devLogin, json, mutation, push, session, template, testEnv, uuid } from './helpers'

async function pull(token: string, cursor = 0) {
  return json<{ changes: { entity: string; id: string; revision: number; deleted: boolean; body: any }[]; cursor: number; hasMore: boolean }>(
    await call(`/v1/sync/pull?cursor=${cursor}`, { token }),
  )
}

describe('push and pull', () => {
  it('applies a new record and returns it from pull', async () => {
    const { accessToken } = await devLogin('puller')
    const body = template()
    const { body: result } = await push(accessToken, [mutation('template', body)])
    expect(result.results[0]).toMatchObject({ status: 'applied', revision: 1 })
    const page = await pull(accessToken)
    expect(page.changes).toEqual([{ entity: 'template', id: body.id, revision: 1, deleted: false, body }])
    expect((await pull(accessToken, page.cursor)).changes).toEqual([])
  })

  it('is idempotent: retrying a mutation ID returns the first result and writes nothing new', async () => {
    const { accessToken, user } = await devLogin('retrier')
    const m = mutation('template', template())
    const first = await push(accessToken, [m])
    const retry = await push(accessToken, [m])
    expect(retry.body.results).toEqual(first.body.results)
    const rows = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM changes WHERE user_id = ?').bind(user.id).first<{ n: number }>()
    expect(rows?.n).toBe(1)
  })

  it('reports a stale base revision as a conflict and keeps the server copy', async () => {
    const { accessToken } = await devLogin('conflicted')
    const original = template()
    await push(accessToken, [mutation('template', original)])
    const deviceA = { ...original, name: 'From A' }
    const deviceB = { ...original, name: 'From B' }
    expect((await push(accessToken, [mutation('template', deviceA, 1)])).body.results[0]).toMatchObject({ status: 'applied', revision: 2 })
    const conflict = (await push(accessToken, [mutation('template', deviceB, 1)])).body.results[0]
    expect(conflict).toMatchObject({ status: 'conflict', reason: 'stale', current: { revision: 2, body: { name: 'From A' } } })
    const latest = (await pull(accessToken)).changes.find((c) => c.id === original.id)
    expect(latest?.body.name).toBe('From A')
  })

  it('tombstones deletions so other devices learn about them', async () => {
    const { accessToken } = await devLogin('deleter')
    const body = template()
    await push(accessToken, [mutation('template', body)])
    expect((await push(accessToken, [mutation('template', null, 1, { id: body.id })])).body.results[0]).toMatchObject({ status: 'applied', revision: 2 })
    expect((await pull(accessToken)).changes).toEqual([{ entity: 'template', id: body.id, revision: 2, deleted: true, body: null }])
  })

  it('allows only one active workout per account', async () => {
    const { accessToken } = await devLogin('lifter')
    const first = session({ state: 'active', finishedAt: undefined })
    const second = session({ state: 'active', finishedAt: undefined })
    expect((await push(accessToken, [mutation('session', first)])).body.results[0].status).toBe('applied')
    const result = (await push(accessToken, [mutation('session', second)])).body.results[0]
    expect(result).toMatchObject({ status: 'conflict', reason: 'active_exists', current: { body: { id: first.id } } })
    expect((await push(accessToken, [mutation('session', { ...first, state: 'completed' }, 1)])).body.results[0].status).toBe('applied')
    expect((await push(accessToken, [mutation('session', second)])).body.results[0].status).toBe('applied')
  })
})

describe('validation', () => {
  it.each([
    ['a completed workout with no completed sets', session({}, { completedAt: undefined })],
    ['negative load', session({}, { load: { value: -5, unit: 'kg' } })],
    ['zero reps on a completed set', session({}, { reps: 0 })],
    ['missing load on a barbell set', session({}, { load: undefined })],
    ['an invalid rep range', { ...template(), exercises: [{ id: uuid(), exerciseId: BENCH, sets: [{ id: uuid(), type: 'working', targetReps: { min: 8, max: 5 } }] }] }],
  ])('rejects %s', async (_, body) => {
    const { accessToken } = await devLogin('validator')
    const result = (await push(accessToken, [mutation(body.exercises ? ('state' in body ? 'session' : 'template') : 'template', body)])).body.results[0]
    expect(result.status).toBe('rejected')
  })

  it('accepts zero added load on a weighted bodyweight set', async () => {
    const { accessToken } = await devLogin('weighted')
    const body = session()
    body.exercises[0]!.measurement = { type: 'weighted_bodyweight_reps', loadConvention: 'added' }
    body.exercises[0]!.sets[0]!.load = { value: 0, unit: 'kg' }
    expect((await push(accessToken, [mutation('session', body)])).body.results[0].status).toBe('applied')
  })

  it('rejects mismatched IDs and edits to built-in exercises', async () => {
    const { accessToken } = await devLogin('sneaky')
    const body = template()
    const mismatched = (await push(accessToken, [{ ...mutation('template', body), id: uuid() }])).body.results[0]
    expect(mismatched.status).toBe('rejected')
    const now = new Date().toISOString()
    const builtIn = { id: BENCH, name: 'Mine', primaryMuscle: 'chest', secondaryMuscles: [], equipment: 'barbell', measurement: { type: 'external_load_reps', loadConvention: 'total' }, isBuiltIn: false, createdAt: now, updatedAt: now }
    expect((await push(accessToken, [mutation('exercise', builtIn)])).body.results[0].status).toBe('rejected')
  })

  it('accepts every record the iPhone app exports', () => {
    for (const exercise of backup.customExercises) expect(bodySchemas.exercise.safeParse(exercise).success).toBe(true)
    for (const t of backup.templates) expect(bodySchemas.template.safeParse(t).success).toBe(true)
    for (const s of backup.sessions) expect(bodySchemas.session.safeParse(s).success).toBe(true)
    for (const m of backup.bodyMeasurements) expect(bodySchemas.measurement.safeParse(m).success).toBe(true)
  })
})

describe('isolation between accounts', () => {
  it('never exposes or overwrites another user’s records', async () => {
    const alice = await devLogin('alice')
    const bob = await devLogin('bob')
    const now = new Date().toISOString()
    const custom = { id: uuid(), name: 'Alice Press', primaryMuscle: 'chest', secondaryMuscles: [], equipment: 'barbell', measurement: { type: 'external_load_reps', loadConvention: 'total' }, isBuiltIn: false, createdAt: now, updatedAt: now }
    const shared = template()
    await push(alice.accessToken, [mutation('exercise', custom), mutation('template', shared)])

    // Bob sees nothing of Alice's.
    expect((await pull(bob.accessToken)).changes).toEqual([])
    // Bob writing the same ID creates his own record; Alice's is untouched.
    expect((await push(bob.accessToken, [mutation('template', { ...shared, name: 'Bob' })])).body.results[0].status).toBe('applied')
    expect((await pull(alice.accessToken)).changes.find((c) => c.id === shared.id)?.body.name).toBe('Push')
    // Bob can't reference Alice's custom exercise.
    const result = (await push(bob.accessToken, [mutation('template', template(uuid(), custom.id))])).body.results[0]
    expect(result).toMatchObject({ status: 'rejected', error: { code: 'unknown_exercise' } })
    // Alice's export contains only her records.
    const bobExport = await json(await call('/v1/export.json', { token: bob.accessToken }))
    expect(bobExport.customExercises).toEqual([])
    expect(bobExport.templates.map((t: { name: string }) => t.name)).toEqual(['Bob'])
  })
})

describe('account', () => {
  it('exports JSON in the app backup format and CSV with quoting', async () => {
    const { accessToken } = await devLogin('exporter')
    const workout = session({ name: 'Push, heavy' })
    await push(accessToken, [mutation('session', workout)])
    const exported = await json(await call('/v1/export.json', { token: accessToken }))
    expect(exported.formatVersion).toBe(1)
    expect(exported.sessions.map((s: { id: string }) => s.id)).toEqual([workout.id])
    const csv = await (await call('/v1/export/sets.csv', { token: accessToken })).text()
    expect(csv.split('\n')[1]).toContain('"Push, heavy"')
    expect(csv.split('\n')[1]).toContain(',100,kg,5,')
  })

  it('updates preferences', async () => {
    const { accessToken } = await devLogin('prefs')
    const updated = await call('/v1/me', { method: 'PATCH', token: accessToken, body: JSON.stringify({ massUnit: 'kg' }) })
    expect((await json(updated)).massUnit).toBe('kg')
  })

  it('deletes the account and everything it owns', async () => {
    const { accessToken, refreshToken, user } = await devLogin('goodbye')
    await push(accessToken, [mutation('template', template())])
    expect((await call('/v1/me', { method: 'DELETE', token: accessToken })).status).toBe(204)
    for (const table of ['records', 'changes', 'mutations', 'auth_sessions', 'auth_identities']) {
      const row = await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(user.id).first<{ n: number }>()
      expect(row?.n, table).toBe(0)
    }
    expect((await call('/v1/me', { token: accessToken })).status).toBe(401)
    expect((await call('/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) })).status).toBe(401)
  })
})
