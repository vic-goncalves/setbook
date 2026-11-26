import { useMemo, useState } from 'react'
import { equipmentNames, loadExplanation, loadLabel, muscleNames } from '../domain/catalog'
import {
  availableMetrics, chartRanges, distinctLoads, exerciseRecords, inRange, isMassMetric, metricTitle, personalRecords, qualifyingSets, series,
  type ChartRange, type MetricKind,
} from '../domain/metrics'
import { emptySession, workoutExerciseFrom } from '../domain/workout'
import { fromKilograms, sameMeasurement } from '../domain/types'
import { day, kg, mass, num, setText } from '../format'
import { usePrefs } from '../prefs'
import { back, navigate } from '../router'
import { store, useStore } from '../store'
import { Chips, EmptyState, SectionHead } from '../ui/components'
import { LineChart } from '../ui/chart'
import { Icon } from '../ui/icons'
import { CustomExerciseSheet } from './ExercisePicker'

const shortTitle: Record<MetricKind, string> = {
  heaviestSet: 'Heaviest', volume: 'Volume', bestRepsAtLoad: 'Reps at load', bestReps: 'Best reps', totalReps: 'Total reps', leastAssistance: 'Assistance',
}

export function ExerciseDetail({ id }: { id: string }) {
  const data = useStore()
  const { unit } = usePrefs()
  const exercise = data.exerciseById.get(id.toUpperCase())
  const [kind, setKind] = useState<MetricKind>()
  const [range, setRange] = useState<ChartRange>('3M')
  const [loadIndex, setLoadIndex] = useState(0)
  const [selected, setSelected] = useState<string>()
  const [editing, setEditing] = useState(false)
  const records = useMemo(() => exerciseRecords(data.sessions, id), [data.sessions, id])
  if (!exercise) return <EmptyState title="Exercise not found" message="It may have been removed." />

  const m = exercise.measurement
  const kinds = availableMetrics(m)
  const active = kind && kinds.includes(kind) ? kind : kinds[0]!
  const matching = records.filter((r) => sameMeasurement(r.measurement, m))
  const loads = distinctLoads(records, m)
  const atLoad = loads[Math.min(loadIndex, loads.length - 1)]
  const points = series(active, records, m, atLoad).filter((p) => inRange(p.date, range))
  const point = points.find((p) => p.sessionId === selected) ?? points.at(-1)
  const display = (v: number) => (isMassMetric(active) ? fromKilograms(v, unit) : v)
  const valueText = (v: number, reps?: number) =>
    active === 'volume' ? `${num(fromKilograms(v, unit), 0)} ${unit}` : isMassMetric(active) ? `${kg(v, unit)}${reps ? ` x ${reps}` : ''}` : `${v} reps`
  const prs = personalRecords(records, m)
  const tiles: [string, string, string][] = []
  if (prs.bestLoad?.load) tiles.push([m.type === 'assisted_bodyweight_reps' ? 'Least assistance' : m.type === 'weighted_bodyweight_reps' ? 'Heaviest added' : 'Heaviest set', `${mass(prs.bestLoad.load, unit)} x ${prs.bestLoad.reps}`, prs.bestLoad.date])
  if (m.loadConvention) prs.mostRepsByLoad.slice(0, 3).forEach((e) => e.load && tiles.push([`Reps at ${mass(e.load, unit)}`, String(e.reps), e.date]))
  else if (prs.mostReps) tiles.push(['Most reps', String(prs.mostReps.reps), prs.mostReps.date])
  const explanation = active === 'leastAssistance' ? 'Lower means less help from the machine or band. Less assistance at similar reps can indicate progress.'
    : active === 'volume' ? (m.loadConvention === 'per_hand' ? 'Per-hand load x reps, summed over working sets. Not doubled.' : 'Load x reps, summed over working sets.')
    : active === 'bestRepsAtLoad' ? 'Only sessions that included this load are shown.'
    : active === 'heaviestSet' && m.type === 'weighted_bodyweight_reps' ? 'Weight added to your body, not including bodyweight.' : undefined

  return (
    <>
      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => back('/progress')}><Icon name="back" size={16} /> Back</button>
      <header className="page-header" style={{ paddingTop: 8 }}>
        <div className="eyebrow">{muscleNames[exercise.primaryMuscle]}, {equipmentNames[exercise.equipment]}</div>
        <h1 className="title">{exercise.name}</h1>
      </header>

      {matching.length === 0 ? (
        <div className="card section">
          <EmptyState title="No completed sets yet"
            message={records.length ? "Past sets were logged with a different load convention, so they aren't charted together." : `Complete a working set of ${exercise.name} and your progress appears here.`}
            action={!data.sessions.some((s) => s.state === 'active') && (
              <button className="pill" onClick={() => {
                store.save('session', { ...emptySession(), name: exercise.name, exercises: [workoutExerciseFrom(exercise)] })
                navigate('/workout')
              }}>Start a workout with it</button>
            )} />
        </div>
      ) : (
        <>
          <div className="stack section">
            {kinds.length > 1 && <Chips layout="bleed" options={kinds} value={active} onChange={(k) => { setKind(k); setSelected(undefined) }} label={(k) => (k === 'heaviestSet' && m.type === 'weighted_bodyweight_reps' ? 'Added load' : shortTitle[k])} />}
            <div className="row">
              <span className="eyebrow spacer">{metricTitle(active, m)}</span>
              {active === 'bestRepsAtLoad' && loads.length > 0 && (
                <select className="select num" value={Math.min(loadIndex, loads.length - 1)} onChange={(e) => { setLoadIndex(Number(e.target.value)); setSelected(undefined) }} aria-label="Load">
                  {loads.map((l, i) => <option key={i} value={i}>at {mass(l, unit)}</option>)}
                </select>
              )}
            </div>
            {point ? (
              <a href={`#/history/${point.sessionId}`}>
                <div className="metric-big num">{valueText(point.value, point.reps)}</div>
                <div className="small subtle">{day(point.date)}, {point.sessionName} <Icon name="chevron" size={12} /></div>
              </a>
            ) : <div className="subtle small">No sessions in this range.</div>}
            {points.length > 0 && (
              <LineChart label={`${metricTitle(active, m)} chart`} points={points.map((p) => ({ id: p.sessionId, x: Date.parse(p.date), y: display(p.value) }))}
                selectedId={point?.sessionId} onSelect={setSelected} format={(v) => num(v, 1)} integer={!isMassMetric(active)} />
            )}
            <Chips options={chartRanges} value={range} onChange={(r) => { setRange(r); setSelected(undefined) }} />
            {explanation && <p className="tiny faint" style={{ margin: 0 }}>{explanation}</p>}
          </div>

          <section className="section">
            <SectionHead title="Records" />
            <div className="grid-2">
              {tiles.map(([title, value, date]) => (
                <div key={title} className="tile">
                  <div className="tiny subtle">{title}</div>
                  <div className="num" style={{ fontSize: 20, fontWeight: 600, margin: '4px 0' }}>{value}</div>
                  <div className="tiny faint">{day(date)}</div>
                </div>
              ))}
            </div>
            <p className="tiny faint">Completed working sets only. Each load has its own rep record, so a heavy single never outranks more reps at a lighter weight.</p>
          </section>

          <section className="section">
            <SectionHead title="Recent" />
            <div className="list">
              {[...matching].reverse().slice(0, 6).map((r) => (
                <a key={r.sessionId} className="list-row" href={`#/history/${r.sessionId}`}>
                  <div className="spacer">
                    <div className="small subtle">{day(r.startedAt)}</div>
                    <div className="num" style={{ fontWeight: 500 }}>{qualifyingSets(r).map((s) => setText(s, unit)).join(', ')}</div>
                  </div>
                  <span className="chev"><Icon name="chevron" size={16} /></span>
                </a>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="section">
        <SectionHead title="About" />
        <div className="stack small">
          <div className="row"><span className="subtle spacer">Logged as</span><span>{loadLabel(m) ? `${loadLabel(m)} and reps` : 'Reps only'}</span></div>
          {loadExplanation(m) && <span className="faint tiny">{loadExplanation(m)}</span>}
          {!exercise.isBuiltIn && (
            <div className="row">
              <button className="btn btn-secondary" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn btn-secondary" style={{ color: 'var(--danger)' }} onClick={() => {
                const referenced = data.sessions.some((s) => s.exercises.some((e) => e.exerciseId === exercise.id)) || data.templates.some((t) => t.exercises.some((e) => e.exerciseId === exercise.id))
                if (referenced) store.save('exercise', { ...exercise, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
                else store.remove('exercise', exercise.id)
                back('/progress')
              }}>{records.length || data.templates.some((t) => t.exercises.some((e) => e.exerciseId === exercise.id)) ? 'Archive' : 'Delete'}</button>
            </div>
          )}
        </div>
      </section>
      {editing && <CustomExerciseSheet existing={exercise} locked={records.length > 0} onClose={() => setEditing(false)} />}
    </>
  )
}
