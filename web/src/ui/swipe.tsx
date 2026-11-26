import { useRef, useState, type ReactNode } from 'react'
import { tap } from '../device'

const ACTION_WIDTH = 84

/** Swipe left to reveal Delete, as in iOS lists. Vertical scrolling still passes through. */
export function SwipeRow({ onDelete, children, label = 'Delete' }: { onDelete: () => void; children: ReactNode; label?: string }) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{ x: number; y: number; base: number; horizontal?: boolean } | undefined>(undefined)
  const swiped = useRef(false)

  return (
    <div className={`swipe${dragging ? ' dragging' : ''}`}>
      <button className="swipe-action" tabIndex={offset ? 0 : -1} aria-hidden={offset === 0} onClick={() => { tap(); setOffset(0); onDelete() }}>{label}</button>
      <div
        className="swipe-content"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return
          gesture.current = { x: e.clientX, y: e.clientY, base: offset }
          swiped.current = false
        }}
        onPointerMove={(e) => {
          const g = gesture.current
          if (!g) return
          const dx = e.clientX - g.x
          const dy = e.clientY - g.y
          if (g.horizontal === undefined && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) g.horizontal = Math.abs(dx) > Math.abs(dy)
          if (!g.horizontal) return
          swiped.current = true
          setDragging(true)
          setOffset(Math.max(-ACTION_WIDTH - 36, Math.min(0, g.base + dx)))
        }}
        onPointerUp={() => {
          if (gesture.current?.horizontal) setOffset((o) => (o < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0))
          gesture.current = undefined
          setDragging(false)
        }}
        onPointerCancel={() => {
          gesture.current = undefined
          setDragging(false)
          setOffset((o) => (o < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0))
        }}
        onClickCapture={(e) => {
          // A swipe shouldn't also count as a tap on whatever was under the finger.
          if (swiped.current || offset !== 0) {
            e.stopPropagation()
            e.preventDefault()
            if (!swiped.current) setOffset(0)
            swiped.current = false
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
