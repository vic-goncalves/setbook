import { useState } from 'react'
import { DEV_AUTH, devSignIn, startGoogleSignIn } from '../api'
import { Logo } from '../ui/logo'

export function SignIn({ error, onSignedIn }: { error?: string; onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(error)
  const [name, setName] = useState('')

  return (
    <main className="shell" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 440 }}>
      <Logo size={72} />
      <h1 style={{ fontSize: 44, letterSpacing: -1, margin: '20px 0 8px' }}>Setbook</h1>
      <p className="subtle" style={{ fontSize: 19, lineHeight: 1.45, margin: 0 }}>
        Know what to do today, log it in seconds, and see whether you're getting stronger.
      </p>
      <div className="stack" style={{ marginTop: 48 }}>
        {message && <div className="small" style={{ color: 'var(--danger)' }} role="alert">{message}</div>}
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await startGoogleSignIn()
            } catch (e) {
              setMessage((e as Error).message)
              setBusy(false)
            }
          }}
        >
          Continue with Google
        </button>
        {DEV_AUTH && (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                await devSignIn(name)
                onSignedIn()
              } catch (err) {
                setMessage((err as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            <input className="input" placeholder="Dev name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Developer name" />
            <button className="pill quiet" disabled={!name.trim() || busy}>Dev sign-in</button>
          </form>
        )}
        <p className="tiny faint">Syncs with the Setbook iPhone app.</p>
      </div>
    </main>
  )
}
