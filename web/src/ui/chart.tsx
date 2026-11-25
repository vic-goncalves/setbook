import { useMemo, useRef, useState } from 'react'

export interface ChartPoint {
  id: string
  x: number
  y: number
}

/**
 * Minimal line chart in SVG: optional area fill, faint raw dots, a highlighted point that
 * follows the pointer. Missing sessions are simply absent; nothing is drawn as zero.
 */
export function LineChart({ points, dots, selectedId, onSelect, area = true, height = 220, label, format }: {
  points: ChartPoint[]
  dots?: ChartPoint[]
  selectedId?: string
  onSelect?: (id: string) => void
  area?: boolean
  height?: number
  label: string
  format: (y: number) => string
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(640)
  const pad = { top: 12, right: 44, bottom: 24, left: 4 }
  const all = [...points, ...(dots ?? [])]
  const scale = useMemo(() => {
    const xs = all.map((p) => p.x)
    const ys = all.map((p) => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const lo = Math.min(...ys), hi = Math.max(...ys)
    const span = Math.max((hi - lo) * 0.15, 1)
    const minY = lo - span, maxY = hi + span
    return {
      x: (x: number) => pad.left + (maxX === minX ? 0.5 : (x - minX) / (maxX - minX)) * (width - pad.left - pad.right),
      y: (y: number) => pad.top + (1 - (y - minY) / (maxY - minY)) * (height - pad.top - pad.bottom),
      minX, maxX, minY, maxY,
    }
  }, [all, width, height])

  if (all.length === 0) return null
  const sx = (p: ChartPoint) => scale.x(p.x)
  const sy = (p: ChartPoint) => scale.y(p.y)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p)},${sy(p)}`).join(' ')
  const areaPath = points.length > 1 ? `${line} L${sx(points.at(-1)!)},${height - pad.bottom} L${sx(points[0]!)},${height - pad.bottom} Z` : ''
  const ticks = [0, 1, 2, 3].map((i) => scale.minY + ((scale.maxY - scale.minY) * (i + 0.5)) / 4)
  const dateTicks = points.length > 1 ? [0, 0.33, 0.66, 1].map((f) => scale.minX + (scale.maxX - scale.minX) * f) : []
  const selected = points.find((p) => p.id === selectedId) ?? points.at(-1)

  const pick = (clientX: number) => {
    if (!onSelect || !ref.current || points.length === 0) return
    const rect = ref.current.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * width
    const nearest = points.reduce((a, b) => (Math.abs(sx(b) - x) < Math.abs(sx(a) - x) ? b : a))
    onSelect(nearest.id)
  }

  return (
    <svg
      ref={(node) => {
        ref.current = node
        if (node && Math.abs(node.clientWidth - width) > 1) setWidth(node.clientWidth || 640)
      }}
      className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}
      onPointerMove={(e) => e.buttons > 0 || e.pointerType === 'mouse' ? pick(e.clientX) : undefined}
      onPointerDown={(e) => pick(e.clientX)}
    >
      <defs>
        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5f5f4" stopOpacity="0.18" />
          <stop offset="1" stopColor="#f5f5f4" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.left} x2={width - pad.right} y1={scale.y(t)} y2={scale.y(t)} stroke="#2a2a2e" />
          <text x={width - pad.right + 6} y={scale.y(t) + 4} fill="#6b6b72" fontSize="11">{format(t)}</text>
        </g>
      ))}
      {dateTicks.map((t, i) => (
        <text key={t} x={scale.x(t)} y={height - 6} fill="#6b6b72" fontSize="11" textAnchor={i === 0 ? 'start' : i === dateTicks.length - 1 ? 'end' : 'middle'}>
          {new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </text>
      ))}
      {dots?.map((p) => <circle key={p.id} cx={sx(p)} cy={sy(p)} r={2.2} fill="#6b6b72" />)}
      {area && areaPath && <path d={areaPath} fill="url(#area)" />}
      {points.length > 1 && <path d={line} fill="none" stroke="#f5f5f4" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
      {!dots && points.map((p) => <circle key={p.id} cx={sx(p)} cy={sy(p)} r={p.id === selected?.id ? 5 : 2.5} fill={p.id === selected?.id ? '#f5f5f4' : 'rgba(245,245,244,.55)'} />)}
      {selected && onSelect && (
        <line x1={sx(selected)} x2={sx(selected)} y1={pad.top} y2={height - pad.bottom} stroke="#3a3a40" strokeDasharray="3 3" />
      )}
    </svg>
  )
}

export function Sparkline({ values, width = 64, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null
  const lo = Math.min(...values), hi = Math.max(...values)
  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (values.length - 1)) * width},${hi === lo ? height / 2 : height - ((v - lo) / (hi - lo)) * (height - 2) - 1}`)
    .join(' ')
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" stroke="#a1a1a6" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}
