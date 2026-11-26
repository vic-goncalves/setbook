import { useState } from 'react'
import { repeatSession, setLabel, templateFromSession, workingSetCount } from '../domain/workout'
import type { WorkoutExercise, WorkoutSet } from '../domain/types'
import { mass, stopwatch } from '../format'
import { usePrefs } from '../prefs'
import { navigate } from '../router'
import { store, useStore } from '../store'
import { ActionSheet, Confirm, EmptyState, Sheet, Stat } from '../ui/components'
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

  const text = (set: WorkoutSet, e: WorkoutExercise) => {
    if (set.reps === undefined) return '-'
    if (!set.load) return `${set.reps} reps`
    const m = mass(set.load, unit)
    switch (e.measurement.loadConvention) {
      case 'added': return `+${m} x ${set.reps}`
      case 'assistance': return `${m} assist x ${set.reps}`
      case 'per_hand': return `${m}/hand x ${set.reps}`
      default: return `${m} x ${set.reps}`
    }
  }

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
      <header className="page-header">
        <div className="eyebrow">{new Date(session.startedAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: session.timeZoneIdentifier })}</div>
        <h1 className="title">{session.name}</h1>
      </header>
      <div className="card stats" style={{ marginTop: 12 }}>
        <Stat value={session.finishedAt ? stopwatch(Date.parse(session.finishedAt) - Date.parse(session.startedAt)) : '-'} label="Duration" />
        <Stat value={String(workingSetCount(session))} label="Working sets" />
        <Stat value={String(session.exercises.length)} label="Exercises" />
      </div>
      {session.notes && <p className="subtle">{session.notes}</p>}
      {session.exercises.map((e) => (
        <section key={e.id} className="section">
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{e.exerciseName}</div>
          {e.notes && <p className="small subtle" style={{ margin: '0 0 8px' }}>{e.notes}</p>}
          <div className="card" style={{ padding: '6px 16px' }}>
            {e.sets.map((set, i) => (
              <div key={set.id} className="row" style={{ padding: '7px 0' }}>
                <span className="num" style={{ width: 24, fontWeight: 600, color: set.type === 'warmup' ? 'var(--warmup)' : 'var(--ink-3)' }}>{setLabel(e.sets, i)}</span>
                <span className="num" style={{ fontWeight: 500, color: set.type === 'warmup' ? 'var(--ink-2)' : undefined }}>{text(set, e)}</span>
                <span className="spacer" />
                {set.rir !== undefined && <span className="tiny subtle">RIR {set.rir}</span>}
              </div>
            ))}
          </div>
        </section>
      ))}
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
