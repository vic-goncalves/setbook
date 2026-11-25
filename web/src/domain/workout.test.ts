import { describe, expect, it } from 'vitest'
import { builtInExercises } from './catalog'
import { completeSet, counterpart, finishSession, repeatSession, startFromTemplate, templateProposal } from './workout'
import type { WorkoutSession, WorkoutTemplate } from './types'

const catalog = new Map(builtInExercises.map((e) => [e.id, e]))
const bench = builtInExercises.find((e) => e.name === 'Bench Press (Barbell)')!
const pullUp = builtInExercises.find((e) => e.name === 'Pull-up')!
const template: WorkoutTemplate = {
  id: 'T', name: 'Push', revision: 3, createdAt: '', updatedAt: '',
  exercises: [{ id: 'TE', exerciseId: bench.id, restSeconds: 120, sets: [
    { id: 'S1', type: 'warmup', targetReps: { min: 10, max: 10 } },
    { id: 'S2', type: 'working', targetReps: { min: 5, max: 8 }, targetLoad: { value: 185, unit: 'lb' } },
  ] }],
}

describe('workout rules', () => {
  it('starts an independent snapshot with the source revision', () => {
    const s = startFromTemplate(template, catalog)
    expect(s.sourceTemplate).toEqual({ templateId: 'T', revision: 3 })
    expect(s.exercises[0]!.sets.every((x) => !x.completedAt && x.reps === undefined)).toBe(true)
    expect(s.exercises[0]!.id).not.toBe('TE')
  })

  it('completes a set from the shown suggestion only when confirmed, and validates', () => {
    const s = startFromTemplate(template, catalog)
    const done = completeSet(s.exercises[0]!, 1, undefined)
    expect(typeof done).not.toBe('string')
    if (typeof done !== 'string') expect(done.sets[1]).toMatchObject({ reps: 5, load: { value: 185, unit: 'lb' } })
    expect(completeSet(s.exercises[0]!, 0, undefined)).toBe('Enter a weight')
    const bodyweight = { id: 'X', exerciseId: pullUp.id, exerciseName: 'Pull-up', measurement: pullUp.measurement, sets: [{ id: 'P', type: 'working' as const, reps: 8, load: { value: 10, unit: 'kg' as const } }] }
    const result = completeSet(bodyweight, 0, undefined)
    expect(typeof result !== 'string' && result.sets[0]!.load).toBeUndefined()
  })

  it('aligns previous sets by type and ordinal', () => {
    const prev = { sessionId: 'p', date: '', sets: [{ id: 'a', type: 'working' as const, reps: 8, completedAt: 'x' }] }
    const today = [{ id: '1', type: 'warmup' as const }, { id: '2', type: 'working' as const }, { id: '3', type: 'working' as const }]
    expect(counterpart(prev, today, 0)).toBeUndefined()
    expect(counterpart(prev, today, 1)?.reps).toBe(8)
    expect(counterpart(prev, today, 2)).toBeUndefined()
  })

  it('finishes without incomplete sets and refuses an empty workout', () => {
    const s = startFromTemplate(template, catalog)
    expect(finishSession(s)).toBeUndefined()
    s.exercises[0]!.sets[1]!.completedAt = 'now'
    s.exercises[0]!.sets[1]!.reps = 6
    s.exercises[0]!.sets[1]!.load = { value: 185, unit: 'lb' }
    const done = finishSession(s)!
    expect(done.state).toBe('completed')
    expect(done.exercises[0]!.sets).toHaveLength(1)
  })

  it('repeats a workout using logged values as incomplete targets', () => {
    const past: WorkoutSession = { ...startFromTemplate(template, catalog), state: 'completed' }
    past.exercises[0]!.sets[1] = { ...past.exercises[0]!.sets[1]!, reps: 7, load: { value: 190, unit: 'lb' }, completedAt: 'x' }
    const next = repeatSession(past, catalog)
    expect(next.exercises[0]!.sets).toEqual([expect.objectContaining({ targetReps: { min: 7, max: 7 }, targetLoad: { value: 190, unit: 'lb' } })])
    expect(next.exercises[0]!.sets[0]!.completedAt).toBeUndefined()
  })

  it('proposes template changes for structure only', () => {
    const s = startFromTemplate(template, catalog)
    s.exercises[0]!.sets[1]!.reps = 12
    expect(templateProposal(template, s, () => '')).toBeUndefined()
    s.exercises[0]!.sets.push({ id: 'new', type: 'working' })
    const proposal = templateProposal(template, s, () => '')!
    expect(proposal.changes).toEqual(['Bench Press (Barbell): 2 -> 3 sets'])
    expect(proposal.updated.revision).toBe(4)
  })
})
