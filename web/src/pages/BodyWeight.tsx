import { useState } from 'react'
import { bodyWeightSummary, chartRanges, inRange, type ChartRange } from '../domain/metrics'
import type { BodyMeasurement, MassUnit } from '../domain/types'
import { fromKilograms, localTimeZone, massIn, newId, nowIso } from '../domain/types'
import { calendarDay, mass, num, parseDecimal, signed } from '../format'
import { usePrefs } from '../prefs'
import { back } from '../router'
import { store, useStore } from '../store'
import { Chips, Confirm, EmptyState, SectionHead, Sheet } from '../ui/components'
import { LineChart } from '../ui/chart'
import { Icon } from '../ui/icons'
import { SwipeRow } from '../ui/swipe'

export function BodyWeight() {
  const data = useStore()
  const { unit } = usePrefs()
  const [range, setRange] = useState<ChartRange>('3M')
  const [editing, setEditing] = useState<BodyMeasurement | 'new'>()
  const [showAll, setShowAll] = useState(false)
  const entries = data.measurements
  const summary = bodyWeightSummary(entries, range)
  const raw = entries.filter((e) => inRange(e.measuredAt, range))

  return (
    <>
      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => back('/progress')}><Icon name="back" size={16} /> Progress</button>
      <header className="page-header" style={{ paddingTop: 8 }}>
        <div className="eyebrow">Body weight</div>
        {summary.latest ? (
          <>
            <div style={{ marginTop: 6 }}><span className="metric-huge num">{num(massIn(summary.latest.mass, unit), 1)}</span> <span className="subtle" style={{ fontSize: 20 }}>{unit}</span></div>
            <div className="row small" style={{ marginTop: 8, gap: 8 }}>
              {summary.change ? (
                <>
                  <span className="badge num">{signed(fromKilograms(summary.change.kilograms, unit))} {unit}</span>
                  <span className="subtle">{calendarDay(summary.change.from)} to {calendarDay(summary.change.to)}</span>
                </>
              ) : <span className="subtle">Weigh in on two or more days in this range to see a trend.</span>}
            </div>
          </>
        ) : <h1 className="title">Nothing logged</h1>}
      </header>

      {entries.length === 0 ? (
        <div className="card section">
          <EmptyState title="No weigh-ins yet" message="Log whenever you like. A 7-day average smooths out daily swings once you have a few days."
            action={<button className="pill" onClick={() => setEditing('new')}>Log weight</button>} />
        </div>
      ) : (
        <div className="stack section">
          {raw.length > 0 ? (
            <LineChart label="Body weight chart" area={false}
              points={summary.rollingAverage.map((p) => ({ id: p.day, x: Date.parse(`${p.day}T12:00:00Z`), y: fromKilograms(p.kilograms, unit) }))}
              dots={raw.map((e) => ({ id: e.id, x: Date.parse(e.measuredAt), y: massIn(e.mass, unit) }))}
              format={(v) => num(v, 0)} />
          ) : <div className="card subtle small">No entries in this range.</div>}
          <Chips options={chartRanges} value={range} onChange={setRange} />
          <div className="row tiny subtle" style={{ gap: 16 }}>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 9, background: 'var(--ink-3)' }} />Weigh-ins</span>
            {summary.rollingAverage.length > 0 && <span className="row" style={{ gap: 6 }}><span style={{ width: 14, height: 2.5, background: 'var(--ink)' }} />7-day average of daily means</span>}
          </div>

          <section className="section">
            <SectionHead title="Entries">
              {entries.length > 8 && <button className="btn btn-ghost small" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : `Show all ${entries.length}`}</button>}
            </SectionHead>
            <div className="list">
              {(showAll ? entries : entries.slice(0, 8)).map((e) => (
                <SwipeRow key={e.id} onDelete={() => store.remove('measurement', e.id)}>
                <button className="list-row" style={{ background: 'var(--bg)' }} onClick={() => setEditing(e)}>
                  <div className="spacer">
                    <div className="small">{new Date(e.measuredAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: e.timeZoneIdentifier })}</div>
                    <div className="tiny faint">{[new Date(e.measuredAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: e.timeZoneIdentifier }), e.note].filter(Boolean).join(', ')}</div>
                  </div>
                  <span className="num" style={{ fontWeight: 500 }}>{mass(e.mass, unit)}</span>
                </button>
                </SwipeRow>
              ))}
            </div>
          </section>
        </div>
      )}
      {entries.length > 0 && (
        <div style={{ position: 'sticky', bottom: 'calc(var(--tabbar) + 12px)', marginTop: 24, zIndex: 5 }}>
          <button className="btn btn-primary" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> Log weight</button>
        </div>
      )}
      {editing && <EntrySheet existing={editing === 'new' ? undefined : editing} defaultUnit={unit} onClose={() => setEditing(undefined)} />}
    </>
  )
}

function EntrySheet({ existing, defaultUnit, onClose }: { existing?: BodyMeasurement; defaultUnit: MassUnit; onClose: () => void }) {
  const [text, setText] = useState(existing ? num(existing.mass.value) : '')
  const [unit, setUnit] = useState<MassUnit>(existing?.mass.unit ?? defaultUnit)
  const [when, setWhen] = useState(toLocalInput(existing?.measuredAt ?? nowIso()))
  const [note, setNote] = useState(existing?.note ?? '')
  const [deleting, setDeleting] = useState(false)
  const value = parseDecimal(text)
  const valid = value !== undefined && value > 0
  const future = new Date(when).getTime() > Date.now() + 60_000

  const save = () => {
    if (!valid || future) return
    const now = nowIso()
    const measuredAt = new Date(when).toISOString()
    store.save('measurement', {
      id: existing?.id ?? newId(), kind: 'body_weight', mass: { value: value!, unit }, measuredAt,
      timeZoneIdentifier: existing && existing.measuredAt === measuredAt ? existing.timeZoneIdentifier : localTimeZone(),
      source: 'manual', ...(note.trim() ? { note: note.trim() } : {}), createdAt: existing?.createdAt ?? now, updatedAt: now,
    })
    onClose()
  }

  if (deleting && existing) {
    return <Confirm title="Delete this entry?" message="It will be removed on every device." confirm="Delete" onCancel={() => setDeleting(false)}
      onConfirm={() => { store.remove('measurement', existing.id); onClose() }} />
  }
  return (
    <Sheet title={existing ? 'Edit weight' : 'Log weight'} onClose={onClose} actions={<button className="pill" disabled={!valid || future} onClick={save}>Save</button>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="row">
          <input className="bare num metric-huge" style={{ fontSize: 44 }} inputMode="decimal" placeholder="0.0" value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="Weight" />
          <Chips options={['lb', 'kg'] as MassUnit[]} value={unit} onChange={setUnit} />
        </div>
        {text && !valid && <span className="small" style={{ color: 'var(--danger)' }}>Enter a weight above zero.</span>}
        <label className="toggle small"><span className="subtle">When</span>
          <input type="datetime-local" className="input" style={{ maxWidth: 240 }} value={when} max={toLocalInput(nowIso())} onChange={(e) => setWhen(e.target.value)} />
        </label>
        {future && <span className="small" style={{ color: 'var(--danger)' }}>Pick a time that isn't in the future.</span>}
        <input className="input" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        {existing && <button type="button" className="btn btn-ghost btn-danger" onClick={() => setDeleting(true)}>Delete entry</button>}
      </form>
    </Sheet>
  )
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
