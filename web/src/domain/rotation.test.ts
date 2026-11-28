import { describe, expect, it } from 'vitest'
import type { WorkoutTemplate } from './types'
import { estimatedMinutes } from './workout'

const template = (name: string, sets = 3, rest = 90): WorkoutTemplate => ({
  id: name, name, revision: 1, createdAt: '', updatedAt: '',
  exercises: [{ id: 'e', exerciseId: 'x', restSeconds: rest, sets: Array.from({ length: sets }, (_, i) => ({ id: String(i), type: 'working' as const })) }],
})

describe('estimated length', () => {
  it('counts work, rest and setup, rounded to 5 minutes', () => {
    // 60 s setup + 4 x 40 s work + 3 x 180 s rest = 760 s, about 13 min -> 15
    expect(estimatedMinutes(template('x', 4, 180))).toBe(15)
  })
})
