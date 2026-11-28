import { useId } from 'react'

/**
 * The app icon's dumbbell (same geometry as scripts/render-web-icon.py, in its 1024 grid),
 * inverted: black glass on a light tile, where the home-screen icon is white glass on black.
 */
export function Logo({ size = 64 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  const plates = [-1, 1].flatMap((side) => [
    { x: 512 + side * 178 - 48, y: 512 - 196, w: 96, h: 392, r: 40 },
    { x: 512 + side * 290 - 38, y: 512 - 118, w: 76, h: 236, r: 32 },
  ])
  const shapes = [{ x: 512 - 280, y: 512 - 30, w: 560, h: 60, r: 30 }, ...plates]
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="Setbook" style={{ display: 'block', flex: 'none' }}>
      <defs>
        <linearGradient id={`logo-tile-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E4E4E2" />
        </linearGradient>
        <linearGradient id={`logo-glass-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3A3A3E" />
          <stop offset="0.55" stopColor="#141416" />
          <stop offset="1" stopColor="#060607" />
        </linearGradient>
        <linearGradient id={`logo-rim-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.18" />
        </linearGradient>
        <filter id={`logo-shadow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="18" stdDeviation="22" floodColor="#000" floodOpacity="0.22" />
        </filter>
        <clipPath id={`logo-shape-${id}`}>{shapes.map((s, i) => <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} />)}</clipPath>
      </defs>
      <rect width="1024" height="1024" rx="230" fill={`url(#logo-tile-${id})`} />
      <g filter={`url(#logo-shadow-${id})`}>
        {shapes.map((s, i) => <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} fill={`url(#logo-glass-${id})`} />)}
      </g>
      {/* Rim light, top-left, clipped to the dumbbell so it reads as glass. */}
      <g clipPath={`url(#logo-shape-${id})`} fill="none" stroke={`url(#logo-rim-${id})`} strokeWidth="14">
        {shapes.map((s, i) => <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} />)}
      </g>
    </svg>
  )
}
