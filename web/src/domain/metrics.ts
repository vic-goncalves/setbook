import type { BodyMeasurement, Measurement, RecordedMass, WorkoutSession, WorkoutSet } from './types'
import { kilograms, sameLoad, sameMeasurement, tracksLoad } from './types'

/**
 * Port of the Swift Metrics module (definition version 1). contracts/fixtures/metrics-expected.json
 * holds the numbers Swift computes; metrics.test.ts checks these functions reproduce them.
 * Inputs are completed working sets with valid values only; one point per session.
 */

export interface SessionRecord {
  sessionId: string
  sessionName: string
  startedAt: string
  measurement: Measurement
  sets: WorkoutSet[]
}

export type MetricKind = 'heaviestSet' | 'volume' | 'bestRepsAtLoad' | 'bestReps' | 'totalReps' | 'leastAssistance'

export interface MetricPoint {
  sessionId: string
  sessionName: string
  date: string
  /** Kilograms for mass metrics (kg x reps for volume); a count for rep metrics. */
  value: number
  reps?: number
  supportingSets: WorkoutSet[]
}

export function validateSet(set: WorkoutSet, m: Measurement): string | undefined {
  if (set.reps === undefined) return 'Enter reps'
  if (set.reps < 1) return 'Reps must be at least 1'
  if (tracksLoad(m)) {
    if (!set.load) return 'Enter a weight'
    if (set.load.value < 0) return 'Weight cannot be negative'
  } else if (set.load) {
    return 'Bodyweight sets have no weight'
  }
  return undefined
}

export function qualifyingSets(record: SessionRecord): WorkoutSet[] {
  return record.sets.filter((s) => s.completedAt && s.type === 'working' && validateSet(s, record.measurement) === undefined)
}

/** Every completed session's sets for an exercise, combined per session, oldest first. */
export function exerciseRecords(sessions: WorkoutSession[], exerciseId: string): SessionRecord[] {
  return sessions
    .filter((s) => s.state === 'completed')
    .map((s) => {
      const matching = s.exercises.filter((e) => e.exerciseId.toUpperCase() === exerciseId.toUpperCase())
      if (matching.length === 0) return undefined
      return { sessionId: s.id, sessionName: s.name, startedAt: s.startedAt, measurement: matching[0]!.measurement, sets: matching.flatMap((e) => e.sets) }
    })
    .filter((r): r is SessionRecord => r !== undefined)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function availableMetrics(m: Measurement): MetricKind[] {
  switch (m.type) {
    case 'external_load_reps': return ['heaviestSet', 'volume', 'bestRepsAtLoad']
    case 'bodyweight_reps': return ['bestReps', 'totalReps']
    case 'weighted_bodyweight_reps': return ['heaviestSet', 'bestRepsAtLoad', 'bestReps']
    case 'assisted_bodyweight_reps': return ['leastAssistance', 'bestRepsAtLoad', 'bestReps']
  }
}

export function metricTitle(kind: MetricKind, m: Measurement): string {
  switch (kind) {
    case 'heaviestSet': return m.type === 'weighted_bodyweight_reps' ? 'Heaviest added load' : 'Heaviest set'
    case 'volume': return m.loadConvention === 'per_hand' ? 'Volume (per-hand load x reps)' : 'Volume (load x reps)'
    case 'bestRepsAtLoad': return m.type === 'assisted_bodyweight_reps' ? 'Best reps at assistance' : m.type === 'weighted_bodyweight_reps' ? 'Best reps at added load' : 'Best reps at load'
    case 'bestReps': return 'Best reps'
    case 'totalReps': return 'Total reps'
    case 'leastAssistance': return 'Least assistance'
  }
}

export function isMassMetric(kind: MetricKind): boolean {
  return kind === 'heaviestSet' || kind === 'volume' || kind === 'leastAssistance'
}

const loadKg = (s: WorkoutSet) => (s.load ? kilograms(s.load) : 0)

export function series(kind: MetricKind, records: SessionRecord[], m: Measurement, atLoad?: RecordedMass): MetricPoint[] {
  return records
    .filter((r) => sameMeasurement(r.measurement, m))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((r) => point(kind, r, atLoad))
    .filter((p): p is MetricPoint => p !== undefined)
}

function point(kind: MetricKind, record: SessionRecord, atLoad?: RecordedMass): MetricPoint | undefined {
  const sets = qualifyingSets(record)
  if (sets.length === 0) return undefined
  const make = (value: number, reps: number | undefined, supportingSets: WorkoutSet[]): MetricPoint => ({
    sessionId: record.sessionId, sessionName: record.sessionName, date: record.startedAt, value, reps, supportingSets,
  })
  const m = record.measurement
  switch (kind) {
    case 'heaviestSet': {
      if (m.loadConvention === 'assistance') return undefined
      const best = sets.reduce((a, b) => (heavier(b, a) ? b : a))
      return best.load ? make(kilograms(best.load), best.reps, [best]) : undefined
    }
    case 'leastAssistance': {
      if (m.type !== 'assisted_bodyweight_reps') return undefined
      const best = sets.reduce((a, b) => (lighter(b, a) ? b : a))
      return best.load ? make(kilograms(best.load), best.reps, [best]) : undefined
    }
    case 'volume': {
      if (m.type !== 'external_load_reps') return undefined
      return make(sets.reduce((sum, s) => sum + loadKg(s) * (s.reps ?? 0), 0), undefined, sets)
    }
    case 'bestRepsAtLoad': {
      if (!atLoad) return undefined
      const at = sets.filter((s) => s.load && sameLoad(s.load, atLoad))
      if (at.length === 0) return undefined
      const best = at.reduce((a, b) => ((b.reps ?? 0) > (a.reps ?? 0) ? b : a))
      return make(best.reps ?? 0, best.reps, [best])
    }
    case 'bestReps': {
      const best = sets.reduce((a, b) => ((b.reps ?? 0) > (a.reps ?? 0) ? b : a))
      return make(best.reps ?? 0, best.reps, [best])
    }
    case 'totalReps': {
      const total = sets.reduce((sum, s) => sum + (s.reps ?? 0), 0)
      return make(total, total, sets)
    }
  }
}

/** Heavier wins; equal loads (within 1 g) are broken by more reps. */
function heavier(a: WorkoutSet, b: WorkoutSet): boolean {
  const diff = loadKg(a) - loadKg(b)
  if (Math.abs(diff) >= 0.001) return diff > 0
  return (a.reps ?? 0) > (b.reps ?? 0)
}

/** Less assistance wins; equal assistance is broken by more reps. */
function lighter(a: WorkoutSet, b: WorkoutSet): boolean {
  const diff = loadKg(a) - loadKg(b)
  if (Math.abs(diff) >= 0.001) return diff < 0
  return (a.reps ?? 0) > (b.reps ?? 0)
}

export function distinctLoads(records: SessionRecord[], m: Measurement): RecordedMass[] {
  const loads: RecordedMass[] = []
  for (const r of records.filter((r) => sameMeasurement(r.measurement, m))) {
    for (const s of qualifyingSets(r)) {
      if (s.load && !loads.some((l) => sameLoad(l, s.load!))) loads.push(s.load)
    }
  }
  return loads.sort((a, b) => kilograms(b) - kilograms(a))
}

export interface RecordEntry {
  load?: RecordedMass
  reps: number
  date: string
  sessionId: string
}

export function personalRecords(records: SessionRecord[], m: Measurement) {
  let bestLoad: RecordEntry | undefined
  let mostReps: RecordEntry | undefined
  const byLoad: RecordEntry[] = []
  const assisted = m.type === 'assisted_bodyweight_reps'
  for (const r of records.filter((r) => sameMeasurement(r.measurement, m)).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    for (const s of qualifyingSets(r)) {
      const reps = s.reps ?? 0
      const entry: RecordEntry = { load: s.load, reps, date: r.startedAt, sessionId: r.sessionId }
      if (reps > (mostReps?.reps ?? 0)) mostReps = entry
      if (!s.load) continue
      if (!bestLoad?.load) {
        bestLoad = entry
      } else {
        const diff = kilograms(s.load) - kilograms(bestLoad.load)
        const better = assisted ? diff < -0.001 : diff > 0.001
        if (better || (sameLoad(s.load, bestLoad.load) && reps > bestLoad.reps)) bestLoad = entry
      }
      const existing = byLoad.findIndex((e) => e.load && sameLoad(e.load, s.load!))
      if (existing === -1) byLoad.push(entry)
      else if (reps > byLoad[existing]!.reps) byLoad[existing] = entry
    }
  }
  return {
    bestLoad: tracksLoad(m) ? bestLoad : undefined,
    mostRepsByLoad: byLoad.sort((a, b) => (b.load ? kilograms(b.load) : 0) - (a.load ? kilograms(a.load) : 0)),
    mostReps,
  }
}

// MARK: Body weight

export interface DailyWeight {
  day: string
  meanKilograms: number
  count: number
}

/** "YYYY-MM-DD" in the time zone the measurement was taken in. */
export function localDay(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T12:00:00Z`) / 86_400_000)
}

export function dailyMeans(entries: BodyMeasurement[]): DailyWeight[] {
  const groups = new Map<string, number[]>()
  for (const e of entries.filter((e) => e.mass.value > 0)) {
    const day = localDay(e.measuredAt, e.timeZoneIdentifier)
    groups.set(day, [...(groups.get(day) ?? []), kilograms(e.mass)])
  }
  return [...groups.entries()]
    .map(([day, values]) => ({ day, meanKilograms: values.reduce((a, b) => a + b, 0) / values.length, count: values.length }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

/** For each observed day D, the mean of observed daily means in D-6..D. Gaps are never filled. */
export function rollingAverage(daily: DailyWeight[]) {
  return daily.map((current) => {
    const window = daily.filter((d) => {
      const offset = dayNumber(current.day) - dayNumber(d.day)
      return offset >= 0 && offset < 7
    })
    return { day: current.day, kilograms: window.reduce((a, b) => a + b.meanKilograms, 0) / window.length, observedDays: window.length }
  })
}

export type ChartRange = '1M' | '3M' | '6M' | '1Y' | 'All'
export const chartRanges: ChartRange[] = ['1M', '3M', '6M', '1Y', 'All']

export function rangeStart(range: ChartRange, now = new Date()): Date | undefined {
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, All: 0 }[range]
  if (months === 0) return undefined
  const start = new Date(now)
  start.setMonth(start.getMonth() - months)
  return start
}

export function inRange(iso: string, range: ChartRange, now = new Date()): boolean {
  const start = rangeStart(range, now)
  return !start || new Date(iso) >= start
}

export function bodyWeightSummary(entries: BodyMeasurement[], range: ChartRange, now = new Date()) {
  const all = dailyMeans(entries)
  const start = rangeStart(range, now)
  const startDay = start ? start.toISOString().slice(0, 10) : undefined
  const daily = all.filter((d) => !startDay || d.day >= startDay)
  const average = daily.length >= 2 ? rollingAverage(all).filter((p) => !startDay || p.day >= startDay) : []
  const first = daily[0]
  const last = daily.at(-1)
  return {
    latest: [...entries].filter((e) => e.mass.value > 0).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0],
    daily,
    rollingAverage: average,
    change: daily.length >= 2 && first && last ? { from: first.day, to: last.day, kilograms: last.meanKilograms - first.meanKilograms } : undefined,
  }
}

// MARK: Workout highlights (History)

export interface ExerciseHighlight {
  exerciseId: string
  /** Heaviest completed working set (least assistance for assisted), or the most reps without load. */
  top?: WorkoutSet
  /** Same exercise's top set in the previous workout that had it. */
  previous?: { set: WorkoutSet; date: string }
  /** Change in the top set's load (kg); for bodyweight sets, in reps. Undefined the first time. */
  change?: number
  /** Change in the top set's reps when its load is the same as last time's. */
  repChange?: number
  /** True when the top set beats every earlier workout (heavier, or same load and more reps). */
  record: boolean
  /** Sum of load x reps over completed working sets (kg); per-hand loads count once. */
  volumeKg: number
}

function topSet(sets: WorkoutSet[], m: Measurement): WorkoutSet | undefined {
  if (sets.length === 0) return undefined
  const assisted = m.type === 'assisted_bodyweight_reps'
  return sets.reduce((a, b) => {
    const diff = loadKg(b) - loadKg(a)
    if (Math.abs(diff) >= 0.001) return (assisted ? diff < 0 : diff > 0) ? b : a
    return (b.reps ?? 0) > (a.reps ?? 0) ? b : a
  })
}

/** Does a beat b? Load first (less is better when assisted), then reps. */
function beats(a: WorkoutSet, b: WorkoutSet, m: Measurement): boolean {
  const diff = loadKg(a) - loadKg(b)
  if (Math.abs(diff) >= 0.001) return m.type === 'assisted_bodyweight_reps' ? diff < 0 : diff > 0
  return (a.reps ?? 0) > (b.reps ?? 0)
}

/** Per exercise in a workout: its top set, how it compares with last time, and records. */
export function workoutHighlights(session: WorkoutSession, all: WorkoutSession[]): ExerciseHighlight[] {
  const earlier = all.filter((s) => s.state === 'completed' && s.id !== session.id && s.startedAt < session.startedAt)
  return session.exercises.map((e) => {
    const sets = qualifyingSets({ sessionId: session.id, sessionName: session.name, startedAt: session.startedAt, measurement: e.measurement, sets: e.sets })
    const top = topSet(sets, e.measurement)
    const volumeKg = e.measurement.type === 'external_load_reps' ? sets.reduce((sum, s) => sum + loadKg(s) * (s.reps ?? 0), 0) : 0
    const history = exerciseRecords(earlier, e.exerciseId).filter((r) => sameMeasurement(r.measurement, e.measurement))
    const prevRecord = history.at(-1)
    const prevTop = prevRecord ? topSet(qualifyingSets(prevRecord), e.measurement) : undefined
    let change: number | undefined
    if (top && prevTop) change = tracksLoad(e.measurement) ? loadKg(top) - loadKg(prevTop) : (top.reps ?? 0) - (prevTop.reps ?? 0)
    let repChange: number | undefined
    if (top && prevTop && tracksLoad(e.measurement) && Math.abs(change ?? 0) < 0.001) {
      change = 0
      repChange = (top.reps ?? 0) - (prevTop.reps ?? 0)
    }
    const best = history.map((r) => topSet(qualifyingSets(r), e.measurement)).filter((s): s is WorkoutSet => !!s)
      .reduce<WorkoutSet | undefined>((a, b) => (!a || beats(b, a, e.measurement) ? b : a), undefined)
    return {
      exerciseId: e.exerciseId,
      top,
      previous: prevTop && prevRecord ? { set: prevTop, date: prevRecord.startedAt } : undefined,
      change,
      repChange,
      record: !!top && !!best && beats(top, best, e.measurement),
      volumeKg,
    }
  })
}
