import { describe, expect, it } from 'vitest'
import type { WorkoutTemplate } from './types'
import { estimatedMinutes, weekStreak } from './workout'

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

describe('week streak', () => {
  // Saturday Nov 28, 2026; weeks start Monday (Nov 23, 16, 9, 2).
  const today = '2026-11-28'
  it('counts consecutive weeks with a workout, up to this week', () => {
    expect(weekStreak(new Set(['2026-11-24', '2026-11-18', '2026-11-10']), today)).toBe(3)
  })
  it("doesn't break just because this week has no workout yet", () => {
    expect(weekStreak(new Set(['2026-11-18', '2026-11-10']), '2026-11-23')).toBe(2)
  })
  it('stops at the first empty week', () => {
    expect(weekStreak(new Set(['2026-11-24', '2026-11-04']), today)).toBe(1)
    expect(weekStreak(new Set(), today)).toBe(0)
  })
})
