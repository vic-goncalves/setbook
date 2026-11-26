import { useMemo, useState } from 'react'
import { equipmentNames, loadExplanation, matchesSearch, muscleNames } from '../domain/catalog'
import type { Equipment, Exercise, Measurement, MuscleGroup } from '../domain/types'
import { newId, nowIso } from '../domain/types'
import { store, useStore } from '../store'
import { Sheet } from '../ui/components'
import { Icon } from '../ui/icons'

/** Search the catalog and custom exercises, with muscle and equipment filters. */
export function ExerciseList({ onPick, selected, onCreate }: { onPick: (e: Exercise) => void; selected?: Set<string>; onCreate: (name: string) => void }) {
  const data = useStore()
  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | ''>('')
  const [equipment, setEquipment] = useState<Equipment | ''>('')
  const all = useMemo(() => [...data.exerciseById.values()].filter((e) => !e.archivedAt).sort((a, b) => a.name.localeCompare(b.name)), [data.exerciseById])
  const filtered = all.filter((e) => matchesSearch(e, query) && (!muscle || e.primaryMuscle === muscle || e.secondaryMuscles.includes(muscle)) && (!equipment || e.equipment === equipment))

  return (
    <div>
      <div className="stack exercise-search" style={{ position: 'sticky', top: 64, paddingBottom: 8, zIndex: 1 }}>
        <input className="input" placeholder="Search exercises" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus aria-label="Search exercises" />
        <div className="row" style={{ gap: 8 }}>
          <select className="select" value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleGroup | '')} aria-label="Muscle">
            <option value="">Any muscle</option>
            {Object.entries(muscleNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment | '')} aria-label="Equipment">
            <option value="">Any equipment</option>
            {Object.entries(equipmentNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="list">
        {filtered.map((e) => (
          <button key={e.id} className="list-row" onClick={() => onPick(e)} aria-pressed={selected?.has(e.id)}>
            <div className="spacer">
              <div style={{ fontWeight: 500 }}>{e.name}</div>
              <div className="small subtle">{muscleNames[e.primaryMuscle]}, {equipmentNames[e.equipment]}{e.isBuiltIn ? '' : ', Custom'}</div>
            </div>
            {selected ? (
              <span className={`check${selected.has(e.id) ? ' done' : ''}`}><Icon name="check" size={16} stroke={3} /></span>
            ) : <span className="chev"><Icon name="chevron" size={16} /></span>}
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <p className="subtle small">No matches.</p>
          <button className="pill" onClick={() => onCreate(query)}>Create “{query || 'custom exercise'}”</button>
        </div>
      )}
      <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => onCreate(query)}><Icon name="plus" size={16} /> New custom exercise</button>
    </div>
  )
}

export function ExercisePicker({ onClose, onDone }: { onClose: () => void; onDone: (exercises: Exercise[]) => void }) {
  const [selected, setSelected] = useState<Exercise[]>([])
  const [creating, setCreating] = useState<string>()
  const ids = new Set(selected.map((e) => e.id))
  if (creating !== undefined) {
    return <CustomExerciseSheet initialName={creating} onClose={() => setCreating(undefined)} onSaved={(e) => { setSelected([...selected, e]); setCreating(undefined) }} />
  }
  return (
    <Sheet title="Add exercises" onClose={onClose} actions={
      <button className="bar-button strong" disabled={selected.length === 0} onClick={() => { onDone(selected); onClose() }}>{selected.length ? `Add ${selected.length}` : 'Add'}</button>
    }>
      <ExerciseList selected={ids} onCreate={setCreating} onPick={(e) => setSelected(ids.has(e.id) ? selected.filter((x) => x.id !== e.id) : [...selected, e])} />
    </Sheet>
  )
}

const measurementOptions: [string, Measurement][] = [
  ['Weight and reps (total)', { type: 'external_load_reps', loadConvention: 'total' }],
  ['Weight and reps (per hand)', { type: 'external_load_reps', loadConvention: 'per_hand' }],
  ['Reps only', { type: 'bodyweight_reps' }],
  ['Added weight and reps', { type: 'weighted_bodyweight_reps', loadConvention: 'added' }],
  ['Assistance and reps', { type: 'assisted_bodyweight_reps', loadConvention: 'assistance' }],
]

export function CustomExerciseSheet({ existing, initialName = '', locked = false, onClose, onSaved }: {
  existing?: Exercise; initialName?: string; locked?: boolean; onClose: () => void; onSaved?: (e: Exercise) => void
}) {
  const [name, setName] = useState(existing?.name ?? initialName)
  const [primary, setPrimary] = useState<MuscleGroup>(existing?.primaryMuscle ?? 'chest')
  const [equipment, setEquipment] = useState<Equipment>(existing?.equipment ?? 'barbell')
  const [measurement, setMeasurement] = useState(measurementOptions.findIndex(([, m]) => m.type === existing?.measurement.type && m.loadConvention === existing?.measurement.loadConvention))
  const chosen = measurementOptions[Math.max(0, measurement)]![1]
  const save = () => {
    const now = nowIso()
    const exercise: Exercise = {
      id: existing?.id ?? newId(), name: name.trim(), primaryMuscle: primary, secondaryMuscles: existing?.secondaryMuscles ?? [],
      equipment, measurement: chosen, isBuiltIn: false, createdAt: existing?.createdAt ?? now, updatedAt: now,
    }
    store.save('exercise', exercise)
    onSaved?.(exercise)
    onClose()
  }
  return (
    <Sheet title={existing ? 'Edit exercise' : 'New exercise'} onClose={onClose} actions={<button className="bar-button strong" disabled={!name.trim()} onClick={save}>Save</button>}>
      <div className="stack">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Incline Press (Dumbbell)" autoFocus aria-label="Name" />
        <p className="tiny faint" style={{ margin: 0 }}>Make variants separate exercises so their progress isn't mixed.</p>
        <label className="toggle"><span className="subtle">Primary muscle</span>
          <select className="select" value={primary} onChange={(e) => setPrimary(e.target.value as MuscleGroup)}>
            {Object.entries(muscleNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="toggle"><span className="subtle">Equipment</span>
          <select className="select" value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
            {Object.entries(equipmentNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="toggle"><span className="subtle">Logged as</span>
          <select className="select" value={Math.max(0, measurement)} disabled={locked} onChange={(e) => setMeasurement(Number(e.target.value))}>
            {measurementOptions.map(([label], i) => <option key={label} value={i}>{label}</option>)}
          </select>
        </label>
        <p className="tiny faint" style={{ margin: 0 }}>{locked ? "Tracking can't change after the exercise has been logged." : loadExplanation(chosen)}</p>
      </div>
    </Sheet>
  )
}
