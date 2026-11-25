/**
 * The record shapes the iPhone app writes (Swift Codable) and the server validates (zod).
 * Optional fields are absent rather than null, dates are ISO 8601 with milliseconds and IDs
 * are uppercase UUIDs. Keep in step with server/src/records.ts.
 */

export type MassUnit = 'kg' | 'lb'
export interface RecordedMass {
  value: number
  unit: MassUnit
}
export interface RepTarget {
  min: number
  max: number
}
export type SetType = 'warmup' | 'working'
export type MeasurementType = 'external_load_reps' | 'bodyweight_reps' | 'weighted_bodyweight_reps' | 'assisted_bodyweight_reps'
export type LoadConvention = 'total' | 'per_hand' | 'added' | 'assistance'
export interface Measurement {
  type: MeasurementType
  loadConvention?: LoadConvention
}

export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'forearms' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core' | 'full_body'
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell' | 'smith_machine' | 'ez_bar' | 'band' | 'other'

export interface Exercise {
  id: string
  name: string
  primaryMuscle: MuscleGroup
  secondaryMuscles: MuscleGroup[]
  equipment: Equipment
  measurement: Measurement
  isBuiltIn: boolean
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface TemplateSet {
  id: string
  type: SetType
  targetReps?: RepTarget
  targetLoad?: RecordedMass
}
export interface TemplateExercise {
  id: string
  exerciseId: string
  notes?: string
  restSeconds?: number
  sets: TemplateSet[]
}
export interface WorkoutTemplate {
  id: string
  name: string
  notes?: string
  revision: number
  exercises: TemplateExercise[]
  createdAt: string
  updatedAt: string
}

export interface WorkoutSet {
  id: string
  type: SetType
  targetReps?: RepTarget
  targetLoad?: RecordedMass
  load?: RecordedMass
  reps?: number
  completedAt?: string
  rir?: number
}
export interface WorkoutExercise {
  id: string
  exerciseId: string
  exerciseName: string
  measurement: Measurement
  notes?: string
  restSeconds?: number
  sets: WorkoutSet[]
}
export interface WorkoutSession {
  id: string
  name: string
  state: 'active' | 'completed'
  sourceTemplate?: { templateId: string; revision: number }
  startedAt: string
  finishedAt?: string
  timeZoneIdentifier: string
  notes?: string
  exercises: WorkoutExercise[]
  createdAt: string
  updatedAt: string
}

export interface BodyMeasurement {
  id: string
  kind: 'body_weight'
  mass: RecordedMass
  measuredAt: string
  timeZoneIdentifier: string
  source: 'manual'
  note?: string
  createdAt: string
  updatedAt: string
}

export type Entity = 'exercise' | 'template' | 'session' | 'measurement'
export interface EntityBody {
  exercise: Exercise
  template: WorkoutTemplate
  session: WorkoutSession
  measurement: BodyMeasurement
}

export const KG_PER_LB = 0.45359237

export function kilograms(mass: RecordedMass): number {
  return mass.unit === 'kg' ? mass.value : mass.value * KG_PER_LB
}

export function fromKilograms(kg: number, unit: MassUnit): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB
}

/** Shows the original input when units match, so 135 lb never becomes 134.99. */
export function massIn(mass: RecordedMass, unit: MassUnit): number {
  return mass.unit === unit ? mass.value : fromKilograms(kilograms(mass), unit)
}

export function sameLoad(a: RecordedMass, b: RecordedMass): boolean {
  return Math.abs(kilograms(a) - kilograms(b)) < 0.001
}

export function tracksLoad(m: Measurement): boolean {
  return m.loadConvention !== undefined
}

export function sameMeasurement(a: Measurement, b: Measurement): boolean {
  return a.type === b.type && a.loadConvention === b.loadConvention
}

export function newId(): string {
  return crypto.randomUUID().toUpperCase()
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
