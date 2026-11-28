import { useMemo } from 'react'
import { workoutHighlights } from '../domain/metrics'
import { workingSetCount } from '../domain/workout'
import { fromKilograms, type WorkoutSession } from '../domain/types'
import { usePrefs } from '../prefs'
import { useStore } from '../store'
import { Chevron, EmptyState, PageHeader } from '../ui/components'

/** "12.4k" style for big totals; the unit comes from the caller. */
export function compact(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
}

export function minutes(s: WorkoutSession): string | undefined {
  if (!s.finishedAt) return undefined
  const m = Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

export function History() {
  const data = useStore()
  const { unit } = usePrefs()
  const completed = data.sessions.filter((s) => s.state === 'completed')

  // Records and volume per workout, computed once per data change.
  const summary = useMemo(() => {
    const map = new Map<string, { records: number; volumeKg: number }>()
    for (const s of completed) {
      const h = workoutHighlights(s, completed)
      map.set(s.id, { records: h.filter((x) => x.record).length, volumeKg: h.reduce((n, x) => n + x.volumeKg, 0) })
    }
    return map
  }, [data.sessions])

  const thisYear = new Date().getFullYear()
  const months = new Map<string, WorkoutSession[]>()
  for (const s of completed) {
    const d = new Date(s.startedAt)
    const key = d.toLocaleDateString(undefined, { month: 'long', ...(d.getFullYear() === thisYear ? {} : { year: 'numeric' }) })
    months.set(key, [...(months.get(key) ?? []), s])
  }

  return (
    <>
      <PageHeader account title="History" />
      {completed.length === 0 && (
        <div className="card section"><EmptyState title="No workouts yet" message="Finished workouts land here, grouped by month, with every set you logged." /></div>
      )}
      {[...months.entries()].map(([month, sessions]) => (
        <section key={month} className="section">
          <div className="hist-month">
            <h2>{month}</h2>
            <span>{sessions.length} workout{sessions.length === 1 ? '' : 's'} · {sessions.reduce((n, s) => n + workingSetCount(s), 0)} sets</span>
          </div>
          <div className="hist-list">
            {sessions.map((s) => {
              const date = new Date(s.startedAt)
              const opts = { timeZone: s.timeZoneIdentifier }
              const info = summary.get(s.id)
              const volume = info && info.volumeKg > 0 ? `${compact(fromKilograms(info.volumeKg, unit))} ${unit}` : undefined
              const sets = workingSetCount(s)
              return (
                <a key={s.id} className="hist-row" href={`#/history/${s.id}`}>
                  <div className="hist-date">
                    <span className="hist-dow">{date.toLocaleDateString(undefined, { weekday: 'short', ...opts })}</span>
                    <span className="hist-dom num">{date.toLocaleDateString(undefined, { day: 'numeric', ...opts })}</span>
                  </div>
                  <div className="hist-main">
                    <span className="hist-name">{s.name}</span>
                    <span className="hist-meta num">{[minutes(s), `${sets} set${sets === 1 ? '' : 's'}`, volume].filter(Boolean).join(' · ')}</span>
                  </div>
                  {info && info.records > 0 && <span className="hist-pr">{info.records} PR{info.records === 1 ? '' : 's'}</span>}
                  <Chevron />
                </a>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}
