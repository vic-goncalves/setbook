import { useState } from 'react'
import { loadLabel } from '../domain/catalog'
import { DEFAULT_REST, duplicateTemplate, setLabel, strip } from '../domain/workout'
import type { Measurement, TemplateExercise, TemplateSet, WorkoutTemplate } from '../domain/types'
import { newId, nowIso, tracksLoad } from '../domain/types'
import { mass, parseDecimal, parseInteger } from '../format'
import { usePrefs } from '../prefs'
import { back, navigate } from '../router'
import { store, useStore } from '../store'
import { ActionSheet, Confirm, EmptyState, TitleField } from '../ui/components'
import { SwipeRow } from '../ui/swipe'
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
  const [deleting, setDeleting] = useState(false)
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
        <button className="bar-button" style={{ minWidth: 64, textAlign: 'left' }} onClick={() => (changed && draft.name ? setDiscarding(true) : back('/train'))}>Cancel</button>
        <div className="title-slot">{existing ? 'Edit template' : 'New template'}</div>
        <button className="bar-button strong" style={{ minWidth: 64, textAlign: 'right' }} disabled={!canSave} onClick={save}>Save</button>
      </div>
      <div style={{ height: 16 }} />
      <TitleField value={draft.name} placeholder="Template name" label="Template name" autoFocus={!existing} onChange={(name) => setDraft({ ...draft, name })} />
      <textarea className="bare subtle" style={{ marginTop: 8, resize: 'none' }} rows={1} placeholder="Notes" value={draft.notes ?? ''}
        onChange={(e) => setDraft(strip({ ...draft, notes: e.target.value || undefined }))} aria-label="Template notes" />

      {draft.exercises.map((exercise, index) => (
        <TemplateExerciseBlock
          key={exercise.id}
          exercise={exercise}
          index={index}
          count={draft.exercises.length}
          name={data.exerciseById.get(exercise.exerciseId.toUpperCase())?.name ?? 'Exercise'}
          measurement={data.exerciseById.get(exercise.exerciseId.toUpperCase())?.measurement ?? { type: 'bodyweight_reps' }}
          unit={unit}
          onChange={(next) => update(index, () => next)}
          onMove={(by) => move(index, by)}
          onRemove={() => setDraft({ ...draft, exercises: draft.exercises.filter((_, i) => i !== index) })}
          onValidity={(setId, valid) => {
            const next = new Set(invalid)
            if (valid) next.delete(setId)
            else next.add(setId)
            setInvalid(next)
          }}
        />
      ))}

      <button className="btn btn-secondary" style={{ marginTop: 28 }} onClick={() => setPicking(true)}><Icon name="plus" size={16} /> Add exercises</button>
      {existing && (
        <div className="tpl-footer">
          <button onClick={() => { store.save('template', duplicateTemplate(existing)); navigate('/train') }}>Duplicate template</button>
          <button className="danger" onClick={() => setDeleting(true)}>Delete template</button>
        </div>
      )}
      {deleting && (
        <Confirm title={`Delete ${existing?.name ?? 'template'}?`} message="Past workouts started from it stay in your history." confirm="Delete template"
          onCancel={() => setDeleting(false)} onConfirm={() => { if (existing) store.remove('template', existing.id); navigate('/train') }} />
      )}
      {picking && (
        <ExercisePicker onClose={() => setPicking(false)} onDone={(list) =>
          setDraft({ ...draft, exercises: [...draft.exercises, ...list.map((e) => ({ id: newId(), exerciseId: e.id, restSeconds: defaultRest || DEFAULT_REST, sets: [{ id: newId(), type: 'working' as const }] }))] })}
        />
      )}
      {discarding && <Confirm title="Discard changes?" message="Your edits to this template will be lost." confirm="Discard changes" onCancel={() => setDiscarding(false)} onConfirm={() => back('/train')} />}
    </>
  )
}

function TemplateExerciseBlock({ exercise, index, count, name, measurement, unit, onChange, onMove, onRemove, onValidity }: {
  exercise: TemplateExercise; index: number; count: number; name: string; measurement: Measurement; unit: 'kg' | 'lb'
  onChange: (e: TemplateExercise) => void; onMove: (by: number) => void; onRemove: () => void; onValidity: (setId: string, valid: boolean) => void
}) {
  const [menu, setMenu] = useState(false)
  const [addingNote, setAddingNote] = useState(false)
  // Most exercises are "N sets of the same target": edit that as one card. Mixed sets (or a
  // tap on "Edit sets one by one") show every set.
  const [detailed, setDetailed] = useState(() => !isUniform(exercise))
  const hasLoad = tracksLoad(measurement)
  const columns = hasLoad ? '40px 1fr 1fr 96px' : '40px 1fr 1fr'
  return (
    <section className="section">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <strong className="spacer" style={{ fontSize: 17, paddingTop: 6 }}>{name}</strong>
        <select className="select" value={exercise.restSeconds ?? 0} aria-label={`Rest timer for ${name}`}
          onChange={(e) => onChange(strip({ ...exercise, restSeconds: Number(e.target.value) || undefined }))}>
          <option value={0}>Rest off</option>
          {restOptions.map((s) => <option key={s} value={s}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</option>)}
        </select>
        <button className="icon-button" onClick={() => setMenu(true)} aria-label={`Options for ${name}`}><Icon name="more" size={22} stroke={3} /></button>
      </div>
      {(exercise.notes !== undefined || addingNote) && (
        <input className="bare small subtle" style={{ marginTop: 6 }} placeholder="Note" value={exercise.notes ?? ''} autoFocus={addingNote}
          onBlur={() => setAddingNote(false)} onChange={(e) => onChange(strip({ ...exercise, notes: e.target.value || undefined }))} aria-label={`Note for ${name}`} />
      )}
      {!detailed ? (
        <>
          <SimpleSets exercise={exercise} hasLoad={hasLoad} loadName={loadLabel(measurement) ?? 'Weight'} unit={unit} onChange={onChange}
            onValidity={(valid) => onValidity(exercise.id, valid)} />
          <button className="tpl-detail-link" onClick={() => setDetailed(true)}>Edit sets one by one</button>
        </>
      ) : (
      <>
      <div className="set-grid set-head" style={{ gridTemplateColumns: columns, marginTop: 10, paddingLeft: 0, paddingRight: 0 }}>
        <span style={{ textAlign: 'center' }}>Set</span><span style={{ textAlign: 'center' }}>Min reps</span><span style={{ textAlign: 'center' }}>Max reps</span>
        {hasLoad && <span style={{ textAlign: 'center' }}>{loadLabel(measurement)} ({unit})</span>}
      </div>
      {exercise.sets.map((set, setIndex) => (
        <SwipeRow key={set.id} onDelete={() => { onValidity(set.id, true); onChange({ ...exercise, sets: exercise.sets.filter((_, i) => i !== setIndex) }) }}>
          <TemplateSetRow set={set} label={setLabel(exercise.sets, setIndex)} hasLoad={hasLoad} unit={unit} columns={columns}
            onChange={(next, valid) => {
              onChange({ ...exercise, sets: exercise.sets.map((s, i) => (i === setIndex ? next : s)) })
              onValidity(set.id, valid)
            }} />
        </SwipeRow>
      ))}
      <button className="btn btn-secondary" style={{ marginTop: 8, minHeight: 42, color: 'var(--ink-2)', background: 'var(--surface)', border: 0 }}
        onClick={() => {
          const last = exercise.sets.at(-1)
          onChange({ ...exercise, sets: [...exercise.sets, strip({ id: newId(), type: last?.type ?? 'working', targetReps: last?.targetReps, targetLoad: last?.targetLoad })] })
        }}>
        <Icon name="plus" size={16} /> Add set
      </button>
      </>
      )}
      {menu && (
        <ActionSheet title={name} onClose={() => setMenu(false)} actions={[
          ...(exercise.notes === undefined ? [{ label: 'Add note', run: () => setAddingNote(true) }] : []),
          ...(index > 0 ? [{ label: 'Move up', run: () => onMove(-1) }] : []),
          ...(index < count - 1 ? [{ label: 'Move down', run: () => onMove(1) }] : []),
          { label: 'Remove exercise', run: onRemove, danger: true },
        ]} />
      )}
    </section>
  )
}

function TemplateSetRow({ set, label, hasLoad, unit, columns, onChange }: {
  set: TemplateSet; label: string; hasLoad: boolean; unit: 'kg' | 'lb'; columns: string; onChange: (s: TemplateSet, valid: boolean) => void
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
    <div className="set-grid" style={{ gridTemplateColumns: columns, padding: '3px 0', background: 'var(--bg)' }}>
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
    </div>
  )
}

/** Every working set has the same target, and warm-ups have none. */
function isUniform(exercise: TemplateExercise): boolean {
  const working = exercise.sets.filter((s) => s.type === 'working')
  const warmups = exercise.sets.filter((s) => s.type === 'warmup')
  const firstWarmup = exercise.sets.findIndex((s) => s.type === 'warmup')
  const lastWarmup = exercise.sets.map((s) => s.type).lastIndexOf('warmup')
  if (warmups.length && (firstWarmup !== 0 || lastWarmup !== warmups.length - 1)) return false // warm-ups first
  if (warmups.some((s) => s.targetReps || s.targetLoad)) return false
  const key = (s: TemplateSet) => JSON.stringify([s.targetReps ?? null, s.targetLoad ?? null])
  return working.length > 0 && working.every((s) => key(s) === key(working[0]!))
}

function Stepper({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (v: number) => void }) {
  return (
    <div className="tpl-stepper" role="group" aria-label={label}>
      <button onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>−</button>
      <span className="num" aria-live="polite">{value}</span>
      <button onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>+</button>
    </div>
  )
}

/** One card for "N sets of reps at weight, after W warm-ups". Rebuilds the sets, keeping ids. */
function SimpleSets({ exercise, hasLoad, loadName, unit, onChange, onValidity }: {
  exercise: TemplateExercise; hasLoad: boolean; loadName: string; unit: 'kg' | 'lb'; onChange: (e: TemplateExercise) => void; onValidity: (valid: boolean) => void
}) {
  const working = exercise.sets.filter((s) => s.type === 'working')
  const warmups = exercise.sets.filter((s) => s.type === 'warmup')
  const first = working[0]
  const [minText, setMin] = useState(first?.targetReps ? String(first.targetReps.min) : '')
  const [maxText, setMax] = useState(first?.targetReps && first.targetReps.max !== first.targetReps.min ? String(first.targetReps.max) : '')
  const [loadText, setLoad] = useState(first?.targetLoad ? mass(first.targetLoad, unit, false) : '')

  const rebuild = (count: number, warm: number, min: string, max: string, load: string) => {
    const lo = parseInteger(min)
    const hi = max ? parseInteger(max) : lo
    const repsValid = (!min && !max) || (lo !== undefined && hi !== undefined && lo >= 1 && hi >= lo)
    const loadValue = parseDecimal(load)
    const loadValid = !load || (loadValue !== undefined && loadValue >= 0)
    const keepLoad = first?.targetLoad && load === mass(first.targetLoad, unit, false)
    const targetReps = repsValid && lo !== undefined && hi !== undefined ? { min: lo, max: hi } : undefined
    const targetLoad = hasLoad ? (keepLoad ? first?.targetLoad : loadValid && loadValue !== undefined ? { value: loadValue, unit } : undefined) : undefined
    const sets: TemplateSet[] = [
      ...Array.from({ length: warm }, (_, i): TemplateSet => ({ id: warmups[i]?.id ?? newId(), type: 'warmup' })),
      ...Array.from({ length: count }, (_, i): TemplateSet => strip({ id: working[i]?.id ?? newId(), type: 'working' as const, targetReps, targetLoad })),
    ]
    onChange({ ...exercise, sets })
    onValidity(repsValid && loadValid)
  }
  const invalidReps = !!(minText || maxText) && !(parseInteger(minText) && (!maxText || (parseInteger(maxText) ?? 0) >= (parseInteger(minText) ?? 0)))

  return (
    <div className="tpl-simple">
      <div className="tpl-cell">
        <span className="tpl-label">Sets</span>
        <Stepper label="Sets" value={working.length} min={1} max={20} onChange={(n) => rebuild(n, warmups.length, minText, maxText, loadText)} />
      </div>
      <div className="tpl-cell">
        <span className="tpl-label">Reps</span>
        <div className="tpl-range">
          <input className={`field num${invalidReps ? ' invalid' : ''}`} inputMode="numeric" placeholder="8" value={minText} aria-label="Minimum reps"
            onChange={(e) => { setMin(e.target.value); rebuild(working.length, warmups.length, e.target.value, maxText, loadText) }} />
          <span className="faint">–</span>
          <input className={`field num${invalidReps ? ' invalid' : ''}`} inputMode="numeric" placeholder="max" value={maxText} aria-label="Maximum reps, optional"
            onChange={(e) => { setMax(e.target.value); rebuild(working.length, warmups.length, minText, e.target.value, loadText) }} />
        </div>
      </div>
      {hasLoad && (
        <div className="tpl-cell">
          <span className="tpl-label">{loadName} ({unit})</span>
          <input className="field num tpl-load" inputMode="decimal" placeholder="Optional" value={loadText} aria-label={`Target ${loadName.toLowerCase()} in ${unit}, optional`}
            onChange={(e) => { setLoad(e.target.value); rebuild(working.length, warmups.length, minText, maxText, e.target.value) }} />
        </div>
      )}
      <div className="tpl-cell">
        <span className="tpl-label">Warm-ups</span>
        <Stepper label="Warm-up sets" value={warmups.length} min={0} max={10} onChange={(n) => rebuild(working.length, n, minText, maxText, loadText)} />
      </div>
    </div>
  )
}
