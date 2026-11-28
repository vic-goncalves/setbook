import type { Exercise, RecordedMass, RepTarget, TemplateSet, WorkoutExercise, WorkoutSession, WorkoutSet, WorkoutTemplate } from './types'
import { localTimeZone, newId, nowIso, sameLoad, tracksLoad } from './types'
import { validateSet } from './metrics'

/** Port of the Swift Domain workout rules. Templates and sessions never share identity. */

export const DEFAULT_REST = 90

export function emptySession(now = nowIso()): WorkoutSession {
  return { id: newId(), name: 'Workout', state: 'active', startedAt: now, timeZoneIdentifier: localTimeZone(), exercises: [], createdAt: now, updatedAt: now }
}

export function workoutExerciseFrom(exercise: Exercise, restSeconds: number | undefined = DEFAULT_REST): WorkoutExercise {
  return { id: newId(), exerciseId: exercise.id, exerciseName: exercise.name, measurement: exercise.measurement, restSeconds, sets: [{ id: newId(), type: 'working' }] }
}

/** Snapshots a template into an independent session. */
export function startFromTemplate(template: WorkoutTemplate, catalog: Map<string, Exercise>, now = nowIso()): WorkoutSession {
  return {
    ...emptySession(now),
    name: template.name,
    sourceTemplate: { templateId: template.id, revision: template.revision },
    exercises: template.exercises.flatMap((te) => {
      const exercise = catalog.get(te.exerciseId.toUpperCase())
      if (!exercise) return []
      return [{
        id: newId(), exerciseId: exercise.id, exerciseName: exercise.name, measurement: exercise.measurement,
        notes: te.notes, restSeconds: te.restSeconds,
        sets: te.sets.map((s) => strip({ id: newId(), type: s.type, targetReps: s.targetReps, targetLoad: s.targetLoad })),
      }]
    }),
  }
}

/** A new session whose targets are a past session's logged values; all sets start incomplete. */
export function repeatSession(past: WorkoutSession, catalog: Map<string, Exercise>, now = nowIso()): WorkoutSession {
  return {
    ...emptySession(now),
    name: past.name,
    sourceTemplate: past.sourceTemplate,
    exercises: past.exercises.flatMap((e) => {
      const sets = e.sets.filter((s) => s.completedAt).map((s) =>
        strip({ id: newId(), type: s.type, targetReps: s.reps ? { min: s.reps, max: s.reps } : undefined, targetLoad: s.load }),
      )
      if (sets.length === 0) return []
      const current = catalog.get(e.exerciseId.toUpperCase())
      return [{ id: newId(), exerciseId: e.exerciseId, exerciseName: current?.name ?? e.exerciseName, measurement: current?.measurement ?? e.measurement, notes: e.notes, restSeconds: e.restSeconds, sets }]
    }),
  }
}

/** Completed form: incomplete sets and emptied exercises dropped; undefined if nothing was done. */
export function finishSession(session: WorkoutSession, now = nowIso()): WorkoutSession | undefined {
  const exercises = session.exercises
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.completedAt) }))
    .filter((e) => e.sets.length > 0)
  if (exercises.length === 0) return undefined
  const finishedAt = now < session.startedAt ? session.startedAt : now
  return { ...session, exercises, state: 'completed', finishedAt, updatedAt: now }
}

export function completedSetCount(s: WorkoutSession) {
  return s.exercises.reduce((n, e) => n + e.sets.filter((x) => x.completedAt).length, 0)
}
export function incompleteSetCount(s: WorkoutSession) {
  return s.exercises.reduce((n, e) => n + e.sets.filter((x) => !x.completedAt).length, 0)
}
export function workingSetCount(s: WorkoutSession) {
  return s.exercises.reduce((n, e) => n + e.sets.filter((x) => x.completedAt && x.type === 'working').length, 0)
}

export function addSet(exercise: WorkoutExercise): WorkoutExercise {
  const last = exercise.sets.at(-1)
  return { ...exercise, sets: [...exercise.sets, strip({ id: newId(), type: last?.type ?? 'working', targetReps: last?.targetReps, targetLoad: last?.targetLoad })] }
}

/** "W" for warm-ups, otherwise the working-set number. */
export function setLabel(sets: { type: string }[], index: number): string {
  if (sets[index]?.type === 'warmup') return 'W'
  return String(sets.slice(0, index).filter((s) => s.type === 'working').length + 1)
}

// MARK: Previous performance

export interface PreviousPerformance {
  sessionId: string
  date: string
  sets: WorkoutSet[]
}

/** The latest completed workout containing this exercise (k-th occurrence), excluding `excluding`. */
export function previousPerformance(sessions: WorkoutSession[], exerciseId: string, excluding: string, occurrence: number): PreviousPerformance | undefined {
  const id = exerciseId.toUpperCase()
  const latest = sessions
    .filter((s) => s.state === 'completed' && s.id !== excluding && s.exercises.some((e) => e.exerciseId.toUpperCase() === id))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  if (!latest) return undefined
  const match = latest.exercises.filter((e) => e.exerciseId.toUpperCase() === id)[occurrence]
  return match ? { sessionId: latest.id, date: latest.startedAt, sets: match.sets.filter((s) => s.completedAt) } : undefined
}

/** Aligns by type and ordinal; undefined rather than guessing. */
export function counterpart(previous: PreviousPerformance | undefined, current: WorkoutSet[], index: number): WorkoutSet | undefined {
  const set = current[index]
  if (!previous || !set) return undefined
  const ordinal = current.slice(0, index).filter((s) => s.type === set.type).length
  return previous.sets.filter((s) => s.type === set.type)[ordinal]
}

export function placeholder(set: WorkoutSet, prior: WorkoutSet | undefined): { load?: RecordedMass; reps?: number } {
  return { load: prior?.load ?? set.targetLoad, reps: prior?.reps ?? set.targetReps?.min }
}

/** Completes a set, accepting the shown placeholders as confirmation. Returns an error message instead if not recordable. */
export function completeSet(exercise: WorkoutExercise, index: number, prior: WorkoutSet | undefined, now = nowIso()): WorkoutExercise | string {
  const set = exercise.sets[index]
  if (!set) return 'Set not found'
  const p = placeholder(set, prior)
  const candidate: WorkoutSet = { ...set, reps: set.reps ?? p.reps, load: tracksLoad(exercise.measurement) ? (set.load ?? p.load) : undefined, completedAt: now }
  const problem = validateSet(candidate, exercise.measurement)
  if (problem) return problem
  return { ...exercise, sets: exercise.sets.map((s, i) => (i === index ? strip(candidate) : s)) }
}

// MARK: Templates

export function duplicateTemplate(t: WorkoutTemplate, now = nowIso()): WorkoutTemplate {
  return {
    id: newId(), name: `${t.name} copy`, notes: t.notes, revision: 1, createdAt: now, updatedAt: now,
    exercises: t.exercises.map((e) => ({ ...e, id: newId(), sets: e.sets.map((s) => ({ ...s, id: newId() })) })),
  }
}

export function templateFromSession(session: WorkoutSession, name: string, now = nowIso()): WorkoutTemplate {
  return {
    id: newId(), name, notes: session.notes, revision: 1, createdAt: now, updatedAt: now,
    exercises: session.exercises.map((e) => ({
      id: newId(), exerciseId: e.exerciseId, notes: e.notes, restSeconds: e.restSeconds,
      sets: e.sets.map((s) => strip({ id: newId(), type: s.type, targetReps: s.targetReps, targetLoad: s.targetLoad })),
    })),
  }
}

export interface TemplateProposal {
  changes: string[]
  updated: WorkoutTemplate
}

/** Structure/prescription changes only; actual performance never rewrites targets. */
export function templateProposal(template: WorkoutTemplate, session: WorkoutSession, nameOf: (id: string) => string, now = nowIso()): TemplateProposal | undefined {
  const remaining = new Map<string, typeof template.exercises>()
  for (const te of template.exercises) remaining.set(te.exerciseId.toUpperCase(), [...(remaining.get(te.exerciseId.toUpperCase()) ?? []), te])
  const matches = session.exercises.map((se) => {
    const list = remaining.get(se.exerciseId.toUpperCase())
    const te = list?.shift()
    return { se, te }
  })
  const changes: string[] = []
  const matchedIds = new Set(matches.flatMap((m) => (m.te ? [m.te.id] : [])))
  for (const te of template.exercises) if (!matchedIds.has(te.id)) changes.push(`Remove ${nameOf(te.exerciseId)}`)

  const exercises = matches.map(({ se, te }) => {
    const planned: TemplateSet[] = se.sets.map((s) => strip({ id: newId(), type: s.type, targetReps: s.targetReps, targetLoad: s.targetLoad }))
    if (!te) {
      changes.push(`Add ${se.exerciseName}`)
      return { id: newId(), exerciseId: se.exerciseId, notes: se.notes, restSeconds: se.restSeconds, sets: planned }
    }
    if (te.sets.length !== planned.length) changes.push(`${se.exerciseName}: ${te.sets.length} -> ${planned.length} sets`)
    else if (!te.sets.every((s, i) => samePrescription(s, planned[i]!))) changes.push(`${se.exerciseName}: update set types or targets`)
    return { ...te, sets: planned.map((s, i) => (te.sets[i] ? { ...s, id: te.sets[i]!.id } : s)) }
  })
  const keptOrder = template.exercises.map((e) => e.id).filter((id) => matchedIds.has(id))
  const sessionOrder = matches.flatMap((m) => (m.te ? [m.te.id] : []))
  if (keptOrder.join() !== sessionOrder.join()) changes.push('Reorder exercises')
  if (changes.length === 0) return undefined
  return { changes, updated: { ...template, exercises, revision: template.revision + 1, updatedAt: now } }
}

function samePrescription(a: TemplateSet, b: TemplateSet): boolean {
  if (a.type !== b.type || !sameTarget(a.targetReps, b.targetReps)) return false
  if (!a.targetLoad || !b.targetLoad) return !a.targetLoad && !b.targetLoad
  return sameLoad(a.targetLoad, b.targetLoad)
}

function sameTarget(a?: RepTarget, b?: RepTarget) {
  return a?.min === b?.min && a?.max === b?.max
}

/** Drops undefined keys so records match the iPhone's JSON (absent, never null). */
export function strip<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

/** Rough length: each set ~40 s of work plus its rest, and a minute to set up each exercise. */
export function estimatedMinutes(t: WorkoutTemplate): number {
  let seconds = 0
  for (const e of t.exercises) {
    const rest = e.restSeconds ?? 90
    seconds += 60 + e.sets.length * 40 + Math.max(0, e.sets.length - 1) * rest
  }
  return Math.max(5, Math.round(seconds / 60 / 5) * 5)
}
