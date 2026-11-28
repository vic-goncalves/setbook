import { describe, expect, it } from 'vitest'
import { workoutHighlights } from './metrics'
import type { WorkoutSession } from './types'

const BENCH = 'BENCH'
let n = 0
const workout = (day: string, sets: [number, number][], extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: `w${++n}`, name: 'Push', state: 'completed', startedAt: `2026-11-${day}T10:00:00.000Z`, timeZoneIdentifier: 'UTC', createdAt: '', updatedAt: '',
  exercises: [{
    id: `e${n}`, exerciseId: BENCH, exerciseName: 'Bench Press (Barbell)', measurement: { type: 'external_load_reps', loadConvention: 'total' },
    sets: sets.map(([kg, reps], i) => ({ id: `s${n}-${i}`, type: 'working' as const, load: { value: kg, unit: 'kg' as const }, reps, completedAt: '2026-11-01T00:00:00.000Z' })),
  }],
  ...extra,
})

describe('workout highlights', () => {
  const first = workout('02', [[80, 5], [80, 5]])
  const better = workout('05', [[82.5, 5], [80, 6]])
  const worse = workout('09', [[82.5, 3]])

  it('marks a first workout as first, with no change or record', () => {
    const [h] = workoutHighlights(first, [first])
    expect(h!.change).toBeUndefined()
    expect(h!.record).toBe(false)
    expect(h!.volumeKg).toBe(800)
  })

  it('compares the top set with last time and spots a record', () => {
    const [h] = workoutHighlights(better, [first, better, worse])
    expect(h!.top?.load?.value).toBe(82.5)
    expect(h!.change).toBeCloseTo(2.5)
    expect(h!.record).toBe(true)
    expect(h!.previous?.date).toBe(first.startedAt)
  })

  it('same top weight with fewer reps is not a record', () => {
    const [h] = workoutHighlights(worse, [first, better, worse])
    expect(h!.change).toBe(0)
    expect(h!.repChange).toBe(-2)
    expect(h!.record).toBe(false)
  })
})
