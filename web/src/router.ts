import { useEffect, useState } from 'react'

/** Hash routing (#/history/ID), so GitHub Pages never has to resolve deep links. */
export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onChange = () => {
      setRoute(read())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(path: string) {
  location.hash = path.startsWith('/') ? path : `/${path}`
}

export function back(fallback: string) {
  if (history.length > 1) history.back()
  else navigate(fallback)
}
