import { useEffect, useMemo, useState } from 'react'
import { keepAwake, tap } from '../device'
import { SwipeRow } from '../ui/swipe'
import { loadExplanation, loadLabel } from '../domain/catalog'
import {
  addSet, completeSet, completedSetCount, counterpart, finishSession, incompleteSetCount, placeholder,
  previousPerformance, setLabel, strip, templateProposal, workoutExerciseFrom, workingSetCount,
} from '../domain/workout'
import type { MassUnit, WorkoutExercise, WorkoutSession, WorkoutSet } from '../domain/types'
import { kilograms, nowIso, tracksLoad } from '../domain/types'
import { clock, duration, mass, parseDecimal, parseInteger, relativeDay, setText, stopwatch } from '../format'
import { adjustRest, clearRest, startRest, usePrefs } from '../prefs'
import { back, navigate } from '../router'
import { store, useStore } from '../store'
import { ActionSheet, Confirm, EmptyState, Sheet, Stat, useNow } from '../ui/components'
import { Icon } from '../ui/icons'
import { ExercisePicker } from './ExercisePicker'

const restOptions = [30, 45, 60, 90, 120, 150, 180, 240, 300]

/** Logs the active workout, or edits a finished one (`editId`), with the same layout as the iPhone. */
export function WorkoutPage({ editId, onToast }: { editId?: string; onToast: (m: string) => void }) {
  const data = useStore()
  const stored = editId ? data.sessions.find((s) => s.id === editId) : data.sessions.find((s) => s.state === 'active')
  // History edits are a local draft until Save; active workouts save every change.
  const [draft, setDraft] = useState<WorkoutSession | undefined>(editId ? stored : undefined)
  const session = editId ? draft : stored

  if (!session) {
    return <EmptyState title={editId ? 'Workout not found' : 'No workout in progress'} message={editId ? 'It may have been deleted.' : 'Start one from a template or empty.'}
      action={<a className="pill" href="#/train">Go to Train</a>} />
  }
  const write = (next: WorkoutSession) => {
    const updated = { ...next, updatedAt: nowIso() }
    if (editId) setDraft(updated)
    else store.save('session', updated)
  }
  return <Logger key={session.id} session={session} editing={!!editId} write={write} onToast={onToast} />
}

function Logger({ session, editing, write, onToast }: { session: WorkoutSession; editing: boolean; write: (s: WorkoutSession) => void; onToast: (m: string) => void }) {
  const data = useStore()
  const { unit, defaultRest, rest } = usePrefs()
  const now = useNow()
  const [picking, setPicking] = useState(false)
  const [rejected, setRejected] = useState<{ set: string; message: string }>()
  const [dialog, setDialog] = useState<'incomplete' | 'nothing' | 'discard' | 'finish' | { remove: number }>()

  const previous = useMemo(() => {
    const seen = new Map<string, number>()
    return session.exercises.map((e) => {
      const occurrence = seen.get(e.exerciseId) ?? 0
      seen.set(e.exerciseId, occurrence + 1)
      return previousPerformance(data.sessions, e.exerciseId, session.id, occurrence)
    })
  }, [data.sessions, session.id, session.exercises.map((e) => e.exerciseId).join()])

  // Keep the screen on while logging; iOS releases the lock when the app is hidden, so ask again on return.
  useEffect(() => {
    if (editing) return
    void keepAwake(true)
    const again = () => document.visibilityState === 'visible' && void keepAwake(true)
    document.addEventListener('visibilitychange', again)
    return () => {
      document.removeEventListener('visibilitychange', again)
      void keepAwake(false)
    }
  }, [editing])

  const updateExercise = (index: number, next: WorkoutExercise) => write({ ...session, exercises: session.exercises.map((e, i) => (i === index ? next : e)) })
  const done = completedSetCount(session)
  const total = done + incompleteSetCount(session)

  const toggleComplete = (ei: number, si: number) => {
    const exercise = session.exercises[ei]!
    const set = exercise.sets[si]!
    tap()
    if (set.completedAt) return updateExercise(ei, { ...exercise, sets: exercise.sets.map((s, i) => (i === si ? strip({ ...s, completedAt: undefined }) : s)) })
    const result = completeSet(exercise, si, counterpart(previous[ei], exercise.sets, si))
    if (typeof result === 'string') return setRejected({ set: set.id, message: result })
    setRejected(undefined)
    updateExercise(ei, result)
    if (!editing && exercise.restSeconds) startRest(exercise.restSeconds)
  }

  const requestFinish = () => {
    if (done === 0) setDialog('nothing')
    else if (incompleteSetCount(session) > 0) setDialog('incomplete')
    else setDialog('finish')
  }

  const moveExercise = (index: number, by: number) => {
    const next = [...session.exercises]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item!)
    write({ ...session, exercises: next })
  }

  return (
    <>
      <div className="app-bar">
        {editing ? <button className="btn btn-ghost" onClick={() => back('/history')}>Cancel</button> : <a className="btn btn-ghost" href="#/train" aria-label="Minimize workout"><Icon name="down" size={22} /></a>}
        <div className="title-slot num">
          {editing ? 'Edit workout' : stopwatch(now - Date.parse(session.startedAt))}
        </div>
        {editing ? (
          <button className="pill" onClick={() => {
            const finished = finishSession(session, session.finishedAt ?? nowIso())
            if (!finished) return onToast('A finished workout needs at least one completed set.')
            store.save('session', { ...finished, finishedAt: session.finishedAt ?? finished.finishedAt })
            navigate(`/history/${session.id}`)
          }}>Save</button>
        ) : (
          <button className="btn-done btn" onClick={requestFinish}>Finish</button>
        )}
      </div>

      <input className="bare title" style={{ marginTop: 16 }} value={session.name} aria-label="Workout name"
        onChange={(e) => write({ ...session, name: e.target.value || 'Workout' })} />
      {editing ? (
        <div className="card" style={{ marginTop: 12, padding: 12 }}>
          <label className="toggle small"><span className="subtle">Started</span>
            <input type="datetime-local" className="input" style={{ maxWidth: 230 }} value={toLocalInput(session.startedAt)}
              onChange={(e) => e.target.value && write({ ...session, startedAt: new Date(e.target.value).toISOString() })} />
          </label>
          <label className="toggle small" style={{ marginTop: 8 }}><span className="subtle">Finished</span>
            <input type="datetime-local" className="input" style={{ maxWidth: 230 }} value={toLocalInput(session.finishedAt ?? session.startedAt)}
              onChange={(e) => e.target.value && write({ ...session, finishedAt: new Date(Math.max(Date.parse(session.startedAt), new Date(e.target.value).getTime())).toISOString() })} />
          </label>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div className="small subtle num" style={{ marginBottom: 6 }}>{done} of {total} sets</div>
          <div className="progress" role="progressbar" aria-valuenow={done} aria-valuemax={total}><div style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
        </div>
      )}
      <textarea className="bare small subtle" style={{ marginTop: 10, resize: 'none' }} rows={1} placeholder="Add a note" value={session.notes ?? ''}
        onChange={(e) => write(strip({ ...session, notes: e.target.value || undefined }))} aria-label="Workout notes" />

      {session.exercises.map((exercise, ei) => (
        <ExerciseBlock key={exercise.id} exercise={exercise} index={ei} count={session.exercises.length} unit={unit} editing={editing}
          previous={previous[ei]} rejected={rejected}
          onChange={(next) => updateExercise(ei, next)}
          onComplete={(si) => toggleComplete(ei, si)}
          onMove={(by) => moveExercise(ei, by)}
          onRemove={() => (exercise.sets.some((s) => s.completedAt) ? setDialog({ remove: ei }) : write({ ...session, exercises: session.exercises.filter((_, i) => i !== ei) }))}
        />
      ))}

      <div className="stack" style={{ marginTop: 32 }}>
        <button className="btn btn-secondary" onClick={() => setPicking(true)}><Icon name="plus" size={16} /> Add exercises</button>
        {!editing && <button className="btn btn-ghost btn-danger" onClick={() => setDialog('discard')}>Discard workout</button>}
      </div>

      {!editing && rest && <RestBar endsAt={rest.endsAt} duration={rest.duration} now={now} />}
      {picking && <ExercisePicker onClose={() => setPicking(false)} onDone={(list) => write({ ...session, exercises: [...session.exercises, ...list.map((e) => workoutExerciseFrom(e, defaultRest))] })} />}

      {dialog === 'incomplete' && (
        <Confirm title="Finish with unfinished sets?" danger={false}
          message={`${incompleteSetCount(session)} set${incompleteSetCount(session) === 1 ? " isn't" : "s aren't"} marked done. They won't be saved or counted.`}
          confirm="Finish without them" onCancel={() => setDialog(undefined)} onConfirm={() => setDialog('finish')} />
      )}
      {dialog === 'nothing' && (
        <Confirm title="No sets completed yet" message="A workout needs at least one completed set to be saved. Keep it open, or discard it."
          confirm="Discard workout" onCancel={() => setDialog(undefined)} onConfirm={() => setDialog('discard')} />
      )}
      {dialog === 'discard' && (
        <Confirm title="Discard this workout?" message="Everything logged in it will be deleted." confirm="Discard workout"
          onCancel={() => setDialog(undefined)} onConfirm={() => { store.remove('session', session.id); clearRest(); navigate('/train') }} />
      )}
      {typeof dialog === 'object' && (
        <Confirm title={`Remove ${session.exercises[dialog.remove]?.exerciseName}?`} message="Its sets in this workout, including completed ones, will be removed."
          confirm="Remove exercise" onCancel={() => setDialog(undefined)}
          onConfirm={() => { write({ ...session, exercises: session.exercises.filter((_, i) => i !== dialog.remove) }); setDialog(undefined) }} />
      )}
      {dialog === 'finish' && <FinishSheet session={session} unit={unit} onClose={() => setDialog(undefined)} onToast={onToast} />}
    </>
  )
}

function ExerciseBlock({ exercise, index, count, unit, editing, previous, rejected, onChange, onComplete, onMove, onRemove }: {
  exercise: WorkoutExercise; index: number; count: number; unit: MassUnit; editing: boolean
  previous: ReturnType<typeof previousPerformance>; rejected?: { set: string; message: string }
  onChange: (e: WorkoutExercise) => void; onComplete: (setIndex: number) => void; onMove: (by: number) => void; onRemove: () => void
}) {
  const [menu, setMenu] = useState(false)
  const hasLoad = tracksLoad(exercise.measurement)
  const label = loadLabel(exercise.measurement)
  const loadColumn = exercise.measurement.loadConvention === 'per_hand' ? `${unit}/hand` : exercise.measurement.loadConvention === 'added' ? `+${unit}` : exercise.measurement.loadConvention === 'assistance' ? 'Assist' : unit
  const setSet = (si: number, next: WorkoutSet) => onChange({ ...exercise, sets: exercise.sets.map((s, i) => (i === si ? strip(next) : s)) })

  return (
    <section style={{ marginTop: 30 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <div style={{ fontWeight: 600, fontSize: 17 }}>{exercise.exerciseName}</div>
          <div className="small subtle row" style={{ gap: 8, marginTop: 2 }}>
            <span>{previous ? `Last ${relativeDay(previous.date)}` : 'First time'}</span>
            {label && exercise.measurement.loadConvention !== 'total' && <span className="badge">{label}</span>}
          </div>
        </div>
        {!editing && (
          <select className="select" value={exercise.restSeconds ?? 0} aria-label={`Rest timer for ${exercise.exerciseName}`}
            onChange={(e) => onChange(strip({ ...exercise, restSeconds: Number(e.target.value) || undefined }))}>
            <option value={0}>Rest off</option>
            {restOptions.map((s) => <option key={s} value={s}>{clock(s)}</option>)}
          </select>
        )}
        <button className="icon-button" onClick={() => setMenu(true)} aria-label={`Options for ${exercise.exerciseName}`}><Icon name="more" size={22} stroke={3} /></button>
      </div>
      {menu && (
        <ActionSheet title={exercise.exerciseName} onClose={() => setMenu(false)} actions={[
          ...(index > 0 ? [{ label: 'Move up', run: () => onMove(-1) }] : []),
          ...(index < count - 1 ? [{ label: 'Move down', run: () => onMove(1) }] : []),
          { label: 'Remove exercise', run: onRemove, danger: true },
        ]} />
      )}
      {!previous && exercise.measurement.loadConvention && exercise.measurement.loadConvention !== 'total' && (
        <p className="tiny faint" style={{ margin: '6px 0 0' }}>{loadExplanation(exercise.measurement)}</p>
      )}
      <input className="bare small subtle" style={{ margin: '8px 0 10px' }} placeholder="Exercise note" value={exercise.notes ?? ''}
        onChange={(e) => onChange(strip({ ...exercise, notes: e.target.value || undefined }))} aria-label={`Note for ${exercise.exerciseName}`} />

      <div className={`set-grid set-head${hasLoad ? '' : ' no-load'}`}>
        <span style={{ textAlign: 'center' }}>Set</span><span>Previous</span>{hasLoad && <span style={{ textAlign: 'center' }}>{loadColumn}</span>}<span style={{ textAlign: 'center' }}>Reps</span><span />
      </div>
      {exercise.sets.map((set, si) => {
        const prior = counterpart(previous, exercise.sets, si)
        return (
          <SwipeRow key={set.id} onDelete={() => onChange({ ...exercise, sets: exercise.sets.filter((_, i) => i !== si) })}>
            <SetRow set={set} label={setLabel(exercise.sets, si)} prior={prior} hint={placeholder(set, prior)} hasLoad={hasLoad} unit={unit}
              error={rejected?.set === set.id ? rejected.message : undefined}
              onChange={(next) => setSet(si, next)} onComplete={() => onComplete(si)} />
          </SwipeRow>
        )
      })}
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <button className="btn btn-secondary" style={{ minHeight: 42, color: 'var(--ink-2)', background: 'var(--surface)', border: 0 }} onClick={() => { tap(); onChange(addSet(exercise)) }}>
          <Icon name="plus" size={16} /> Add set
        </button>
        {exercise.sets.length > 0 && (
          <button className="btn btn-ghost small subtle hover-only" style={{ whiteSpace: 'nowrap' }} onClick={() => onChange({ ...exercise, sets: exercise.sets.slice(0, -1) })}
            aria-label={`Remove last set of ${exercise.exerciseName}`}>Remove last</button>
        )}
      </div>
    </section>
  )
}

/** Return on the number pad moves weight -> reps -> next set's weight, like the iPhone app. */
function focusNext(current: HTMLInputElement) {
  const fields = [...document.querySelectorAll<HTMLInputElement>('.set-row input')]
  const next = fields[fields.indexOf(current) + 1]
  if (next) next.focus()
  else current.blur()
}

function SetRow({ set, label, prior, hint, hasLoad, unit, error, onChange, onComplete }: {
  set: WorkoutSet; label: string; prior?: WorkoutSet; hint: { load?: { value: number; unit: MassUnit }; reps?: number }
  hasLoad: boolean; unit: MassUnit; error?: string; onChange: (s: WorkoutSet) => void; onComplete: () => void
}) {
  const [loadText, setLoadText] = useState(set.load ? mass(set.load, unit, false) : '')
  const [repsText, setRepsText] = useState(set.reps !== undefined ? String(set.reps) : '')
  const done = !!set.completedAt
  // Reflect values filled in by completing from a suggestion.
  const shownLoad = set.load && parseDecimal(loadText) === undefined ? mass(set.load, unit, false) : loadText
  const shownReps = set.reps !== undefined && parseInteger(repsText) === undefined ? String(set.reps) : repsText

  return (
    <div className={`set-grid set-row${hasLoad ? '' : ' no-load'}${done ? ' done' : ''}`}>
      <button className={`set-num num${set.type === 'warmup' ? ' warmup' : ''}${done ? ' done' : ''}`}
        onClick={() => onChange({ ...set, type: set.type === 'warmup' ? 'working' : 'warmup' })}
        aria-label={set.type === 'warmup' ? 'Warm-up set. Switch to working set' : `Set ${label}. Switch to warm-up`}>{label}</button>
      <span className="prev num" aria-label={prior ? `Previous ${setText(prior, unit)}` : 'No previous'}>{prior ? setText(prior, unit) : '-'}</span>
      {hasLoad && (
        <input className={`field num${done ? ' done' : ''}${error && !set.load && !hint.load ? ' invalid' : ''}`} inputMode="decimal" enterKeyHint="next" aria-label={`Weight in ${unit}`}
          onKeyDown={(e) => e.key === 'Enter' && focusNext(e.currentTarget)}
          placeholder={hint.load ? mass(hint.load, unit, false) : ''} value={shownLoad}
          onChange={(e) => {
            setLoadText(e.target.value)
            const v = parseDecimal(e.target.value)
            if (!e.target.value) onChange({ ...set, load: undefined })
            else if (v !== undefined && v >= 0) onChange({ ...set, load: { value: v, unit } })
          }} />
      )}
      <input className={`field num${done ? ' done' : ''}${error && set.reps === undefined && hint.reps === undefined ? ' invalid' : ''}`} inputMode="numeric" enterKeyHint="next" aria-label="Reps"
        onKeyDown={(e) => e.key === 'Enter' && focusNext(e.currentTarget)}
        placeholder={hint.reps !== undefined ? String(hint.reps) : ''} value={shownReps}
        onChange={(e) => {
          setRepsText(e.target.value)
          const v = parseInteger(e.target.value)
          if (!e.target.value) onChange({ ...set, reps: undefined })
          else if (v !== undefined && v >= 0) onChange({ ...set, reps: v })
        }} />
      <button className={`check${done ? ' done' : ''}`} onClick={onComplete} aria-label={done ? 'Completed. Mark not done' : 'Mark set done'} aria-pressed={done}>
        <Icon name="check" size={16} stroke={3} />
      </button>
      {error && <div className="tiny" style={{ gridColumn: '1 / -1', color: 'var(--danger)', paddingLeft: 42 }} role="alert">{error}</div>}
    </div>
  )
}

function RestBar({ endsAt, duration: total, now }: { endsAt: number; duration: number; now: number }) {
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000))
  const progress = Math.min(1, remaining / Math.max(total, 1))
  const r = 13
  const c = 2 * Math.PI * r
  return (
    <div className="rest" role="timer" aria-label={remaining === 0 ? 'Rest over' : `Rest, ${remaining} seconds left`}>
      <svg width={32} height={32} aria-hidden="true">
        <circle cx={16} cy={16} r={r} stroke="var(--field)" strokeWidth={3} fill="none" />
        <circle cx={16} cy={16} r={r} stroke={remaining === 0 ? 'var(--done)' : 'var(--ink)'} strokeWidth={3} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - progress)} strokeLinecap="round" transform="rotate(-90 16 16)" />
      </svg>
      <div className="spacer">
        <div className="tiny subtle">{remaining === 0 ? 'Rest over' : 'Rest'}</div>
        <div className="num" style={{ fontSize: 20, fontWeight: 600, color: remaining === 0 ? 'var(--done)' : undefined }}>{clock(remaining)}</div>
      </div>
      <button className="pill quiet num" onClick={() => { tap(); adjustRest(-15) }} aria-label="Subtract 15 seconds">-15</button>
      <button className="pill quiet num" onClick={() => { tap(); adjustRest(15) }} aria-label="Add 15 seconds">+15</button>
      <button className="pill" onClick={() => { tap(); clearRest() }}>{remaining === 0 ? 'Done' : 'Skip'}</button>
    </div>
  )
}

function FinishSheet({ session, unit, onClose, onToast }: { session: WorkoutSession; unit: MassUnit; onClose: () => void; onToast: (m: string) => void }) {
  const data = useStore()
  const [update, setUpdate] = useState(false)
  const finished = finishSession(session)!
  const template = session.sourceTemplate ? data.templates.find((t) => t.id === session.sourceTemplate!.templateId) : undefined
  const proposal = template ? templateProposal(template, session, (id) => data.exerciseById.get(id.toUpperCase())?.name ?? 'Exercise') : undefined
  const best = (e: WorkoutExercise) => {
    const working = e.sets.filter((s) => s.type === 'working')
    if (working.length === 0) return 'Warm-ups only'
    const top = working.reduce((a, b) => {
      const ka = a.load ? kilograms(a.load) : 0, kb = b.load ? kilograms(b.load) : 0
      return kb > ka || (kb === ka && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a
    })
    return setText(top, unit)
  }
  return (
    <Sheet title="Finish workout" onClose={onClose}>
      <div className="row"><span className="dot" /><span className="eyebrow" style={{ color: 'var(--done)' }}>Workout complete</span></div>
      <h2 className="title" style={{ marginBottom: 16 }}>{session.name}</h2>
      <div className="card stats">
        <Stat value={duration(Date.parse(finished.finishedAt!) - Date.parse(finished.startedAt))} label="Duration" />
        <Stat value={String(workingSetCount(finished))} label="Working sets" />
        <Stat value={String(finished.exercises.length)} label="Exercises" />
      </div>
      <div className="section">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Best working set</div>
        <div className="list">
          {finished.exercises.map((e) => (
            <div key={e.id} className="row small" style={{ padding: '10px 0' }}><span className="spacer">{e.exerciseName}</span><span className="num" style={{ fontWeight: 600 }}>{best(e)}</span></div>
          ))}
        </div>
      </div>
      {proposal && template && (
        <div className="card section">
          <label className="toggle">
            <span><strong>Update “{template.name}”</strong><div className="tiny subtle">You changed this workout's structure.</div></span>
            <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--done)' }} />
          </label>
          <ul className="small subtle" style={{ margin: '10px 0 0', paddingLeft: 18 }}>{proposal.changes.map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="tiny faint" style={{ marginBottom: 0 }}>Off keeps the template as it was. Logged weights and reps never change its targets on their own.</p>
        </div>
      )}
      <button className="btn btn-primary" style={{ marginTop: 24 }} onClick={() => {
        tap()
        store.save('session', finished)
        if (update && proposal) store.save('template', proposal.updated)
        clearRest()
        onToast('Workout saved')
        navigate(`/history/${session.id}`)
      }}>Save workout</button>
    </Sheet>
  )
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
