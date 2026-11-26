import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from './icons'

export function PageHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <header className="page-header row" style={{ alignItems: 'flex-end' }}>
      <div className="spacer">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="title">{title}</h1>
      </div>
      {action}
    </header>
  )
}

export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="eyebrow" style={{ margin: 0 }}>{title}</h2>
      {children}
    </div>
  )
}

export function Chips<T extends string>({ options, value, onChange, label }: { options: T[]; value: T; onChange: (v: T) => void; label?: (v: T) => string }) {
  return (
    <div className="chips" role="radiogroup">
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
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <strong>{title}</strong>
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
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [message, onDone])
  return <div className="toast" role="status">{message}</div>
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
