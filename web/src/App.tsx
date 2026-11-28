import { useEffect, useState } from 'react'
import { DEV_AUTH, completeSignInFromUrl, currentUser, devSignIn, onSignedOut } from './api'
import { reloadPrefs } from './prefs'
import { navigate, useRoute } from './router'
import { store, useStore } from './store'
import { Toast } from './ui/components'
import { Icon } from './ui/icons'
import { Logo } from './ui/logo'
import { SignIn } from './pages/SignIn'
import { Train } from './pages/Train'
import { TemplateEditor } from './pages/TemplateEditor'
import { WorkoutPage } from './pages/Workout'
import { History } from './pages/History'
import { WorkoutDetail } from './pages/WorkoutDetail'
import { Progress } from './pages/Progress'
import { ExerciseDetail } from './pages/ExerciseDetail'
import { BodyWeight } from './pages/BodyWeight'
import { Exercises } from './pages/Exercises'
import { Settings } from './pages/Settings'
import { Coach } from './pages/Coach'
import { reloadChat } from './chat/conversation'

export function App() {
  const [signedIn, setSignedIn] = useState(() => currentUser() !== null)
  const [signInError, setSignInError] = useState<string>()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Development only: ?devSignIn=<name> signs in against a local server, for screenshots.
    const devName = DEV_AUTH ? new URLSearchParams(location.search).get('devSignIn') : null
    if (devName && !currentUser()) {
      devSignIn(devName).then(() => {
        reloadPrefs()
        setSignedIn(true)
      }).catch((e: Error) => setSignInError(e.message)).finally(() => setChecking(false))
      return
    }
    completeSignInFromUrl()
      .then((done) => {
        if (done) {
          reloadPrefs()
          setSignedIn(true)
        }
      })
      .catch((error: Error) => setSignInError(error.message))
      .finally(() => setChecking(false))
    return onSignedOut(() => {
      setSignedIn(false)
      setSignInError('Your session ended. Sign in again.')
    }) as () => void
  }, [])

  useEffect(() => {
    if (!signedIn) return
    void store.start()
    reloadChat()
    return () => store.stop()
  }, [signedIn])

  if (checking) return <div className="spinner" />
  if (!signedIn) {
    return (
      <SignIn
        error={signInError}
        onSignedIn={() => {
          reloadPrefs()
          setSignedIn(true)
        }}
      />
    )
  }
  return <Shell onSignedOut={() => setSignedIn(false)} />
}

function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const route = useRoute()
  const data = useStore()
  const [toast, setToast] = useState<string>()
  const section = route[0] ?? 'train'
  // The workout and the template editor take the whole screen with their own top bar,
  // like full-screen flows in iOS apps.
  const immersive = section === 'workout' || section === 'templates' || (section === 'history' && route[2] === 'edit')
  const tabs: [string, string, 'dumbbell' | 'calendar' | 'chart' | 'sparkle'][] = [['train', 'Train', 'dumbbell'], ['history', 'History', 'calendar'], ['progress', 'Progress', 'chart'], ['coach', 'Coach', 'sparkle']]

  useEffect(() => {
    document.documentElement.classList.toggle('immersive', immersive)
  }, [immersive])

  // Development only: ?scroll=<px> scrolls once data is shown, for screenshots of scrolled states.
  useEffect(() => {
    const y = DEV_AUTH ? Number(new URLSearchParams(location.search).get('scroll')) : 0
    if (y && data.status === 'ready') setTimeout(() => window.scrollTo(0, y), 400)
  }, [data.status])

  let page
  if (data.status === 'loading') page = <div className="spinner" />
  else if (data.status === 'error') page = <div className="banner warn">Couldn't load your data: {data.error}</div>
  else {
    switch (section) {
      case 'templates': page = <TemplateEditor id={route[1] ?? 'new'} />; break
      case 'workout': page = <WorkoutPage onToast={setToast} />; break
      case 'history': page = route[1] ? (route[2] === 'edit' ? <WorkoutPage editId={route[1]} onToast={setToast} /> : <WorkoutDetail id={route[1]} onToast={setToast} />) : <History />; break
      case 'progress':
        page = route[1] === 'exercise' && route[2] ? <ExerciseDetail id={route[2]} /> : route[1] === 'body-weight' ? <BodyWeight /> : <Progress />
        break
      case 'exercises': page = <Exercises />; break
      case 'coach': page = <Coach />; break
      case 'settings': page = <Settings onSignedOut={onSignedOut} onToast={setToast} />; break
      default: page = <Train onToast={setToast} />
    }
  }

  return (
    <>
      {!immersive && (
        <nav className="topbar" aria-label="Primary">
          <div className="topbar-inner">
            <a className="brand" href="#/train"><Logo size={28} />Setbook</a>
            {tabs.map(([key, label]) => (
              <a key={key} className={`tab${section === key ? ' active' : ''}`} href={`#/${key}`} aria-current={section === key ? 'page' : undefined}>{label}</a>
            ))}
            <SyncIndicator />
            <a className="icon-button" href="#/settings" aria-label="Settings"><Icon name="gear" size={20} /></a>
          </div>
        </nav>
      )}
      <main className="shell">
        {data.conflicts.length > 0 && section !== 'settings' && !immersive && (
          <button className="banner warn" style={{ width: '100%', textAlign: 'left' }} onClick={() => navigate('/settings')}>
            {data.conflicts.length} change{data.conflicts.length === 1 ? '' : 's'} need your choice before they can sync. Review in Settings.
          </button>
        )}
        <div className="page" key={route.join('/')}>{page}</div>
      </main>
      {!immersive && (
        <nav className="tabbar" aria-label="Sections">
          {tabs.map(([key, label, icon]) => (
            <a key={key} className={section === key ? 'active' : undefined} href={`#/${key}`} aria-current={section === key ? 'page' : undefined}>
              <Icon name={icon} size={24} stroke={section === key ? 2.4 : 1.8} />
              {label}
            </a>
          ))}
        </nav>
      )}
      {toast && <Toast message={toast} onDone={() => setToast(undefined)} />}
    </>
  )
}

function SyncIndicator() {
  const data = useStore()
  const text = data.syncError ? 'Offline' : data.pending > 0 || data.syncing ? 'Saving' : ''
  if (!text) return null
  return <span className="tiny subtle" role="status" style={{ marginRight: 4 }}>{text}</span>
}
