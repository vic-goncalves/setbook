import { useEffect, useRef, useState, type ReactNode } from 'react'
import { currentUser } from '../api'
import { Icon } from './icons'

export function PageHeader({ eyebrow, title, action, account = false }: { eyebrow?: string; title: string; action?: ReactNode; account?: boolean }) {
  // On phones, tab roots get iOS large titles: the account avatar sits beside the title, and
  // a compact title bar fades in once the large title scrolls under the status bar.
  const [compact, setCompact] = useState(false)
  const sentinel = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setCompact(!entry!.isIntersecting && entry!.boundingClientRect.top < 0), { threshold: 0 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <>
      <header className="page-header row" style={{ alignItems: 'flex-end' }}>
        <div className="spacer">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1 className="title" ref={sentinel}>{title}</h1>
        </div>
        {action}
        {account && <span className="phone-only" style={{ marginBottom: 4 }}><AccountButton /></span>}
      </header>
      <div className={`compact-bar${compact ? ' shown' : ''}`} aria-hidden={!compact}>
        {title}
        {account && <AccountButton />}
      </div>
    </>
  )
}

/** Your initial in a circle; opens Account and Settings (the iOS App Store / Health pattern). */
export function AccountButton() {
  const user = currentUser()
  const initial = (user?.displayName ?? user?.email ?? '?').trim().charAt(0).toUpperCase() || '?'
  return <a className="avatar" href="#/settings" aria-label="Account and settings">{initial}</a>
}

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="eyebrow" style={{ margin: 0 }}>{title}</h2>
      {children}
    </div>
  )
}

export function Chips<T extends string>({ options, value, onChange, label, layout }: {
  options: T[]; value: T; onChange: (v: T) => void; label?: (v: T) => string; layout?: 'bleed' | 'wrap'
}) {
  return (
    <div className={`chips${layout ? ` ${layout}` : ''}`} role="radiogroup">
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={o === value} className={`chip${o === value ? ' on' : ''}`} onClick={() => onChange(o)}>
          {label ? label(o) : o}
        </button>
      ))}
    </div>
  )
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="stat-value num">{value}</div>
      <div className="tiny subtle">{label}</div>
    </div>
  )
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 12px' }}>
      <div style={{ fontWeight: 600, fontSize: 17 }}>{title}</div>
      <p className="subtle small" style={{ maxWidth: 360, margin: '8px auto 0', lineHeight: 1.5 }}>{message}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

export function Sheet({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <button className="bar-button" onClick={onClose} style={{ minWidth: 64, textAlign: 'left' }}>Cancel</button>
          <strong style={{ fontSize: 17, textAlign: 'center', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</strong>
          <div style={{ minWidth: 64, display: 'flex', justifyContent: 'flex-end' }}>{actions}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

/** A destructive or consequential choice, phrased like the iPhone app's confirmation dialogs. */
export function Confirm({ title, message, confirm, danger = true, onConfirm, onCancel }: {
  title: string; message: string; confirm: string; danger?: boolean; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sheet" role="alertdialog" aria-modal="true" aria-label={title} style={{ paddingTop: 20 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <p className="subtle small" style={{ lineHeight: 1.5 }}>{message}</p>
        <div className="stack">
          <button className="btn btn-secondary" style={danger ? { color: 'var(--danger)' } : undefined} onClick={onConfirm}>{confirm}</button>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

/** iOS-style action sheet: a list of choices with a separate Cancel. */
export function ActionSheet({ title, actions, onClose }: { title: string; actions: { label: string; run: () => void; danger?: boolean }[]; onClose: () => void }) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} style={{ paddingTop: 12 }}>
        <div className="small subtle" style={{ textAlign: 'center', padding: '6px 0 12px' }}>{title}</div>
        <div className="card list" style={{ padding: '0 16px' }}>
          {actions.map((a) => (
            <button key={a.label} className="list-row" style={{ justifyContent: 'center', color: a.danger ? 'var(--danger)' : undefined, fontWeight: 500 }}
              onClick={() => { onClose(); a.run() }}>{a.label}</button>
          ))}
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 10, minHeight: 52 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  // Keyed on the message only: the parent re-renders every second during a workout, and
  // restarting the timer on each render would keep the toast up forever.
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const t = setTimeout(() => done.current(), 2800)
    return () => clearTimeout(t)
  }, [message])
  return <div className="toast" role="status">{message}</div>
}

/** iOS segmented control for a small fixed set of choices (units, etc.). */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: T[]; value: T; onChange: (v: T) => void; label?: (v: T) => string }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={o === value} className={o === value ? 'on' : undefined} onClick={() => onChange(o)}>
          {label ? label(o) : o}
        </button>
      ))}
    </div>
  )
}

/** A title field that wraps onto more lines instead of scrolling sideways and cutting the name off. */
export function TitleField({ value, onChange, placeholder, label, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea ref={ref} className="bare title" rows={1} value={value} placeholder={placeholder} aria-label={label} autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
      style={{ overflow: 'hidden', display: 'block' }} />
  )
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function Chevron() {
  return <span className="chev"><Icon name="chevron" size={16} /></span>
}
