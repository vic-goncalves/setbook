import { useMemo, useRef, useState } from 'react'
import { localDay, workoutHighlights } from '../domain/metrics'
import { weekStreak, workingSetCount } from '../domain/workout'
import { fromKilograms, localTimeZone, type WorkoutSession } from '../domain/types'
import { tap } from '../device'
import { usePrefs } from '../prefs'
import { useStore } from '../store'
import { Chevron, EmptyState, PageHeader } from '../ui/components'
import { Icon } from '../ui/icons'

/** "12.4k" style for big totals; the unit comes from the caller. */
export function compact(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
}

export function minutes(s: WorkoutSession): string | undefined {
  if (!s.finishedAt) return undefined
  const m = Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60000)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}

const DAY_MS = 86_400_000
const noon = (d: string) => new Date(`${d}T12:00:00Z`)
const addDays = (d: string, n: number) => new Date(noon(d).getTime() + n * DAY_MS).toISOString().slice(0, 10)
const mondayOf = (d: string) => addDays(d, -((noon(d).getUTCDay() + 6) % 7))
/** The day a workout happened where it happened. */
const dayOf = (s: WorkoutSession) => localDay(s.startedAt, s.timeZoneIdentifier)

export function History() {
  const data = useStore()
  const { unit } = usePrefs()
  const completed = useMemo(() => data.sessions.filter((s) => s.state === 'completed'), [data.sessions])
  const today = localDay(new Date().toISOString(), localTimeZone())
  const [month, setMonth] = useState(today.slice(0, 7)) // "YYYY-MM"
  const [selected, setSelected] = useState<string>()

  // Records and volume per workout, computed once per data change.
  const summary = useMemo(() => {
    const map = new Map<string, { records: number; volumeKg: number }>()
    for (const s of completed) {
      const h = workoutHighlights(s, completed)
      map.set(s.id, { records: h.filter((x) => x.record).length, volumeKg: h.reduce((n, x) => n + x.volumeKg, 0) })
    }
    return map
  }, [completed])

  const byDay = useMemo(() => {
    const map = new Map<string, WorkoutSession[]>()
    for (const s of completed) map.set(dayOf(s), [...(map.get(dayOf(s)) ?? []), s])
    return map
  }, [completed])
  const streak = weekStreak(new Set(byDay.keys()), today)

  const inMonth = completed.filter((s) => dayOf(s).startsWith(month))
  const shown = selected ? byDay.get(selected) ?? [] : inMonth
  const totalMinutes = inMonth.reduce((n, s) => n + (s.finishedAt ? (Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60000 : 0), 0)
  const firstMonth = completed.length ? dayOf(completed.at(-1)!).slice(0, 7) : today.slice(0, 7)

  const go = (by: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number]
    const next = new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7)
    if (next > today.slice(0, 7) || next < firstMonth) return
    tap()
    setMonth(next)
    setSelected(undefined)
  }

  if (completed.length === 0) {
    return (
      <>
        <PageHeader account title="History" />
        <div className="card section"><EmptyState title="No workouts yet" message="Finished workouts show up here on a calendar, with every set you logged." /></div>
      </>
    )
  }

  const monthLabel = noon(`${month}-15`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <>
      <PageHeader account title="History" />

      <MonthCalendar
        month={month}
        label={monthLabel}
        today={today}
        selected={selected}
        trained={byDay}
        canPrev={month > firstMonth}
        canNext={month < today.slice(0, 7)}
        onMove={go}
        onSelect={(d) => {
          tap()
          setSelected(d === selected ? undefined : d)
        }}
      />
      <div className="cal-stats">
        <div><span className="num">{inMonth.length}</span><label>Workouts</label></div>
        <div><span className="num">{inMonth.reduce((n, s) => n + workingSetCount(s), 0)}</span><label>Sets</label></div>
        <div><span className="num">{totalMinutes >= 600 ? `${Math.round(totalMinutes / 60)}h` : totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m` : `${Math.round(totalMinutes)}m`}</span><label>Time</label></div>
        <div className={streak > 1 ? 'streak' : ''}><span className="num">{streak}<small> wk</small></span><label>Streak</label></div>
      </div>

      <section className="section">
        <div className="hist-month">
          <h2>{selected ? noon(selected).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Workouts'}</h2>
          {selected && <button className="hist-clear" onClick={() => setSelected(undefined)}>Show all</button>}
        </div>
        {shown.length === 0 ? (
          <div className="hist-none">{selected ? (selected > today ? 'Nothing yet.' : 'Rest day.') : `No workouts in ${monthLabel}.`}</div>
        ) : (
          <div className="hist-list">
            {shown.map((s) => {
              const date = new Date(s.startedAt)
              const opts = { timeZone: s.timeZoneIdentifier }
              const info = summary.get(s.id)
              const volume = info && info.volumeKg > 0 ? `${compact(fromKilograms(info.volumeKg, unit))} ${unit}` : undefined
              const sets = workingSetCount(s)
              return (
                <a key={s.id} className="hist-row" href={`#/history/${s.id}`}>
                  <div className="hist-date">
                    <span className="hist-dow">{date.toLocaleDateString(undefined, { weekday: 'short', ...opts })}</span>
                    <span className="hist-dom num">{date.toLocaleDateString(undefined, { day: 'numeric', ...opts })}</span>
                  </div>
                  <div className="hist-main">
                    <span className="hist-name">{s.name}</span>
                    <span className="hist-meta num">{[minutes(s), `${sets} set${sets === 1 ? '' : 's'}`, volume].filter(Boolean).join(' · ')}</span>
                  </div>
                  {info && info.records > 0 && <span className="hist-pr">{info.records} PR{info.records === 1 ? '' : 's'}</span>}
                  <Chevron />
                </a>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}

/** A month grid, Monday first. Trained days are filled; swipe sideways or use the arrows to move. */
function MonthCalendar({ month, label, today, selected, trained, canPrev, canNext, onMove, onSelect }: {
  month: string; label: string; today: string; selected?: string; trained: Map<string, WorkoutSession[]>
  canPrev: boolean; canNext: boolean; onMove: (by: number) => void; onSelect: (day: string) => void
}) {
  const first = `${month}-01`
  const start = mondayOf(first)
  const [y, m] = month.split('-').map(Number) as [number, number]
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = Math.ceil(((noon(first).getUTCDay() + 6) % 7 + daysInMonth) / 7) * 7
  const swipe = useRef<{ x: number; y: number } | undefined>(undefined)

  return (
    <div
      className="cal"
      onPointerDown={(e) => { if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY } }}
      onPointerUp={(e) => {
        const s = swipe.current
        swipe.current = undefined
        if (!s) return
        const dx = e.clientX - s.x
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) onMove(dx < 0 ? 1 : -1)
      }}
    >
      <div className="cal-head">
        <button className="cal-nav" onClick={() => onMove(-1)} disabled={!canPrev} aria-label="Previous month"><Icon name="back" size={18} stroke={2.4} /></button>
        <span className="cal-title">{label}</span>
        <button className="cal-nav" onClick={() => onMove(1)} disabled={!canNext} aria-label="Next month"><Icon name="chevron" size={18} stroke={2.4} /></button>
      </div>
      <div className="cal-grid" role="grid" aria-label={label}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="cal-dow">{d}</span>)}
        {Array.from({ length: cells }, (_, i) => {
          const day = addDays(start, i)
          const inMonth = day.startsWith(month)
          const count = trained.get(day)?.length ?? 0
          const classes = ['cal-day', inMonth ? '' : 'out', count ? 'on' : '', day === today ? 'today' : '', day === selected ? 'selected' : '', day > today ? 'later' : ''].filter(Boolean).join(' ')
          return (
            <button key={day} className={classes} disabled={!inMonth} onClick={() => onSelect(day)}
              aria-label={`${noon(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}${count ? `, ${count} workout${count === 1 ? '' : 's'}` : ''}`}
              aria-pressed={day === selected}>
              <span className="num">{noon(day).getUTCDate()}</span>
              {count > 1 && <i className="cal-more" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
