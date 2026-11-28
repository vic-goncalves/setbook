import { useState } from 'react'
import { muscleNames } from '../domain/catalog'
import { completedSetCount, emptySession, estimatedMinutes, incompleteSetCount, startFromTemplate } from '../domain/workout'
import type { Exercise, WorkoutTemplate } from '../domain/types'
import { tap } from '../device'
import { relativeDay, stopwatch } from '../format'
import { navigate } from '../router'
import { store, useStore } from '../store'
import { Confirm, PageHeader, useNow } from '../ui/components'
import { SwipeRow } from '../ui/swipe'
import { Icon } from '../ui/icons'

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function workingSets(t: WorkoutTemplate) {
  return t.exercises.reduce((n, e) => n + e.sets.filter((s) => s.type === 'working').length, 0)
}

/** "Chest, Shoulders, Triceps": primary muscles by how many sets hit them. */
function musclesOf(t: WorkoutTemplate, byId: Map<string, Exercise>): string {
  const sets = new Map<string, number>()
  for (const e of t.exercises) {
    const m = byId.get(e.exerciseId.toUpperCase())?.primaryMuscle
    if (m) sets.set(m, (sets.get(m) ?? 0) + e.sets.length)
  }
  const names = [...sets.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => muscleNames[m as keyof typeof muscleNames] ?? m)
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')
}

export function Train({ onToast }: { onToast: (m: string) => void }) {
  const data = useStore()
  const now = useNow()
  const [deleting, setDeleting] = useState<WorkoutTemplate>()
  const active = data.sessions.find((s) => s.state === 'active')

  const lastDone = (id: string) => data.sessions.find((s) => s.state === 'completed' && s.sourceTemplate?.templateId === id)?.startedAt

  const start = (template?: WorkoutTemplate) => {
    if (active) return onToast('Finish or discard your current workout first.')
    tap()
    store.save('session', template ? startFromTemplate(template, data.exerciseById) : emptySession())
    navigate('/workout')
  }

  return (
    <>
      <PageHeader account title="Train" />

      {active && (
        <button className="train-hero resume" onClick={() => navigate('/workout')}>
          <div className="row"><span className="dot" /><span className="train-hero-label" style={{ color: 'var(--done)' }}>In progress</span></div>
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <div className="spacer">
              <div className="train-hero-name">{active.name}</div>
              <div className="train-hero-meta">{completedSetCount(active)} of {completedSetCount(active) + incompleteSetCount(active)} sets done</div>
            </div>
            <div className="metric-big num">{stopwatch(now - Date.parse(active.startedAt))}</div>
          </div>
          <div className="btn btn-primary train-hero-button">Resume workout</div>
        </button>
      )}

      {!active && (
        <button className="train-quick" onClick={() => start()} aria-label="Start an empty workout">
          <span className="train-tile quick"><Icon name="plus" size={22} stroke={2.4} /></span>
          <span className="train-row-main">
            <span className="train-row-name">Empty workout</span>
            <span className="train-row-meta">Add exercises as you go</span>
          </span>
          <span className="train-play" aria-hidden="true"><Icon name="play" size={14} /></span>
        </button>
      )}

      <section className="section">
        <div className="train-list-head">
          <h2>Templates</h2>
          <a className="train-new" href="#/templates/new" aria-label="New template"><Icon name="plus" size={20} stroke={2.2} /></a>
        </div>
        {data.templates.length === 0 ? (
          <div className="train-empty">
            <strong>Save the routines you repeat</strong>
            <span>A template like Push or Legs starts with one tap and shows what you lifted last time.</span>
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              {!active && <button className="pill" onClick={() => start()}><Icon name="play" size={11} /> Empty workout</button>}
              <a className="pill quiet" href="#/templates/new">Create template</a>
              <a className="pill quiet" href="#/coach"><Icon name="sparkle" size={14} /> Ask Coach</a>
            </div>
          </div>
        ) : (
          <div className="train-list">
            {data.templates.map((t) => {
              const last = lastDone(t.id)
              return (
                <SwipeRow key={t.id} onDelete={() => setDeleting(t)}>
                  <div className="train-row">
                    <a className="train-row-main" href={`#/templates/${t.id}`}>
                      <span className="train-row-name">{t.name}</span>
                      <span className="train-row-meta">{musclesOf(t, data.exerciseById) || 'No exercises yet'}</span>
                      <span className="train-row-meta faint">{plural(workingSets(t), 'set')} · {estimatedMinutes(t)} min · {last ? capitalize(relativeDay(last)) : 'New'}</span>
                    </a>
                    {!active && (
                      <button className="train-play" onClick={() => start(t)} aria-label={`Start ${t.name}`}><Icon name="play" size={14} /></button>
                    )}
                  </div>
                </SwipeRow>
              )
            })}
          </div>
        )}
      </section>

      {deleting && (
        <Confirm
          title={`Delete ${deleting.name}?`}
          message="Past workouts started from it stay in your history."
          confirm="Delete template"
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => {
            store.remove('template', deleting.id)
            setDeleting(undefined)
          }}
        />
      )}
    </>
  )
}
