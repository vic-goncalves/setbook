import catalogJson from '../../../contracts/catalog.json'
import type { Equipment, Exercise, Measurement, MuscleGroup } from './types'

const EPOCH = new Date(0).toISOString()

/** The built-in catalog, generated from the iPhone app so IDs are identical everywhere. */
export const builtInExercises: Exercise[] = catalogJson.map((entry) => ({
  id: entry.id,
  name: entry.name,
  primaryMuscle: entry.primaryMuscle as MuscleGroup,
  secondaryMuscles: [],
  equipment: entry.equipment as Equipment,
  measurement: entry.measurement as Measurement,
  isBuiltIn: true,
  createdAt: EPOCH,
  updatedAt: EPOCH,
}))

export const muscleNames: Record<MuscleGroup, string> = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms',
  quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves', core: 'Core', full_body: 'Full body',
}

export const equipmentNames: Record<Equipment, string> = {
  barbell: 'Barbell', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable', bodyweight: 'Bodyweight', kettlebell: 'Kettlebell',
  smith_machine: 'Smith machine', ez_bar: 'EZ bar', band: 'Band', other: 'Other',
}

export function loadLabel(m: Measurement): string | undefined {
  switch (m.loadConvention) {
    case 'total': return 'Total load'
    case 'per_hand': return 'Per hand'
    case 'added': return 'Added'
    case 'assistance': return 'Assistance'
    default: return undefined
  }
}

export function loadExplanation(m: Measurement): string | undefined {
  switch (m.loadConvention) {
    case 'total': return 'Enter the full weight moved, including the bar.'
    case 'per_hand': return 'Enter the weight of one dumbbell or handle.'
    case 'added': return 'Enter only the weight added to your body, such as a belt or vest. Zero is allowed.'
    case 'assistance': return 'Enter the assistance from the machine or band. Less assistance at similar reps can mean progress.'
    default: return undefined
  }
}

export function matchesSearch(exercise: Exercise, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = `${exercise.name} ${equipmentNames[exercise.equipment]} ${muscleNames[exercise.primaryMuscle]}`.toLowerCase()
  return terms.every((t) => haystack.includes(t))
}
