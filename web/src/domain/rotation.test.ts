import { describe, expect, it } from 'vitest'
import type { WorkoutSession, WorkoutTemplate } from './types'
import { estimatedMinutes, upNext } from './workout'

const template = (name: string, sets = 3, rest = 90): WorkoutTemplate => ({
  id: name, name, revision: 1, createdAt: '', updatedAt: '',
  exercises: [{ id: 'e', exerciseId: 'x', restSeconds: rest, sets: Array.from({ length: sets }, (_, i) => ({ id: String(i), type: 'working' as const })) }],
})
const done = (templateId: string, startedAt: string) => ({ state: 'completed', startedAt, sourceTemplate: { templateId, revision: 1 } }) as unknown as WorkoutSession

describe('up next', () => {
  const split = ['Push', '1 · Push', '2 · Pull', '3 · Legs', '4 · Upper', '5 · Lower'].map((n) => template(n))

  it('starts a numbered rotation at day 1', () => {
    expect(upNext(split, [])?.name).toBe('1 · Push')
  })
  it('follows the numbers and wraps around', () => {
    expect(upNext(split, [done('1 · Push', '2026-11-26')])?.name).toBe('2 · Pull')
    expect(upNext(split, [done('5 · Lower', '2026-11-27'), done('4 · Upper', '2026-11-26')])?.name).toBe('1 · Push')
  })
  it('uses list order for unnumbered templates', () => {
    const plain = ['Push', 'Pull', 'Legs'].map((n) => template(n))
    expect(upNext(plain, [done('Pull', '2026-11-26')])?.name).toBe('Legs')
    expect(upNext(plain, [done('Legs', '2026-11-26')])?.name).toBe('Push')
  })
  it('has nothing to suggest without templates', () => {
    expect(upNext([], [])).toBeUndefined()
  })
})

describe('estimated length', () => {
  it('counts work, rest and setup, rounded to 5 minutes', () => {
    // 60 s setup + 4 x 40 s work + 3 x 180 s rest = 760 s, about 13 min -> 15
    expect(estimatedMinutes(template('x', 4, 180))).toBe(15)
  })
})
