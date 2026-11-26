import { useState } from 'react'
import { loadLabel } from '../domain/catalog'
import { DEFAULT_REST, setLabel, strip } from '../domain/workout'
import type { TemplateExercise, TemplateSet, WorkoutTemplate } from '../domain/types'
import { newId, nowIso, tracksLoad } from '../domain/types'
import { mass, parseDecimal, parseInteger } from '../format'
import { usePrefs } from '../prefs'
import { back, navigate } from '../router'
import { store, useStore } from '../store'
import { Confirm, EmptyState } from '../ui/components'
import { Icon } from '../ui/icons'
import { ExercisePicker } from './ExercisePicker'

const restOptions = [30, 45, 60, 90, 120, 150, 180, 240, 300]

export function TemplateEditor({ id }: { id: string }) {
  const data = useStore()
  const { unit, defaultRest } = usePrefs()
  const existing = data.templates.find((t) => t.id === id)
  const [draft, setDraft] = useState<WorkoutTemplate>(() =>
    existing ?? { id: newId(), name: '', revision: 1, exercises: [], createdAt: nowIso(), updatedAt: nowIso() },
  )
  const [picking, setPicking] = useState(false)
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [discarding, setDiscarding] = useState(false)
  const changed = JSON.stringify(draft) !== JSON.stringify(existing)
  const canSave = draft.name.trim().length > 0 && invalid.size === 0 && (!existing || changed)

  if (id !== 'new' && !existing) return <EmptyState title="Template not found" message="It may have been deleted on another device." />

  const update = (index: number, change: (e: TemplateExercise) => TemplateExercise) =>
    setDraft({ ...draft, exercises: draft.exercises.map((e, i) => (i === index ? change(e) : e)) })
  const move = (index: number, by: number) => {
    const next = [...draft.exercises]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item!)
    setDraft({ ...draft, exercises: next })
  }
  const save = () => {
    store.save('template', { ...draft, name: draft.name.trim(), revision: existing ? existing.revision + 1 : 1, updatedAt: nowIso() })
    navigate('/train')
  }

  return (
    <>
      <div className="app-bar">
        <button className="btn btn-ghost" onClick={() => (changed && draft.name ? setDiscarding(true) : back('/train'))}>Cancel</button>
        <div className="title-slot">{existing ? 'Edit template' : 'New template'}</div>
        <button className="pill" disabled={!canSave} onClick={save}>Save</button>
      </div>
      <div style={{ height: 16 }} />
      <input className="bare title" placeholder="Template name, e.g. Push" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Template name" autoFocus={!existing} />
      <textarea className="bare subtle" style={{ marginTop: 8, resize: 'none' }} rows={1} placeholder="Notes" value={draft.notes ?? ''}
        onChange={(e) => setDraft(strip({ ...draft, notes: e.target.value || undefined }))} aria-label="Template notes" />

      {draft.exercises.map((exercise, index) => {
        const info = data.exerciseById.get(exercise.exerciseId.toUpperCase())
        const measurement = info?.measurement ?? { type: 'bodyweight_reps' as const }
        const hasLoad = tracksLoad(measurement)
        return (
          <section key={exercise.id} className="section">
            <div className="row">
              <strong className="spacer" style={{ fontSize: 17 }}>{info?.name ?? 'Exercise'}</strong>
              <select className="select" value={exercise.restSeconds ?? 0} aria-label="Rest timer"
                onChange={(e) => update(index, (x) => strip({ ...x, restSeconds: Number(e.target.value) || undefined }))}>
                <option value={0}>Rest off</option>
                {restOptions.map((s) => <option key={s} value={s}>Rest {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</option>)}
              </select>
              <button className="icon-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up"><Icon name="up" size={16} /></button>
              <button className="icon-button" onClick={() => setDraft({ ...draft, exercises: draft.exercises.filter((_, i) => i !== index) })} aria-label="Remove exercise"><Icon name="trash" size={16} /></button>
            </div>
            <input className="bare small subtle" style={{ margin: '6px 0 10px' }} placeholder="Exercise notes" value={exercise.notes ?? ''}
              onChange={(e) => update(index, (x) => strip({ ...x, notes: e.target.value || undefined }))} aria-label="Exercise notes" />
            <div className="set-grid set-head" style={{ gridTemplateColumns: hasLoad ? '40px 1fr 1fr 110px 36px' : '40px 1fr 1fr 36px' }}>
              <span>Set</span><span>Min reps</span><span>Max reps</span>{hasLoad && <span>{loadLabel(measurement)} ({unit})</span>}<span />
            </div>
            {exercise.sets.map((set, setIndex) => (
              <TemplateSetRow key={set.id} set={set} label={setLabel(exercise.sets, setIndex)} hasLoad={hasLoad} unit={unit}
                onChange={(next, valid) => {
                  update(index, (x) => ({ ...x, sets: x.sets.map((s, i) => (i === setIndex ? next : s)) }))
                  const nextInvalid = new Set(invalid)
                  if (valid) nextInvalid.delete(set.id)
                  else nextInvalid.add(set.id)
                  setInvalid(nextInvalid)
                }}
                onRemove={() => update(index, (x) => ({ ...x, sets: x.sets.filter((_, i) => i !== setIndex) }))}
              />
            ))}
            <button className="btn btn-secondary" style={{ marginTop: 8, minHeight: 40 }}
              onClick={() => update(index, (x) => {
                const last = x.sets.at(-1)
                return { ...x, sets: [...x.sets, strip({ id: newId(), type: last?.type ?? 'working', targetReps: last?.targetReps, targetLoad: last?.targetLoad })] }
              })}>
              <Icon name="plus" size={16} /> Add set
            </button>
          </section>
        )
      })}

      <button className="btn btn-secondary" style={{ marginTop: 28 }} onClick={() => setPicking(true)}><Icon name="plus" size={16} /> Add exercises</button>
      {picking && (
        <ExercisePicker onClose={() => setPicking(false)} onDone={(list) =>
          setDraft({ ...draft, exercises: [...draft.exercises, ...list.map((e) => ({ id: newId(), exerciseId: e.id, restSeconds: defaultRest || DEFAULT_REST, sets: [{ id: newId(), type: 'working' as const }] }))] })}
        />
      )}
      {discarding && <Confirm title="Discard changes?" message="Your edits to this template will be lost." confirm="Discard changes" onCancel={() => setDiscarding(false)} onConfirm={() => back('/train')} />}
    </>
  )
}

function TemplateSetRow({ set, label, hasLoad, unit, onChange, onRemove }: {
  set: TemplateSet; label: string; hasLoad: boolean; unit: 'kg' | 'lb'; onChange: (s: TemplateSet, valid: boolean) => void; onRemove: () => void
}) {
  const [minText, setMin] = useState(set.targetReps ? String(set.targetReps.min) : '')
  const [maxText, setMax] = useState(set.targetReps && set.targetReps.max !== set.targetReps.min ? String(set.targetReps.max) : '')
  const [loadText, setLoad] = useState(set.targetLoad ? mass(set.targetLoad, unit, false) : '')

  const commit = (min: string, max: string, load: string, type = set.type) => {
    const lo = parseInteger(min)
    const hi = max ? parseInteger(max) : lo
    const repsValid = (!min && !max) || (lo !== undefined && hi !== undefined && lo >= 1 && hi >= lo)
    const loadValue = parseDecimal(load)
    const loadValid = !load || (loadValue !== undefined && loadValue >= 0)
    const keepLoad = set.targetLoad && load === mass(set.targetLoad, unit, false)
    onChange(strip({
      ...set,
      type,
      targetReps: repsValid && lo !== undefined && hi !== undefined ? { min: lo, max: hi } : undefined,
      targetLoad: hasLoad ? (keepLoad ? set.targetLoad : loadValid && loadValue !== undefined ? { value: loadValue, unit } : undefined) : undefined,
    }), repsValid && loadValid)
  }
  const invalidReps = !!(minText || maxText) && !(parseInteger(minText) && (!maxText || (parseInteger(maxText) ?? 0) >= (parseInteger(minText) ?? 0)))

  return (
    <div className="set-grid" style={{ gridTemplateColumns: hasLoad ? '40px 1fr 1fr 110px 36px' : '40px 1fr 1fr 36px', padding: '3px 0' }}>
      <button className={`set-num field${set.type === 'warmup' ? ' warmup' : ''}`} style={{ color: set.type === 'warmup' ? 'var(--warmup)' : undefined }}
        onClick={() => commit(minText, maxText, loadText, set.type === 'warmup' ? 'working' : 'warmup')}
        aria-label={set.type === 'warmup' ? 'Warm-up set, switch to working' : `Working set ${label}, switch to warm-up`}>{label}</button>
      <input className={`field num${invalidReps ? ' invalid' : ''}`} inputMode="numeric" placeholder="8" value={minText} aria-label="Minimum reps"
        onChange={(e) => { setMin(e.target.value); commit(e.target.value, maxText, loadText) }} />
      <input className={`field num${invalidReps ? ' invalid' : ''}`} inputMode="numeric" placeholder="-" value={maxText} aria-label="Maximum reps, optional"
        onChange={(e) => { setMax(e.target.value); commit(minText, e.target.value, loadText) }} />
      {hasLoad && (
        <input className="field num" inputMode="decimal" placeholder="-" value={loadText} aria-label={`Target load in ${unit}, optional`}
          onChange={(e) => { setLoad(e.target.value); commit(minText, maxText, e.target.value) }} />
      )}
      <button className="icon-button" onClick={onRemove} aria-label="Remove set"><Icon name="close" size={14} /></button>
    </div>
  )
}
