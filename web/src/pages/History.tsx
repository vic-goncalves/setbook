import { workingSetCount } from '../domain/workout'
import { duration } from '../format'
import { useStore } from '../store'
import { Chevron, EmptyState, PageHeader, SectionHead } from '../ui/components'

export function History() {
  const data = useStore()
  const completed = data.sessions.filter((s) => s.state === 'completed')
  const months = new Map<string, typeof completed>()
  for (const s of completed) {
    const key = new Date(s.startedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    months.set(key, [...(months.get(key) ?? []), s])
  }
  return (
    <>
      <PageHeader account eyebrow={completed.length ? `${completed.length} workout${completed.length === 1 ? '' : 's'} logged` : 'No workouts yet'} title="History" />
      {completed.length === 0 && (
        <div className="card section"><EmptyState title="No workouts yet" message="Finished workouts land here, grouped by month, with every set you logged." /></div>
      )}
      {[...months.entries()].map(([month, sessions]) => (
        <section key={month} className="section">
          <SectionHead title={month}>
            <span className="tiny faint num">{sessions.length} workouts, {sessions.reduce((n, s) => n + workingSetCount(s), 0)} sets</span>
          </SectionHead>
          <div className="list">
            {sessions.map((s) => {
              const date = new Date(s.startedAt)
              const opts = { timeZone: s.timeZoneIdentifier }
              return (
                <a key={s.id} className="list-row" href={`#/history/${s.id}`}>
                  <div className="date-block">
                    <div className="dow">{date.toLocaleDateString(undefined, { weekday: 'short', ...opts })}</div>
                    <div className="dom num">{date.toLocaleDateString(undefined, { day: 'numeric', ...opts })}</div>
                  </div>
                  <div className="spacer">
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    <div className="small subtle num">{[s.finishedAt ? duration(Date.parse(s.finishedAt) - date.getTime()) : undefined, `${workingSetCount(s)} set${workingSetCount(s) === 1 ? '' : 's'}`].filter(Boolean).join(', ')}</div>
                  </div>
                  <Chevron />
                </a>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}
