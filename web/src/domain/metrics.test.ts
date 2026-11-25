import { describe, expect, it } from 'vitest'
import backup from '../../../contracts/fixtures/backup.json'
import expected from '../../../contracts/fixtures/metrics-expected.json'
import { dailyMeans, exerciseRecords, rollingAverage, series } from './metrics'
import type { BodyMeasurement, Measurement, WorkoutSession } from './types'

const sessions = backup.sessions as WorkoutSession[]
const weights = backup.bodyMeasurements as BodyMeasurement[]
const BENCH = '1E745624-563E-59EB-8458-DD9D29D3CC25'
const ASSISTED = sessions.flatMap((s) => s.exercises).find((e) => e.exerciseName === 'Pull-up (Assisted)')!.exerciseId
const total: Measurement = { type: 'external_load_reps', loadConvention: 'total' }
const assisted: Measurement = { type: 'assisted_bodyweight_reps', loadConvention: 'assistance' }

const round = (points: { sessionId: string; value: number; reps?: number }[]) =>
  points.map((p) => ({ sessionId: p.sessionId, value: Math.round(p.value * 1e6) / 1e6, ...(p.reps === undefined ? {} : { reps: p.reps }) }))

/** The Swift and TypeScript implementations must agree exactly on the shared fixture. */
describe('metrics match the iPhone app', () => {
  const bench = exerciseRecords(sessions, BENCH)
  const pullUps = exerciseRecords(sessions, ASSISTED)

  it('heaviest set', () => expect(round(series('heaviestSet', bench, total))).toEqual(expected.heaviestSet))
  it('volume', () => expect(round(series('volume', bench, total))).toEqual(expected.volume))
  it('best reps at 100 kg across units', () =>
    expect(round(series('bestRepsAtLoad', bench, total, { value: 100, unit: 'kg' }))).toEqual(expected.bestRepsAt100kg))
  it('least assistance', () => expect(round(series('leastAssistance', pullUps, assisted))).toEqual(expected.leastAssistance))
  it('no volume for assisted exercises', () => expect(series('volume', pullUps, assisted)).toEqual(expected.assistedVolume))
  it('body weight daily means', () =>
    expect(dailyMeans(weights).map((d) => ({ ...d, meanKilograms: Math.round(d.meanKilograms * 1e6) / 1e6 }))).toEqual(expected.dailyMeans))
  it('7-day rolling average', () =>
    expect(rollingAverage(dailyMeans(weights)).map((d) => ({ ...d, kilograms: Math.round(d.kilograms * 1e6) / 1e6 }))).toEqual(expected.rollingAverage))
})
