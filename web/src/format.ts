import type { MassUnit, RecordedMass, WorkoutSet } from './domain/types'
import { fromKilograms, massIn } from './domain/types'

export function num(value: number, max = 2): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: max, useGrouping: false }).format(value)
}
export function mass(m: RecordedMass, unit: MassUnit, withUnit = true): string {
  const text = num(massIn(m, unit))
  return withUnit ? `${text} ${unit}` : text
}
export function kg(value: number, unit: MassUnit, withUnit = true): string {
  const text = num(fromKilograms(value, unit), 1)
  return withUnit ? `${text} ${unit}` : text
}
export function signed(value: number): string {
  const text = num(Math.abs(value), 1)
  return text === '0' ? '0' : `${value > 0 ? '+' : '-'}${text}`
}
export function setText(s: WorkoutSet, unit: MassUnit): string {
  if (s.reps === undefined) return '-'
  return s.load ? `${mass(s.load, unit, false)} x ${s.reps}` : `x ${s.reps}`
}
export function stopwatch(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
export function clock(seconds: number): string {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export function day(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone })
}
export function relativeDay(iso: string): string {
  const then = new Date(iso)
  const today = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(then)) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return day(iso)
}
/** Calendar day string "YYYY-MM-DD" rendered as "Nov 25, 2026". */
export function calendarDay(isoDay: string): string {
  return new Date(`${isoDay}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
export function parseDecimal(text: string): number | undefined {
  const cleaned = text.trim().replace(',', '.')
  if (!cleaned) return undefined
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : undefined
}
export function parseInteger(text: string): number | undefined {
  const value = parseDecimal(text)
  return value !== undefined && Number.isInteger(value) ? value : undefined
}
