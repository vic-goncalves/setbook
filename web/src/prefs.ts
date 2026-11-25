import { useSyncExternalStore } from 'react'
import { currentUser, updateProfile } from './api'
import type { MassUnit } from './domain/types'

interface Prefs {
  unit: MassUnit
  defaultRest: number
  rest?: { endsAt: number; duration: number }
}

const KEY = 'setbook.prefs'
const listeners = new Set<() => void>()
let prefs: Prefs = load()

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return { unit: currentUser()?.massUnit ?? saved.unit ?? 'lb', defaultRest: saved.defaultRest ?? 90, rest: saved.rest }
  } catch {
    return { unit: 'lb', defaultRest: 90 }
  }
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch }
  localStorage.setItem(KEY, JSON.stringify(prefs))
  listeners.forEach((l) => l())
  if (patch.unit) void updateProfile({ massUnit: patch.unit }).catch(() => undefined)
}

export function reloadPrefs() {
  prefs = load()
  listeners.forEach((l) => l())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => prefs,
  )
}

/** Stored as an end timestamp so the countdown stays right across reloads. */
export function startRest(seconds: number) {
  setPrefs({ rest: { endsAt: Date.now() + seconds * 1000, duration: seconds } })
}
export function adjustRest(seconds: number) {
  if (prefs.rest) setPrefs({ rest: { endsAt: prefs.rest.endsAt + seconds * 1000, duration: Math.max(1, prefs.rest.duration + seconds) } })
}
export function clearRest() {
  setPrefs({ rest: undefined })
}
