import { useState } from 'react'
import { currentUser, deleteAccount, download, signOut } from '../api'
import { setPrefs, usePrefs } from '../prefs'
import { store, useStore } from '../store'
import { back } from '../router'
import { Chips, Confirm, PageHeader, SectionHead, Segmented } from '../ui/components'
import { Icon } from '../ui/icons'

const rests = [30, 45, 60, 90, 120, 150, 180, 240, 300]

export function Settings({ onSignedOut, onToast }: { onSignedOut: () => void; onToast: (m: string) => void }) {
  const data = useStore()
  const prefs = usePrefs()
  const user = currentUser()
  const [dialog, setDialog] = useState<'signout' | 'delete'>()
  const today = new Date().toISOString().slice(0, 10)
  const title = (c: (typeof data.conflicts)[number]) => {
    if (c.entity === 'session') return `Workout: ${data.sessions.find((s) => s.id === c.id)?.name ?? 'deleted'}`
    if (c.entity === 'template') return `Template: ${data.templates.find((t) => t.id === c.id)?.name ?? 'deleted'}`
    if (c.entity === 'measurement') return 'Body weight entry'
    return data.exerciseById.get(c.id.toUpperCase())?.name ?? 'Custom exercise'
  }

  return (
    <>
      <button className="btn btn-ghost phone-only" style={{ marginTop: 10, marginLeft: -8 }} onClick={() => back('/train')}><Icon name="back" size={18} /> Back</button>
      <PageHeader title="Settings" />
      <section className="section card stack">
        <div>
          <div style={{ fontWeight: 600 }}>{user?.displayName ?? 'Signed in'}</div>
          {user?.email && <div className="small subtle">{user.email}</div>}
        </div>
        <div className="row small">
          <span className="spacer subtle">
            {data.syncError ?? (data.pending > 0 ? `${data.pending} change${data.pending === 1 ? '' : 's'} saving` : data.lastSyncedAt ? `Synced ${new Date(data.lastSyncedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Not synced yet')}
          </span>
          <button className="pill quiet" onClick={() => void store.refresh()} disabled={data.syncing}>Sync now</button>
        </div>
      </section>

      {data.conflicts.length > 0 && (
        <section className="section">
          <SectionHead title="Needs your choice" />
          <div className="stack">
            {data.conflicts.map((c) => (
              <div key={`${c.entity}/${c.id}`} className="card stack">
                <div><strong>{title(c)}</strong><div className="small subtle">{c.message}</div></div>
                <div className="row">
                  {c.reason !== 'rejected' && <button className="pill" onClick={() => store.resolve(c, true)}>Keep this version</button>}
                  <button className="pill quiet" onClick={() => store.resolve(c, false)}>{c.reason === 'rejected' ? 'Discard change' : 'Use the other version'}</button>
                </div>
              </div>
            ))}
            <p className="tiny faint">Nothing is merged automatically. Your choice replaces the other copy everywhere.</p>
          </div>
        </section>
      )}

      <section className="section">
        <SectionHead title="Units" />
        <Segmented options={['lb', 'kg']} value={prefs.unit} onChange={(unit) => setPrefs({ unit })} label={(u) => (u === 'lb' ? 'Pounds' : 'Kilograms')} />
        <p className="tiny faint">Changes how weights are shown and the default for new entries. Past entries keep the unit they were logged in.</p>
      </section>
      <section className="section">
        <SectionHead title="Default rest" />
        <Chips layout="wrap" options={rests.map(String)} value={String(prefs.defaultRest)} onChange={(v) => setPrefs({ defaultRest: Number(v) })} label={(v) => `${Math.floor(Number(v) / 60)}:${String(Number(v) % 60).padStart(2, '0')}`} />
      </section>

      <section className="section">
        <SectionHead title="Your data" />
        <div className="stack">
          <button className="btn btn-secondary" onClick={() => download('/v1/export.json', `setbook-backup-${today}.json`).catch((e) => onToast(e.message))}>Export backup (JSON)</button>
          <button className="btn btn-secondary" onClick={() => download('/v1/export/sets.csv', `setbook-sets-${today}.csv`).catch((e) => onToast(e.message))}>Export sets (CSV)</button>
          <button className="btn btn-secondary" onClick={() => download('/v1/export/body-weight.csv', `setbook-body-weight-${today}.csv`).catch((e) => onToast(e.message))}>Export body weight (CSV)</button>
          <p className="tiny faint">The JSON backup uses the same format as the iPhone app, which can import it.</p>
        </div>
      </section>

      <section className="section stack">
        <button className="btn btn-secondary" onClick={() => (data.pending > 0 ? setDialog('signout') : store.clearLocal().then(signOut).then(onSignedOut))}>Sign out</button>
        <button className="btn btn-ghost btn-danger" onClick={() => setDialog('delete')}>Delete account</button>
      </section>

      {dialog === 'signout' && (
        <Confirm title="Sign out with unsaved changes?" message={`${data.pending} change${data.pending === 1 ? " hasn't" : "s haven't"} reached the server yet and will be lost.`}
          confirm="Sign out anyway" onCancel={() => setDialog(undefined)} onConfirm={() => store.clearLocal().then(signOut).then(onSignedOut)} />
      )}
      {dialog === 'delete' && (
        <Confirm title="Delete your account?" message="Permanently deletes every workout, template and weigh-in from the server and every device. Export a backup first if you want one."
          confirm="Delete account and all data" onCancel={() => setDialog(undefined)}
          onConfirm={() => deleteAccount().then(() => store.clearLocal()).then(onSignedOut).catch((e) => { setDialog(undefined); onToast(e.message) })} />
      )}
    </>
  )
}
