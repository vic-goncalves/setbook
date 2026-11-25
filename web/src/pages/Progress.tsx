import { useMemo, useState } from 'react'
import { matchesSearch } from '../domain/catalog'
import { availableMetrics, bodyWeightSummary, exerciseRecords, isMassMetric, series } from '../domain/metrics'
import { massIn } from '../domain/types'
import { kg, num, relativeDay, signed } from '../format'
import { usePrefs } from '../prefs'
import { useStore } from '../store'
import { Chevron, EmptyState, PageHeader, SectionHead } from '../ui/components'
import { Sparkline } from '../ui/chart'

export function Progress() {
  const data = useStore()
  const { unit } = usePrefs()
  const [query, setQuery] = useState('')
  const trends = useMemo(() => {
    const completed = data.sessions.filter((s) => s.state === 'completed')
    const ids = [...new Set(completed.flatMap((s) => s.exercises.map((e) => e.exerciseId.toUpperCase())))]
    return ids.flatMap((id) => {
      const exercise = data.exerciseById.get(id)
      if (!exercise) return []
      const records = exerciseRecords(completed, id)
      const kind = availableMetrics(exercise.measurement)[0]!
      const metric = kind === 'bestRepsAtLoad' || kind === 'volume' ? 'bestReps' : kind
      const points = series(metric, records, exercise.measurement)
      const last = records.at(-1)?.startedAt ?? ''
      return [{ exercise, points, kind: metric, last }]
    }).sort((a, b) => b.last.localeCompare(a.last))
  }, [data.sessions, data.exerciseById])
  const summary = bodyWeightSummary(data.measurements, '3M')
  const filtered = trends.filter((t) => matchesSearch(t.exercise, query))

  return (
    <>
      <PageHeader title="Progress" />
      <a className="card clickable" href="#/progress/body-weight" style={{ display: 'block', marginTop: 16 }}>
        <div className="row"><span className="eyebrow spacer">Body weight</span><Chevron /></div>
        {summary.latest ? (
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <div className="spacer">
              <span className="metric-big num">{num(massIn(summary.latest.mass, unit), 1)}</span> <span className="subtle">{unit}</span>
              <div className="small subtle num">{summary.change ? `${signed(massIn({ value: summary.change.kilograms, unit: 'kg' }, unit))} ${unit} over 3 months` : `Latest, ${relativeDay(summary.latest.measuredAt)}`}</div>
            </div>
            <Sparkline values={summary.rollingAverage.map((p) => p.kilograms)} width={120} height={44} />
          </div>
        ) : <p className="subtle small" style={{ marginBottom: 0 }}>Log your weight to see a 7-day trend.</p>}
      </a>

      <section className="section">
        <SectionHead title="Exercises"><a className="btn btn-ghost" href="#/exercises">Browse all</a></SectionHead>
        {trends.length === 0 ? (
          <div className="card"><EmptyState title="No exercise history yet" message="Finish a workout and every exercise you logged gets its own chart here." /></div>
        ) : (
          <>
            {trends.length > 6 && <input className="input" style={{ marginBottom: 8 }} placeholder="Search your exercises" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your exercises" />}
            <div className="list">
              {filtered.map(({ exercise, points, kind, last }) => {
                const latest = points.at(-1)
                return (
                  <a key={exercise.id} className="list-row" href={`#/progress/exercise/${exercise.id}`}>
                    <div className="spacer">
                      <div style={{ fontWeight: 500 }}>{exercise.name}</div>
                      <div className="small subtle">Last {relativeDay(last)}</div>
                    </div>
                    <Sparkline values={points.slice(-10).map((p) => p.value)} width={48} height={22} />
                    <span className="num" style={{ minWidth: 70, textAlign: 'right', fontWeight: 600 }}>
                      {latest ? (isMassMetric(kind) ? kg(latest.value, unit) : `${latest.value} reps`) : '-'}
                    </span>
                  </a>
                )
              })}
            </div>
          </>
        )}
      </section>
    </>
  )
}
