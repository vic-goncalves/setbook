import { z } from 'zod'
import catalog from '../../contracts/catalog.json'

/**
 * Zod mirrors of the Swift Codable models (Domain module). The wire format is whatever
 * Swift's JSONEncoder produces: camelCase keys, absent optionals, ISO 8601 dates with
 * milliseconds, uppercase UUIDs. contracts/fixtures/backup.json is checked against these.
 */

const uuid = z.string().regex(/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/, 'Expected a UUID')
const date = z.string().datetime({ offset: true })
const massUnit = z.enum(['kg', 'lb'])
const mass = z.object({ value: z.number().finite(), unit: massUnit })
const repTarget = z.object({ min: z.number().int().min(1), max: z.number().int() }).refine((r) => r.max >= r.min, 'max must be >= min')
const setType = z.enum(['warmup', 'working'])
const restSeconds = z.number().int().positive().optional()
const notes = z.string().max(5000).optional()

export const muscleGroups = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'full_body'] as const
export const equipment = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'smith_machine', 'ez_bar', 'band', 'other'] as const

export const measurementSchema = z
  .object({
    type: z.enum(['external_load_reps', 'bodyweight_reps', 'weighted_bodyweight_reps', 'assisted_bodyweight_reps']),
    loadConvention: z.enum(['total', 'per_hand', 'added', 'assistance']).optional(),
  })
  .refine(
    (m) =>
      (m.type === 'external_load_reps' && (m.loadConvention === 'total' || m.loadConvention === 'per_hand')) ||
      (m.type === 'bodyweight_reps' && m.loadConvention === undefined) ||
      (m.type === 'weighted_bodyweight_reps' && m.loadConvention === 'added') ||
      (m.type === 'assisted_bodyweight_reps' && m.loadConvention === 'assistance'),
    'Load convention does not match measurement type',
  )
export type Measurement = z.infer<typeof measurementSchema>

export const exerciseSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(200),
  primaryMuscle: z.enum(muscleGroups),
  secondaryMuscles: z.array(z.enum(muscleGroups)),
  equipment: z.enum(equipment),
  measurement: measurementSchema,
  isBuiltIn: z.literal(false),
  archivedAt: date.optional(),
  createdAt: date,
  updatedAt: date,
})

export const templateSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(200),
  notes,
  revision: z.number().int().min(1),
  exercises: z
    .array(
      z.object({
        id: uuid,
        exerciseId: uuid,
        notes,
        restSeconds,
        sets: z
          .array(z.object({ id: uuid, type: setType, targetReps: repTarget.optional(), targetLoad: mass.optional() }))
          .max(100),
      }),
    )
    .max(100),
  createdAt: date,
  updatedAt: date,
})

const workoutSet = z.object({
  id: uuid,
  type: setType,
  targetReps: repTarget.optional(),
  targetLoad: mass.optional(),
  load: mass.optional(),
  reps: z.number().int().optional(),
  completedAt: date.optional(),
  rir: z.number().int().min(0).optional(),
})
export type WorkoutSet = z.infer<typeof workoutSet>

export const sessionSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(200),
    state: z.enum(['active', 'completed']),
    sourceTemplate: z.object({ templateId: uuid, revision: z.number().int().min(1) }).optional(),
    startedAt: date,
    finishedAt: date.optional(),
    timeZoneIdentifier: z.string().min(1).max(100),
    notes,
    exercises: z
      .array(
        z.object({
          id: uuid,
          exerciseId: uuid,
          exerciseName: z.string().min(1).max(200),
          measurement: measurementSchema,
          notes,
          restSeconds,
          sets: z.array(workoutSet).max(100),
        }),
      )
      .max(100),
    createdAt: date,
    updatedAt: date,
  })
  .superRefine((session, ctx) => {
    let completed = 0
    for (const exercise of session.exercises) {
      for (const set of exercise.sets) {
        if (!set.completedAt) continue
        completed += 1
        const problem = validateSet(set, exercise.measurement)
        if (problem) ctx.addIssue({ code: 'custom', message: `${exercise.exerciseName}: ${problem}` })
      }
    }
    if (session.state === 'completed' && completed === 0) {
      ctx.addIssue({ code: 'custom', message: 'A completed workout needs at least one completed set' })
    }
  })

export const measurementRecordSchema = z.object({
  id: uuid,
  kind: z.literal('body_weight'),
  mass: mass.refine((m) => m.value > 0, 'Body weight must be greater than zero'),
  measuredAt: date,
  timeZoneIdentifier: z.string().min(1).max(100),
  source: z.literal('manual'),
  note: notes,
  createdAt: date,
  updatedAt: date,
})

/** Same rules as WorkoutSet.validate(for:) in Swift. Zero added load is legitimate. */
export function validateSet(set: WorkoutSet, measurement: Measurement): string | undefined {
  if (set.reps === undefined) return 'missing reps'
  if (set.reps < 1) return 'reps must be at least 1'
  const tracksLoad = measurement.loadConvention !== undefined
  if (tracksLoad) {
    if (!set.load) return 'missing load'
    if (set.load.value < 0) return 'load cannot be negative'
  } else if (set.load) {
    return 'bodyweight sets have no load'
  }
  return undefined
}

export const entities = ['exercise', 'template', 'session', 'measurement'] as const
export type Entity = (typeof entities)[number]

export const bodySchemas = {
  exercise: exerciseSchema,
  template: templateSchema,
  session: sessionSchema,
  measurement: measurementRecordSchema,
} as const

export type Exercise = z.infer<typeof exerciseSchema>
export type Template = z.infer<typeof templateSchema>
export type Session = z.infer<typeof sessionSchema>
export type BodyMeasurement = z.infer<typeof measurementRecordSchema>

const builtInIds = new Set(catalog.map((entry) => entry.id.toUpperCase()))

export function isBuiltInExercise(id: string): boolean {
  return builtInIds.has(id.toUpperCase())
}

/** Exercise IDs a template or session points at, for ownership checks. */
export function referencedExerciseIds(entity: Entity, body: unknown): string[] {
  if (entity === 'template') return (body as Template).exercises.map((e) => e.exerciseId)
  if (entity === 'session') return (body as Session).exercises.map((e) => e.exerciseId)
  return []
}
