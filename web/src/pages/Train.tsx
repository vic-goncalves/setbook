import { useState } from 'react'
import { muscleNames } from '../domain/catalog'
import { completedSetCount, duplicateTemplate, emptySession, estimatedMinutes, incompleteSetCount, startFromTemplate, workingSetCount } from '../domain/workout'
import type { Exercise, WorkoutSession, WorkoutTemplate } from '../domain/types'
import { localDay } from '../domain/metrics'
import { localTimeZone } from '../domain/types'
import { tap } from '../device'
import { relativeDay, stopwatch } from '../format'
import { navigate } from '../router'
import { store, useStore } from '../store'
import { ActionSheet, Confirm, PageHeader, useNow } from '../ui/components'
import { Icon } from '../ui/icons'

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
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ')
}

export function Train({ onToast }: { onToast: (m: string) => void }) {
  const data = useStore()
  const now = useNow()
  const [menu, setMenu] = useState<WorkoutTemplate>()
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

      <WeekStrip sessions={data.sessions} />

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
              <a className="pill" href="#/templates/new">Create template</a>
              <a className="pill quiet" href="#/coach"><Icon name="sparkle" size={14} /> Ask Coach</a>
            </div>
          </div>
        ) : (
          <div className="train-list">
            {data.templates.map((t) => {
              const last = lastDone(t.id)
              return (
                <div key={t.id} className="train-row">
                  <a className="train-row-main" href={`#/templates/${t.id}`}>
                    <span className="train-row-name">{t.name}</span>
                    <span className="train-row-meta">{musclesOf(t, data.exerciseById) || 'No exercises yet'}</span>
                    <span className="train-row-meta faint">{plural(workingSets(t), 'set')} · ~{estimatedMinutes(t)} min · {last ? `last ${relativeDay(last)}` : 'not done yet'}</span>
                  </a>
                  <button className="icon-button train-row-more" onClick={() => setMenu(t)} aria-label={`Options for ${t.name}`}><Icon name="more" size={20} stroke={3} /></button>
                  {!active && (
                    <button className="train-play" onClick={() => start(t)} aria-label={`Start ${t.name}`}><Icon name="play" size={14} /></button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {!active && (
          <button className="train-quiet" onClick={() => start()}><Icon name="plus" size={16} /> Start an empty workout</button>
        )}
      </section>

      {menu && (
        <ActionSheet
          title={menu.name}
          onClose={() => setMenu(undefined)}
          actions={[
            { label: 'Edit', run: () => navigate(`/templates/${menu.id}`) },
            { label: 'Duplicate', run: () => { store.save('template', duplicateTemplate(menu)); onToast(`Duplicated ${menu.name}`) } },
            { label: 'Delete', danger: true, run: () => setDeleting(menu) },
          ]}
        />
      )}
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

/** This week, Monday to Sunday: a dot on each day trained, today outlined. Facts, not advice. */
function WeekStrip({ sessions }: { sessions: WorkoutSession[] }) {
  const zone = localTimeZone()
  const today = localDay(new Date().toISOString(), zone)
  const noon = (d: string) => new Date(`${d}T12:00:00Z`)
  const monday = new Date(noon(today).getTime() - ((noon(today).getUTCDay() + 6) % 7) * 86_400_000)
  const days = Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10))
  const done = sessions.filter((s) => s.state === 'completed' && days.includes(localDay(s.startedAt, zone)))
  const trained = new Set(done.map((s) => localDay(s.startedAt, zone)))
  const sets = done.reduce((n, s) => n + workingSetCount(s), 0)
  return (
    <a className="week" href="#/history" aria-label={`This week: ${plural(done.length, 'workout')}, ${plural(sets, 'set')}`}>
      <div className="week-head">
        <span className="week-title">This week</span>
        <span className="week-sum">{done.length ? `${plural(done.length, 'workout')} · ${plural(sets, 'set')}` : 'No workouts yet'}</span>
      </div>
      <div className="week-days">
        {days.map((d) => (
          <div key={d} className={`week-day${d === today ? ' today' : ''}${d > today ? ' later' : ''}`}>
            <span className="week-letter">{noon(d).toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })}</span>
            <span className={`week-dot${trained.has(d) ? ' on' : ''}`}>{trained.has(d) ? <Icon name="check" size={13} stroke={3} /> : noon(d).getUTCDate()}</span>
          </div>
        ))}
      </div>
    </a>
  )
}
