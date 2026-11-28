import { builtInExercises, matchesSearch } from '../domain/catalog'
import { dailyMeans, exerciseRecords, localDay, personalRecords, qualifyingSets } from '../domain/metrics'
import type { Equipment, Exercise, MassUnit, Measurement, MuscleGroup, RecordedMass, TemplateExercise, WorkoutSession, WorkoutSet, WorkoutTemplate } from '../domain/types'
import { kilograms, localTimeZone, massIn, newId, nowIso, sameMeasurement } from '../domain/types'
import { setText } from '../format'
import { currentPrefs } from '../prefs'
import { store, type Snapshot } from '../store'

/**
 * The coach's tools, run in the browser against the synced data the rest of the app uses,
 * with the same metric code as the Progress page. Names and inputs match the definitions the
 * server sends to Claude (server/src/chat-prompt.ts).
 *
 * Reads return JSON-ready objects. Writes return a Proposal: the chat shows it as an
 * Approve/Decline card and only calls `apply` once the user approves.
 */

export class ToolError extends Error {}

export interface Proposal {
  kind: 'proposal'
  title: string
  lines: string[]
  confirm: string
  danger?: boolean
  apply: () => unknown
}

type Input = Record<string, unknown>
type Handler = (input: Input, data: Snapshot) => unknown

const MAX_RESULT_CHARS = 60_000
const DEFAULT_REST = 90

// MARK: Helpers

function unit(): MassUnit {
  return currentPrefs().unit
}

function round(value: number, digits = 1) {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

function weight(m: RecordedMass | undefined): number | undefined {
  return m ? round(massIn(m, unit())) : undefined
}

function fromKg(kg: number): number {
  return round(massIn({ value: kg, unit: 'kg' }, unit()))
}

function today(): string {
  return localDay(new Date().toISOString(), localTimeZone())
}

function day(iso: string): string {
  return localDay(iso, localTimeZone())
}

function addDays(dayString: string, days: number): string {
  const d = new Date(`${dayString}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function optionalDay(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ToolError(`${field} must be YYYY-MM-DD or null.`)
  return value
}

function inDays(iso: string, from?: string, to?: string): boolean {
  const d = day(iso)
  return (!from || d >= from) && (!to || d <= to)
}

function str(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ToolError(`${field} is required.`)
  return value.trim()
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function completed(data: Snapshot): WorkoutSession[] {
  return data.sessions.filter((s) => s.state === 'completed')
}

function exerciseOf(data: Snapshot, id: unknown): Exercise {
  const exercise = typeof id === 'string' ? data.exerciseById.get(id.toUpperCase()) : undefined
  if (!exercise) throw new ToolError(`No exercise with id ${String(id)}. Use find_exercises to look up ids.`)
  return exercise
}

function templateOf(data: Snapshot, id: unknown): WorkoutTemplate {
  const template = typeof id === 'string' ? data.templates.find((t) => t.id.toUpperCase() === id.toUpperCase()) : undefined
  if (!template) throw new ToolError(`No template with id ${String(id)}. get_overview lists the templates.`)
  return template
}

function workingSets(sets: WorkoutSet[], m: Measurement) {
  return qualifyingSets({ sessionId: '', sessionName: '', startedAt: '', measurement: m, sets })
}

function describeMeasurement(m: Measurement): string {
  switch (m.type) {
    case 'external_load_reps': return m.loadConvention === 'per_hand' ? 'weight x reps, weight is per hand (one dumbbell)' : 'weight x reps, total weight'
    case 'bodyweight_reps': return 'bodyweight reps, no weight'
    case 'weighted_bodyweight_reps': return 'weight added to bodyweight x reps'
    case 'assisted_bodyweight_reps': return 'assistance weight x reps (lower is harder)'
  }
}

function repText(t: { min: number; max: number } | undefined): string | undefined {
  if (!t) return undefined
  return t.min === t.max ? `${t.min}` : `${t.min}-${t.max}`
}

/** Epley; only for weight x reps sets up to 12 reps. */
function estimatedMax(set: WorkoutSet, m: Measurement): number | undefined {
  if (m.type !== 'external_load_reps' || !set.load || !set.reps || set.reps > 12) return undefined
  return kilograms(set.load) * (1 + set.reps / 30)
}

function durationMinutes(s: WorkoutSession): number | undefined {
  return s.finishedAt ? Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60000) : undefined
}

function loggedCounts(data: Snapshot): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of completed(data)) {
    for (const id of new Set(s.exercises.map((e) => e.exerciseId.toUpperCase()))) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

function templateSummary(data: Snapshot, t: WorkoutTemplate) {
  return {
    id: t.id,
    name: t.name,
    notes: t.notes,
    exercises: t.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      name: data.exerciseById.get(e.exerciseId.toUpperCase())?.name ?? 'Unknown exercise',
      restSeconds: e.restSeconds,
      notes: e.notes,
      sets: e.sets.map((s) => ({ type: s.type, reps: repText(s.targetReps), targetWeight: weight(s.targetLoad) })),
    })),
  }
}

// MARK: Reads

const getOverview: Handler = (_input, data) => {
  const done = completed(data)
  const active = data.sessions.find((s) => s.state === 'active')
  const latestWeight = data.measurements[0]
  return {
    today: today(),
    timeZone: localTimeZone(),
    unit: unit(),
    workouts: { completed: done.length, first: done.at(-1) ? day(done.at(-1)!.startedAt) : null, last: done[0] ? day(done[0].startedAt) : null },
    workoutInProgress: active ? active.name : null,
    templates: data.templates.map((t) => ({ id: t.id, name: t.name, exercises: t.exercises.length, sets: t.exercises.reduce((n, e) => n + e.sets.length, 0) })),
    recentWorkouts: done.slice(0, 10).map((s) => ({
      id: s.id,
      name: s.name,
      date: day(s.startedAt),
      workingSets: s.exercises.reduce((n, e) => n + workingSets(e.sets, e.measurement).length, 0),
    })),
    customExercises: data.customExercises.filter((e) => !e.archivedAt).map((e) => ({ id: e.id, name: e.name })),
    latestBodyWeight: latestWeight ? { weight: weight(latestWeight.mass), date: day(latestWeight.measuredAt) } : null,
  }
}

const findExercises: Handler = (input, data) => {
  const counts = loggedCounts(data)
  const query = optionalStr(input.query)
  const muscle = optionalStr(input.muscle) as MuscleGroup | undefined
  const all = [...builtInExercises, ...data.customExercises.filter((e) => !e.archivedAt)]
  const matches = all
    .filter((e) => (!query || matchesSearch(e, query)) && (!muscle || e.primaryMuscle === muscle))
    .filter((e) => !input.logged_only || (counts.get(e.id.toUpperCase()) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.id.toUpperCase()) ?? 0) - (counts.get(a.id.toUpperCase()) ?? 0) || a.name.localeCompare(b.name))
  return {
    total: matches.length,
    exercises: matches.slice(0, 40).map((e) => ({
      id: e.id,
      name: e.name,
      primaryMuscle: e.primaryMuscle,
      secondaryMuscles: e.secondaryMuscles,
      equipment: e.equipment,
      measurement: describeMeasurement(e.measurement),
      custom: !e.isBuiltIn,
      workoutsLogged: counts.get(e.id.toUpperCase()) ?? 0,
    })),
  }
}

const getTemplate: Handler = (input, data) => templateSummary(data, templateOf(data, input.template_id))

const listWorkouts: Handler = (input, data) => {
  const from = optionalDay(input.from, 'from')
  const to = optionalDay(input.to, 'to')
  const limit = Math.min(100, Math.max(1, typeof input.limit === 'number' ? Math.floor(input.limit) : 20))
  const matching = completed(data).filter((s) => inDays(s.startedAt, from, to))
  return {
    unit: unit(),
    total: matching.length,
    workouts: matching.slice(0, limit).map((s) => ({
      id: s.id,
      name: s.name,
      date: day(s.startedAt),
      durationMinutes: durationMinutes(s),
      exercises: s.exercises
        .map((e) => ({ name: e.exerciseName, sets: workingSets(e.sets, e.measurement).map((x) => setText(x, unit())) }))
        .filter((e) => e.sets.length > 0),
    })),
  }
}

const getWorkout: Handler = (input, data) => {
  const id = typeof input.workout_id === 'string' ? input.workout_id.toUpperCase() : ''
  const s = data.sessions.find((x) => x.id.toUpperCase() === id)
  if (!s) throw new ToolError(`No workout with id ${String(input.workout_id)}. list_workouts gives ids.`)
  return {
    unit: unit(),
    id: s.id,
    name: s.name,
    state: s.state,
    date: day(s.startedAt),
    durationMinutes: durationMinutes(s),
    notes: s.notes,
    fromTemplate: s.sourceTemplate ? data.templates.find((t) => t.id === s.sourceTemplate!.templateId)?.name ?? 'a deleted template' : undefined,
    exercises: s.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      name: e.exerciseName,
      measurement: describeMeasurement(e.measurement),
      notes: e.notes,
      sets: e.sets.map((x) => ({
        type: x.type,
        weight: weight(x.load),
        reps: x.reps,
        rir: x.rir,
        completed: Boolean(x.completedAt),
        targetReps: repText(x.targetReps),
        targetWeight: weight(x.targetLoad),
      })),
    })),
  }
}

const exerciseProgress: Handler = (input, data) => {
  const exercise = exerciseOf(data, input.exercise_id)
  const from = optionalDay(input.from, 'from')
  const to = optionalDay(input.to, 'to')
  const m = exercise.measurement
  const all = exerciseRecords(completed(data), exercise.id).filter((r) => sameMeasurement(r.measurement, m))
  const records = all.filter((r) => inDays(r.startedAt, from, to))
  const points = records.flatMap((r) => {
    const sets = qualifyingSets(r)
    if (sets.length === 0) return []
    const assisted = m.type === 'assisted_bodyweight_reps'
    const top = sets.reduce((a, b) => {
      const diff = (b.load ? kilograms(b.load) : 0) - (a.load ? kilograms(a.load) : 0)
      if (Math.abs(diff) >= 0.001) return (assisted ? diff < 0 : diff > 0) ? b : a
      return (b.reps ?? 0) > (a.reps ?? 0) ? b : a
    })
    const e1rm = Math.max(0, ...sets.map((s) => estimatedMax(s, m) ?? 0))
    return [{
      date: day(r.startedAt),
      workout: r.sessionName,
      sets: sets.map((s) => setText(s, unit())),
      topSet: setText(top, unit()),
      estimated1RM: e1rm > 0 ? fromKg(e1rm) : undefined,
      volume: m.type === 'external_load_reps' ? fromKg(sets.reduce((sum, s) => sum + (s.load ? kilograms(s.load) : 0) * (s.reps ?? 0), 0)) : undefined,
      totalReps: sets.reduce((sum, s) => sum + (s.reps ?? 0), 0),
    }]
  })
  const prs = personalRecords(all, m)
  const entry = (e: { load?: RecordedMass; reps: number; date: string } | undefined) =>
    e ? { set: e.load ? `${weight(e.load)} x ${e.reps}` : `x ${e.reps}`, date: day(e.date) } : null
  return {
    exercise: exercise.name,
    measurement: describeMeasurement(m),
    unit: unit(),
    workouts: points.length,
    points,
    personalRecords: {
      heaviest: entry(prs.bestLoad),
      mostReps: entry(prs.mostReps),
      mostRepsByWeight: prs.mostRepsByLoad.slice(0, 8).map(entry),
    },
  }
}

const trainingVolume: Handler = (input, data) => {
  const to = optionalDay(input.to, 'to') ?? today()
  const from = optionalDay(input.from, 'from') ?? addDays(to, -55)
  const weekOf = (d: string) => {
    const weekday = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
    return addDays(d, -weekday)
  }
  const weeks = new Map<string, Map<string, number>>()
  const byMuscle = new Map<string, { sets: number; exercises: Map<string, number> }>()
  for (const s of completed(data).filter((x) => inDays(x.startedAt, from, to))) {
    const week = weekOf(day(s.startedAt))
    for (const e of s.exercises) {
      const count = workingSets(e.sets, e.measurement).length
      if (count === 0) continue
      const muscle = data.exerciseById.get(e.exerciseId.toUpperCase())?.primaryMuscle ?? 'unknown'
      const w = weeks.get(week) ?? new Map<string, number>()
      w.set(muscle, (w.get(muscle) ?? 0) + count)
      weeks.set(week, w)
      const entry = byMuscle.get(muscle) ?? { sets: 0, exercises: new Map<string, number>() }
      entry.sets += count
      entry.exercises.set(e.exerciseName, (entry.exercises.get(e.exerciseName) ?? 0) + count)
      byMuscle.set(muscle, entry)
    }
  }
  const weekCount = Math.max(1, Math.ceil((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${weekOf(from)}T12:00:00Z`) + 86_400_000) / (7 * 86_400_000)))
  return {
    from,
    to,
    weeksInRange: weekCount,
    note: 'Completed working sets counted under each exercise\'s primary muscle only.',
    weeks: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, muscles]) => ({
      weekOf: week,
      total: [...muscles.values()].reduce((a, b) => a + b, 0),
      muscles: Object.fromEntries(muscles),
    })),
    byMuscle: [...byMuscle.entries()].sort(([, a], [, b]) => b.sets - a.sets).map(([muscle, e]) => ({
      muscle,
      sets: e.sets,
      perWeek: round(e.sets / weekCount),
      exercises: Object.fromEntries(e.exercises),
    })),
  }
}

const bodyWeight: Handler = (input, data) => {
  const from = optionalDay(input.from, 'from')
  const to = optionalDay(input.to, 'to')
  const daily = dailyMeans(data.measurements)
  const rolling = new Map<string, number>()
  daily.forEach((d, i) => {
    const window = daily.slice(0, i + 1).filter((x) => Date.parse(`${d.day}T12:00:00Z`) - Date.parse(`${x.day}T12:00:00Z`) < 7 * 86_400_000)
    rolling.set(d.day, window.reduce((a, b) => a + b.meanKilograms, 0) / window.length)
  })
  const days = daily.filter((d) => (!from || d.day >= from) && (!to || d.day <= to))
  return {
    unit: unit(),
    entries: days.length,
    days: days.map((d) => ({ date: d.day, weight: fromKg(d.meanKilograms), sevenDayAverage: fromKg(rolling.get(d.day)!) })),
  }
}

// MARK: Writes

const measurementTypes = ['external_load_reps', 'bodyweight_reps', 'weighted_bodyweight_reps', 'assisted_bodyweight_reps'] as const

const saveTemplate: Handler = (input, data): Proposal => {
  const existing = input.template_id ? templateOf(data, input.template_id) : undefined
  const name = str(input.name, 'name')
  if (name.length > 200) throw new ToolError('name is too long (200 characters at most).')
  if (!Array.isArray(input.exercises) || input.exercises.length === 0) throw new ToolError('A template needs at least one exercise.')
  if (input.exercises.length > 100) throw new ToolError('A template can have at most 100 exercises.')
  const exercises: TemplateExercise[] = (input.exercises as Input[]).map((e, i) => {
    const exercise = exerciseOf(data, e.exercise_id)
    const rest = e.rest_seconds === null || e.rest_seconds === undefined ? DEFAULT_REST : Number(e.rest_seconds)
    if (!Number.isInteger(rest) || rest < 1) throw new ToolError(`Exercise ${i + 1}: rest_seconds must be a positive whole number.`)
    if (!Array.isArray(e.sets) || e.sets.length === 0 || e.sets.length > 100) throw new ToolError(`Exercise ${i + 1} (${exercise.name}): give 1 to 100 sets.`)
    return {
      id: newId(),
      exerciseId: exercise.id,
      ...(optionalStr(e.notes) ? { notes: optionalStr(e.notes) } : {}),
      restSeconds: rest,
      sets: (e.sets as Input[]).map((s, j) => {
        const where = `Exercise ${i + 1} (${exercise.name}), set ${j + 1}`
        if (s.type !== 'warmup' && s.type !== 'working') throw new ToolError(`${where}: type must be "warmup" or "working".`)
        const min = s.reps_min ?? s.reps_max
        const max = s.reps_max ?? s.reps_min
        let targetReps: { min: number; max: number } | undefined
        if (min !== null && min !== undefined) {
          if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 1 || (max as number) < (min as number)) {
            throw new ToolError(`${where}: reps must be whole numbers with 1 <= reps_min <= reps_max.`)
          }
          targetReps = { min: min as number, max: max as number }
        }
        let targetLoad: RecordedMass | undefined
        if (s.target_weight !== null && s.target_weight !== undefined) {
          const value = Number(s.target_weight)
          if (!Number.isFinite(value) || value < 0) throw new ToolError(`${where}: target_weight can't be negative.`)
          if (exercise.measurement.loadConvention === undefined) throw new ToolError(`${where}: ${exercise.name} is a bodyweight exercise, so it takes no target_weight.`)
          targetLoad = { value, unit: unit() }
        }
        return { id: newId(), type: s.type, ...(targetReps ? { targetReps } : {}), ...(targetLoad ? { targetLoad } : {}) }
      }),
    }
  })
  const now = nowIso()
  const notes = optionalStr(input.notes)
  const template: WorkoutTemplate = {
    id: existing?.id ?? newId(),
    name,
    ...(notes ? { notes } : {}),
    revision: existing ? existing.revision + 1 : 1,
    exercises,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const setCount = exercises.reduce((n, e) => n + e.sets.length, 0)
  return {
    kind: 'proposal',
    title: existing ? `Update “${existing.name}”` : `Create “${name}”`,
    lines: [
      ...(existing && existing.name !== name ? [`Renamed to “${name}”`] : []),
      ...exercises.map((e) => {
        const ex = data.exerciseById.get(e.exerciseId.toUpperCase())!
        const working = e.sets.filter((s) => s.type === 'working')
        const warmups = e.sets.length - working.length
        const reps = [...new Set(working.map((s) => repText(s.targetReps)).filter(Boolean))].join(', ')
        const loads = [...new Set(working.map((s) => s.targetLoad?.value).filter((v) => v !== undefined))]
        const at = loads.length === 1 ? ` at ${loads[0]} ${unit()}` : loads.length > 1 ? ` at ${loads.join('/')} ${unit()}` : ''
        return `${ex.name}: ${working.length} x ${reps || 'any reps'}${at}${warmups ? ` + ${warmups} warm-up` : ''}`
      }),
      `${exercises.length} exercises, ${setCount} sets`,
    ],
    confirm: existing ? 'Update' : 'Create',
    apply: () => {
      store.save('template', template)
      return { saved: true, template_id: template.id, name: template.name }
    },
  }
}

const deleteTemplate: Handler = (input, data): Proposal => {
  const template = templateOf(data, input.template_id)
  return {
    kind: 'proposal',
    title: `Delete “${template.name}”`,
    lines: [`${template.exercises.length} exercises. Past workouts started from it are kept.`],
    confirm: 'Delete',
    danger: true,
    apply: () => {
      store.remove('template', template.id)
      return { deleted: true, template_id: template.id }
    },
  }
}

const createExercise: Handler = (input, data): Proposal => {
  const name = str(input.name, 'name')
  if (name.length > 200) throw new ToolError('name is too long (200 characters at most).')
  const duplicate = [...data.exerciseById.values()].find((e) => !e.archivedAt && e.name.toLowerCase() === name.toLowerCase())
  if (duplicate) throw new ToolError(`An exercise named "${duplicate.name}" already exists (id ${duplicate.id}). Use it instead.`)
  const type = input.measurement_type as Measurement['type']
  if (!measurementTypes.includes(type)) throw new ToolError('Unknown measurement_type.')
  let measurement: Measurement
  if (type === 'external_load_reps') {
    if (input.load_convention !== 'total' && input.load_convention !== 'per_hand') throw new ToolError('external_load_reps needs load_convention "total" or "per_hand".')
    measurement = { type, loadConvention: input.load_convention }
  } else {
    measurement = type === 'bodyweight_reps' ? { type } : { type, loadConvention: type === 'weighted_bodyweight_reps' ? 'added' : 'assistance' }
  }
  const now = nowIso()
  const exercise: Exercise = {
    id: newId(),
    name,
    primaryMuscle: input.primary_muscle as MuscleGroup,
    secondaryMuscles: Array.isArray(input.secondary_muscles) ? [...new Set(input.secondary_muscles as MuscleGroup[])].filter((m) => m !== input.primary_muscle) : [],
    equipment: input.equipment as Equipment,
    measurement,
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now,
  }
  return {
    kind: 'proposal',
    title: `Add exercise “${name}”`,
    lines: [`${exercise.primaryMuscle.replace('_', ' ')}, ${exercise.equipment.replace('_', ' ')}`, describeMeasurement(measurement)],
    confirm: 'Add',
    apply: () => {
      store.save('exercise', exercise)
      return { created: true, exercise_id: exercise.id, name }
    },
  }
}

// MARK: Registry

const handlers: Record<string, Handler> = {
  get_overview: getOverview,
  find_exercises: findExercises,
  get_template: getTemplate,
  list_workouts: listWorkouts,
  get_workout: getWorkout,
  exercise_progress: exerciseProgress,
  training_volume: trainingVolume,
  body_weight: bodyWeight,
  save_template: saveTemplate,
  delete_template: deleteTemplate,
  create_exercise: createExercise,
}

/** What the chat shows while a tool runs, e.g. "Looking at your workouts". */
export const toolActivity: Record<string, string> = {
  get_overview: 'Looking at your account',
  find_exercises: 'Searching exercises',
  get_template: 'Reading a template',
  list_workouts: 'Looking at your workouts',
  get_workout: 'Reading a workout',
  exercise_progress: 'Checking your progress',
  training_volume: 'Adding up your weekly volume',
  body_weight: 'Looking at your body weight',
  save_template: 'Preparing a template',
  delete_template: 'Preparing to delete a template',
  create_exercise: 'Preparing a new exercise',
}

export type ToolOutcome = { kind: 'result'; content: string } | { kind: 'error'; content: string } | Proposal

/** Runs a tool by name. Never throws: bad input comes back as an error for Claude to fix. */
export function runTool(name: string, input: unknown, data: Snapshot = store.getSnapshot()): ToolOutcome {
  const handler = handlers[name]
  if (!handler) return { kind: 'error', content: `Unknown tool "${name}". Available: ${Object.keys(handlers).join(', ')}.` }
  try {
    const value = handler((input ?? {}) as Input, data)
    if (value && typeof value === 'object' && (value as Proposal).kind === 'proposal') return value as Proposal
    return { kind: 'result', content: serialize(value) }
  } catch (error) {
    if (error instanceof ToolError) return { kind: 'error', content: error.message }
    console.error(`Tool ${name} failed`, error)
    return { kind: 'error', content: `The tool failed: ${(error as Error).message}` }
  }
}

export function serialize(value: unknown): string {
  const text = JSON.stringify(value, (_k, v) => (v === undefined ? undefined : v))
  if (text.length <= MAX_RESULT_CHARS) return text
  return `${text.slice(0, MAX_RESULT_CHARS)}... [truncated: narrow the date range or ask for fewer results]`
}
