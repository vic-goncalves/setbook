import { useState } from 'react'
import { completedSetCount, duplicateTemplate, emptySession, incompleteSetCount, startFromTemplate } from '../domain/workout'
import type { WorkoutTemplate } from '../domain/types'
import { relativeDay, stopwatch } from '../format'
import { navigate } from '../router'
import { store, useStore } from '../store'
import { Confirm, EmptyState, PageHeader, SectionHead, useNow } from '../ui/components'
import { Icon } from '../ui/icons'

export function Train({ onToast }: { onToast: (m: string) => void }) {
  const data = useStore()
  const now = useNow()
  const [deleting, setDeleting] = useState<WorkoutTemplate>()
  const active = data.sessions.find((s) => s.state === 'active')

  const lastPerformed = (id: string) => data.sessions.find((s) => s.state === 'completed' && s.sourceTemplate?.templateId === id)?.startedAt

  const start = (template?: WorkoutTemplate) => {
    if (active) return onToast('Finish or discard your current workout first.')
    store.save('session', template ? startFromTemplate(template, data.exerciseById) : emptySession())
    navigate('/workout')
  }

  return (
    <>
      <PageHeader account title="Train" />
      <div className="stack" style={{ marginTop: 16 }}>
        {active ? (
          <button className="card clickable" style={{ textAlign: 'left', borderColor: 'rgba(76,195,138,.35)' }} onClick={() => navigate('/workout')}>
            <div className="row"><span className="dot" /><span className="eyebrow" style={{ color: 'var(--done)' }}>In progress</span></div>
            <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
              <div className="spacer">
                <div style={{ fontWeight: 600, fontSize: 19 }}>{active.name}</div>
                <div className="small subtle">{completedSetCount(active)} of {completedSetCount(active) + incompleteSetCount(active)} sets done</div>
              </div>
              <div className="metric-big num">{stopwatch(now - Date.parse(active.startedAt))}</div>
            </div>
            <div className="btn btn-primary" style={{ marginTop: 14, minHeight: 48 }}>Resume workout</div>
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => start()}><Icon name="plus" /> Start empty workout</button>
        )}
      </div>

      <section className="section">
        <SectionHead title="Templates">
          <a className="btn btn-ghost" href="#/templates/new"><Icon name="plus" size={16} /> New</a>
        </SectionHead>
        {data.templates.length === 0 && (
          <div className="card">
            <EmptyState
              title="Save the routines you repeat"
              message="A template like Push or Legs starts with one tap and shows what you lifted last time."
              action={<a className="pill" href="#/templates/new">Create template</a>}
            />
          </div>
        )}
        <div className="stack">
          {data.templates.map((t) => {
            const last = lastPerformed(t.id)
            return (
              <div key={t.id} className="card">
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <a className="spacer" href={`#/templates/${t.id}`}>
                    <div style={{ fontWeight: 600, fontSize: 19 }}>{t.name}</div>
                    <div className="small subtle">{t.exercises.length} exercise{t.exercises.length === 1 ? '' : 's'}, {last ? `last ${relativeDay(last)}` : 'not done yet'}</div>
                  </a>
                  <TemplateMenu
                    onEdit={() => navigate(`/templates/${t.id}`)}
                    onDuplicate={() => {
                      store.save('template', duplicateTemplate(t))
                      onToast(`Duplicated ${t.name}`)
                    }}
                    onDelete={() => setDeleting(t)}
                  />
                </div>
                <div style={{ marginTop: 10 }}>
                  {t.exercises.slice(0, 4).map((e) => (
                    <div key={e.id} className="row small" style={{ gap: 8, padding: '2px 0' }}>
                      <span className="num faint" style={{ width: 16, textAlign: 'right' }}>{e.sets.length}</span>
                      <span className="subtle">{data.exerciseById.get(e.exerciseId.toUpperCase())?.name ?? 'Exercise'}</span>
                    </div>
                  ))}
                  {t.exercises.length > 4 && <div className="small faint" style={{ paddingLeft: 24 }}>+{t.exercises.length - 4} more</div>}
                </div>
                {/* No disabled buttons: while a workout runs, the resume card is the one action. */}
                {!active && (
                  <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                    <button className="pill" onClick={() => start(t)} aria-label={`Start ${t.name}`}><Icon name="play" size={12} /> Start</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
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

function TemplateMenu({ onEdit, onDuplicate, onDelete }: { onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-button" aria-label="Template options" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="more" size={22} stroke={3} /></button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 40, zIndex: 10, padding: 6, minWidth: 160, background: 'var(--raised)' }} onMouseLeave={() => setOpen(false)}>
          {[['Edit', onEdit], ['Duplicate', onDuplicate], ['Delete', onDelete]].map(([label, action]) => (
            <button key={label as string} className="list-row" style={{ padding: '10px 10px', color: label === 'Delete' ? 'var(--danger)' : undefined }}
              onClick={() => { setOpen(false); (action as () => void)() }}>{label as string}</button>
          ))}
        </div>
      )}
    </div>
  )
}
