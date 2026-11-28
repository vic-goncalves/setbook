import { describe, expect, it } from 'vitest'
import backup from '../../../contracts/fixtures/backup.json'
import { builtInExercises } from '../domain/catalog'
import type { BodyMeasurement, Exercise, WorkoutSession, WorkoutTemplate } from '../domain/types'
import type { Snapshot } from '../store'
import { resolveExercise, runTool, trainingSnapshot, type Proposal } from './tools'

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

function text(name: string, input: unknown = {}) {
  const outcome = runTool(name, input, snapshot())
  if (outcome.kind !== 'result') throw new Error(`${name}: ${outcome.kind === 'error' ? outcome.content : 'proposal'}`)
  return outcome.content
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

const line = (exercise: string, sets: number, reps: string, extra: Record<string, unknown> = {}) => ({ exercise, sets, reps, weight: null, warmup_sets: null, rest_seconds: null, ...extra })

describe('training snapshot', () => {
  const snap = trainingSnapshot(snapshot())

  it('has templates, lift trends and the weight unit in compact text', () => {
    expect(snap).toContain('Weight unit: lb.')
    expect(snap).toMatch(/Templates[^\n]*:\n- /)
    expect(snap).toContain('Bench Press (Barbell)')
    // 100 kg x 6 -> Epley 120 kg = 264.6 lb
    expect(snap).toContain('est 1RM 264.6')
    expect(snap).toContain('Their custom exercises:')
  })

  it('stays small: about 2,000 tokens at most', () => {
    expect(snap.length).toBeLessThan(8000)
  })
})

describe('coach tools', () => {
  it('resolves exercise names loosely but never guesses between several', () => {
    const data = snapshot()
    expect(resolveExercise(data, 'bench press (barbell)').name).toBe('Bench Press (Barbell)')
    expect(resolveExercise(data, 'Bench Press Barbell').name).toBe('Bench Press (Barbell)')
    expect(resolveExercise(data, 'Face Pull').name).toBe('Face Pull (Cable)')
    expect(() => resolveExercise(data, 'Bench Press')).toThrow(/Closest: .*Bench Press \(Barbell\)/)
  })

  it('lists workouts as compact lines, optionally for one exercise', () => {
    const all = text('workouts', { from: '2025-01-01', to: '2026-12-31' })
    expect(all.split('\n')[0]).toContain('Workouts')
    expect(all).toContain('Bench Press (Barbell) 220.5x6')
    const bench = text('workouts', { from: '2025-01-01', to: '2026-12-31', exercise: 'Bench Press (Barbell)' })
    expect(bench).toContain('Bench Press (Barbell) only')
    expect(bench).not.toContain('Pull-up')
  })

  it('reports one exercise over time with records', () => {
    const progress = text('exercise_progress', { exercise: 'Bench Press (Barbell)' })
    expect(progress).toContain('220.5x6 264.6')
    expect(progress).toMatch(/Records: heaviest /)
  })

  it('turns a compact template into a full one for approval', () => {
    const p = proposal('save_template', {
      name: 'Pull A',
      replaces: null,
      notes: null,
      exercises: [line('Bench Press (Barbell)', 3, '5-8', { warmup_sets: 2, weight: 185, rest_seconds: 150 }), line('Pull-up', 3, '8')],
    })
    expect(p.title).toBe('Create “Pull A”')
    expect(p.lines).toEqual(['Bench Press (Barbell): 3 x 5-8 at 185 lb + 2 warm-up', 'Pull-up: 3 x 8', '2 exercises, 6 working sets'])
  })

  it('explains mistakes so Claude can fix them', () => {
    const one = (ex: Record<string, unknown>, rest: Record<string, unknown> = {}) => ({ name: 'X', replaces: null, notes: null, exercises: [ex], ...rest })
    expect(error('save_template', one(line('Bench Press (Barbell)', 3, '8-5')))).toContain('reps must be like')
    expect(error('save_template', one(line('Bench', 3, '8')))).toContain('No exercise named')
    expect(error('save_template', one(line('Pull-up', 3, '8', { weight: 20 })))).toContain('bodyweight only')
    expect(error('save_template', one(line('Pull-up', 0, '8')))).toContain('sets must be')
    expect(error('save_template', one(line('Pull-up', 3, '8'), { name: backup.templates[0]!.name }))).toContain('set replaces')
    expect(error('save_template', one(line('Pull-up', 3, '8'), { replaces: 'Nope' }))).toContain('No template named')
  })

  it('checks measurement and duplicates for new exercises', () => {
    const base = { name: 'Viking Press', primary_muscle: 'shoulders', equipment: 'barbell', measurement_type: 'external_load_reps', load_convention: 'total' }
    expect(proposal('create_exercise', base).title).toBe('Add exercise “Viking Press”')
    expect(error('create_exercise', { ...base, load_convention: null })).toContain('load_convention')
    expect(error('create_exercise', { ...base, name: 'bench press (barbell)' })).toContain('already exists')
  })

  it('answers unknown tools with the list of real ones', () => {
    expect(error('get_weather', {})).toContain('workouts')
  })
})
