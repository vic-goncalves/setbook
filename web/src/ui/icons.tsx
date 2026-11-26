const paths = {
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  down: 'M6 9l6 6 6-6',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  timer: 'M12 8v5l3 2M9 2h6M12 22a8 8 0 100-16 8 8 0 000 16z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  play: 'M7 5l12 7-12 7z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  close: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M5 12l7-7 7 7',
  dumbbell: 'M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  chart: 'M4 19h16M5 15l4-4 4 3 6-7',
} as const

export function Icon({ name, size = 18, stroke = 2 }: { name: keyof typeof paths; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'play' ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}
