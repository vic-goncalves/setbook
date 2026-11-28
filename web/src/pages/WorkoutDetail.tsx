import { useState } from 'react'
import { workoutHighlights, type ExerciseHighlight } from '../domain/metrics'
import { repeatSession, templateFromSession, workingSetCount } from '../domain/workout'
import { fromKilograms, massIn, sameLoad, tracksLoad, type MassUnit, type WorkoutExercise, type WorkoutSet } from '../domain/types'
import { num } from '../format'
import { compact, minutes } from './History'
import { usePrefs } from '../prefs'
import { navigate } from '../router'
import { store, useStore } from '../store'
import { ActionSheet, Confirm, EmptyState, Sheet } from '../ui/components'
import { Icon } from '../ui/icons'

export function WorkoutDetail({ id, onToast }: { id: string; onToast: (m: string) => void }) {
  const data = useStore()
  const { unit } = usePrefs()
  const session = data.sessions.find((s) => s.id === id)
  const [deleting, setDeleting] = useState(false)
  const [naming, setNaming] = useState<string>()
  const [menu, setMenu] = useState(false)
  if (!session) return <EmptyState title="Workout not found" message="It may have been deleted on another device." action={<a className="pill" href="#/history">Back to History</a>} />
  const active = data.sessions.some((s) => s.state === 'active')
  const highlights = workoutHighlights(session, data.sessions)
  const volumeKg = highlights.reduce((n, h) => n + h.volumeKg, 0)
  const records = highlights.filter((h) => h.record).length

  return (
    <>
      <div className="row" style={{ padding: '10px 0 0', marginLeft: -8 }}>
        <a className="btn btn-ghost" href="#/history"><Icon name="back" size={18} /> History</a>
        <span className="spacer" />
        <button className="icon-button" onClick={() => setMenu(true)} aria-label="Workout actions"><Icon name="more" size={22} stroke={3} /></button>
      </div>
      {menu && (
        <ActionSheet title={session.name} onClose={() => setMenu(false)} actions={[
          { label: 'Edit workout', run: () => navigate(`/history/${id}/edit`) },
          { label: 'Save as template', run: () => setNaming(session.name) },
          { label: 'Delete workout', run: () => setDeleting(true), danger: true },
        ]} />
      )}
      <header className="detail-head">
        <h1 className="title">{session.name}</h1>
        <div className="detail-when">{new Date(session.startedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: session.timeZoneIdentifier })}</div>
      </header>
      <div className="detail-stats">
        <div><span className="num">{minutes(session) ?? '-'}</span><label>Duration</label></div>
        <div><span className="num">{workingSetCount(session)}</span><label>Sets</label></div>
        <div><span className="num">{volumeKg > 0 ? <>{compact(fromKilograms(volumeKg, unit))}<small> {unit}</small></> : '-'}</span><label>Volume</label></div>
        {records > 0 && <div className="pr"><span className="num">{records}</span><label>{records === 1 ? 'Record' : 'Records'}</label></div>}
      </div>
      {session.notes && <p className="subtle" style={{ lineHeight: 1.45 }}>{session.notes}</p>}
      <div className="detail-exercises">
        {session.exercises.map((e, i) => <ExerciseCard key={e.id} exercise={e} highlight={highlights[i]!} unit={unit} />)}
      </div>
      {!active && (
        <button className="btn btn-primary" style={{ marginTop: 28 }} onClick={() => {
          store.save('session', repeatSession(session, data.exerciseById))
          navigate('/workout')
        }}><Icon name="repeat" size={16} /> Repeat workout</button>
      )}
      {deleting && (
        <Confirm title="Delete this workout?" message="It will be removed from your history and charts on every device. This can't be undone."
          confirm="Delete workout" onCancel={() => setDeleting(false)} onConfirm={() => { navigate('/history'); store.remove('session', id) }} />
      )}
      {naming !== undefined && (
        <Sheet title="Save as template" onClose={() => setNaming(undefined)} actions={
          <button className="pill" disabled={!naming.trim()} onClick={() => {
            store.save('template', templateFromSession(repeatSession(session, data.exerciseById), naming.trim()))
            setNaming(undefined)
            onToast('Template saved. Find it on Train.')
          }}>Save</button>
        }>
          <input className="input" value={naming} onChange={(e) => setNaming(e.target.value)} autoFocus aria-label="Template name" />
          <p className="small subtle">Uses this workout's exercises, with your logged sets as the targets.</p>
        </Sheet>
      )}
    </>
  )
}

const weight = (set: WorkoutSet, unit: MassUnit) => (set.load ? num(massIn(set.load, unit)) : '')

/**
 * One card per exercise: sets on one line grouped by weight ("185 lb × 5, 5, 4"), warm-ups
 * apart, and how the top set compares with the last time this exercise was done.
 */
function ExerciseCard({ exercise: e, highlight: h, unit }: { exercise: WorkoutExercise; highlight: ExerciseHighlight; unit: MassUnit }) {
  const loads = tracksLoad(e.measurement)
  const suffix = e.measurement.loadConvention === 'per_hand' ? '/hand' : e.measurement.loadConvention === 'added' ? ' added' : e.measurement.loadConvention === 'assistance' ? ' assist' : ''
  const done = e.sets.filter((s) => s.completedAt && s.reps !== undefined)
  const warmups = done.filter((s) => s.type === 'warmup')
  const working = done.filter((s) => s.type === 'working')

  // Consecutive sets at the same weight share one group.
  const groups: { load?: WorkoutSet['load']; sets: WorkoutSet[] }[] = []
  for (const s of working) {
    const last = groups.at(-1)
    if (last && ((!last.load && !s.load) || (last.load && s.load && sameLoad(last.load, s.load)))) last.sets.push(s)
    else groups.push({ load: s.load, sets: [s] })
  }

  let delta: { text: string; tone: 'up' | 'down' | 'same' } | undefined
  if (h.change !== undefined && h.previous) {
    const since = new Date(h.previous.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const assisted = e.measurement.type === 'assisted_bodyweight_reps'
    const better = assisted ? h.change < 0 : h.change > 0
    const amount = loads ? `${num(Math.abs(fromKilograms(h.change, unit)), 1)} ${unit}` : `${Math.abs(h.change)} rep${Math.abs(h.change) === 1 ? '' : 's'}`
    if (h.change !== 0) delta = { text: `${better ? '+' : '−'}${amount} vs ${since}`, tone: better ? 'up' : 'down' }
    else if (h.repChange) {
      const reps = Math.abs(h.repChange)
      delta = { text: `${h.repChange > 0 ? '+' : '−'}${reps} rep${reps === 1 ? '' : 's'} vs ${since}`, tone: h.repChange > 0 ? 'up' : 'down' }
    } else delta = { text: `Same as ${since}`, tone: 'same' }
  }

  return (
    <section className="ex-card">
      <div className="ex-head">
        <span className="ex-name">{e.exerciseName}</span>
        {h.record ? <span className="ex-pr">PR</span> : delta ? <span className={`ex-delta ${delta.tone}`}>{delta.text}</span> : h.top && <span className="ex-delta same">First time</span>}
      </div>
      {h.record && delta && <div className={`ex-delta-line ${delta.tone}`}>{delta.text}</div>}
      {e.notes && <p className="ex-note">{e.notes}</p>}
      <div className="ex-sets num">
        {groups.length === 0 && <span className="faint">No completed sets</span>}
        {groups.map((g, i) => (
          <div key={i} className="ex-group">
            {g.load && <span className="ex-load">{weight(g.sets[0]!, unit)} {unit}{suffix}</span>}
            <span className="ex-reps">{g.load ? '× ' : ''}{g.sets.map((s) => `${s.reps}${s.rir !== undefined ? ` @${s.rir}` : ''}`).join(', ')}{g.load ? '' : ' reps'}</span>
          </div>
        ))}
      </div>
      {warmups.length > 0 && (
        <div className="ex-warmup num">Warm-up: {warmups.map((s) => (s.load ? `${weight(s, unit)}×${s.reps}` : `${s.reps}`)).join(', ')}</div>
      )}
    </section>
  )
}
