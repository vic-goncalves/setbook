import { describe, expect, it } from 'vitest'
import backup from '../../../contracts/fixtures/backup.json'
import { builtInExercises } from '../domain/catalog'
import type { BodyMeasurement, Exercise, WorkoutSession, WorkoutTemplate } from '../domain/types'
import type { Snapshot } from '../store'
import { runTool, type Proposal } from './tools'

const BENCH = '1E745624-563E-59EB-8458-DD9D29D3CC25'
const CURL = 'E641382D-B89B-5CED-A135-9A7B2C26DEE0'

function snapshot(): Snapshot {
  const customExercises = backup.customExercises as Exercise[]
  const exerciseById = new Map<string, Exercise>()
  for (const e of [...builtInExercises, ...customExercises]) exerciseById.set(e.id.toUpperCase(), e)
  return {
    status: 'ready',
    customExercises,
    templates: backup.templates as WorkoutTemplate[],
    sessions: (backup.sessions as WorkoutSession[]).slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    measurements: (backup.bodyMeasurements as BodyMeasurement[]).slice().sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)),
    exerciseById,
    pending: 0,
    syncing: false,
    conflicts: [],
  }
}

function result(name: string, input: unknown = {}) {
  const outcome = runTool(name, input, snapshot())
  if (outcome.kind !== 'result') throw new Error(`${name}: ${outcome.kind === 'error' ? outcome.content : 'proposal'}`)
  return JSON.parse(outcome.content)
}

function proposal(name: string, input: unknown) {
  const outcome = runTool(name, input, snapshot())
  if (outcome.kind !== 'proposal') throw new Error(`${name}: ${outcome.kind === 'error' ? outcome.content : 'result'}`)
  return outcome as Proposal
}

function error(name: string, input: unknown) {
  const outcome = runTool(name, input, snapshot())
  expect(outcome.kind).toBe('error')
  return (outcome as { content: string }).content
}

const set = (min: number, max = min) => ({ type: 'working', reps_min: min, reps_max: max, target_weight: null })

describe('coach tools', () => {
  it('summarizes the account', () => {
    const overview = result('get_overview')
    expect(overview.unit).toBe('lb')
    expect(overview.workouts.completed).toBe(backup.sessions.filter((s) => s.state === 'completed').length)
    expect(overview.templates).toHaveLength(backup.templates.length)
    expect(overview.templates[0]).toHaveProperty('id')
  })

  it('finds exercises by name and muscle, most-logged first', () => {
    const bench = result('find_exercises', { query: 'bench press', muscle: null, logged_only: false })
    expect(bench.exercises[0].id).toBe(BENCH)
    expect(bench.exercises[0].workoutsLogged).toBeGreaterThan(0)
    const core = result('find_exercises', { query: null, muscle: 'core', logged_only: false })
    expect(core.exercises.every((e: { primaryMuscle: string }) => e.primaryMuscle === 'core')).toBe(true)
    const logged = result('find_exercises', { query: null, muscle: null, logged_only: true })
    expect(logged.exercises.every((e: { workoutsLogged: number }) => e.workoutsLogged > 0)).toBe(true)
  })

  it('reports progress in the user unit, from working sets only', () => {
    const progress = result('exercise_progress', { exercise_id: BENCH, from: null, to: null })
    expect(progress.exercise).toBe('Bench Press (Barbell)')
    expect(progress.points.length).toBeGreaterThan(0)
    const first = progress.points[0]
    // 100 kg x 6 is the top working set in the first session; the 60 kg warm-up is ignored.
    expect(first.topSet).toBe('220.46 x 6')
    expect(first.sets.some((s: string) => s.startsWith('132.28'))).toBe(false)
    // Epley: 100 kg x (1 + 6/30) = 120 kg = 264.6 lb
    expect(first.estimated1RM).toBeCloseTo(264.6, 1)
    expect(progress.personalRecords.heaviest).not.toBeNull()
  })

  it('rejects bad dates and unknown ids with a message Claude can act on', () => {
    expect(error('exercise_progress', { exercise_id: 'nope', from: null, to: null })).toContain('find_exercises')
    expect(error('list_workouts', { from: 'last week', to: null, limit: null })).toContain('YYYY-MM-DD')
    expect(error('get_template', { template_id: 'nope' })).toContain('get_overview')
  })

  it('lists workouts newest first with completed working sets', () => {
    const list = result('list_workouts', { from: null, to: null, limit: 2 })
    expect(list.workouts.length).toBeLessThanOrEqual(2)
    expect(list.workouts[0].date >= (list.workouts[1]?.date ?? '')).toBe(true)
  })

  it('adds up weekly sets per muscle', () => {
    const volume = result('training_volume', { from: '2025-01-01', to: '2026-12-31' })
    expect(volume.byMuscle.find((m: { muscle: string }) => m.muscle === 'chest').sets).toBeGreaterThan(0)
    expect(volume.weeks.length).toBeGreaterThan(0)
  })

  it('turns save_template into a proposal with a complete, valid template', () => {
    const p = proposal('save_template', {
      template_id: null,
      name: 'Pull A',
      notes: 'Test',
      exercises: [
        { exercise_id: BENCH.toLowerCase(), rest_seconds: 120, notes: null, sets: [set(5, 8), set(5, 8), { type: 'warmup', reps_min: null, reps_max: null, target_weight: 95 }] },
        { exercise_id: CURL, rest_seconds: null, notes: 'Slow negatives', sets: [set(10, 12)] },
      ],
    })
    expect(p.title).toBe('Create "Pull A"')
    expect(p.lines[0]).toBe('Bench Press (Barbell): 2 x 5-8 + 1 warm-up')
    expect(p.lines.at(-1)).toBe('2 exercises, 4 sets')
  })

  it('validates templates before asking for approval', () => {
    const one = (sets: unknown[], exercise_id = BENCH) => ({ template_id: null, name: 'X', notes: null, exercises: [{ exercise_id, rest_seconds: null, notes: null, sets }] })
    expect(error('save_template', one([set(8, 5)]))).toContain('reps_min <= reps_max')
    expect(error('save_template', one([set(5)], 'not-an-id'))).toContain('find_exercises')
    expect(error('save_template', one([]))).toContain('1 to 100 sets')
    expect(error('save_template', { ...one([set(5)]), exercises: [] })).toContain('at least one exercise')
    const pullUp = builtInExercises.find((e) => e.name === 'Pull-up')!.id
    expect(error('save_template', one([{ type: 'working', reps_min: 5, reps_max: 5, target_weight: 20 }], pullUp))).toContain('bodyweight')
  })

  it('checks measurement and duplicates for new exercises', () => {
    const base = { name: 'Viking Press', primary_muscle: 'shoulders', secondary_muscles: [], equipment: 'barbell', measurement_type: 'external_load_reps', load_convention: 'total' }
    expect(proposal('create_exercise', base).title).toBe('Add exercise "Viking Press"')
    expect(error('create_exercise', { ...base, load_convention: null })).toContain('load_convention')
    expect(error('create_exercise', { ...base, name: 'bench press (barbell)' })).toContain('already exists')
  })

  it('answers unknown tools with the list of real ones', () => {
    expect(error('get_weather', {})).toContain('get_overview')
  })
})
