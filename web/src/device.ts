/**
 * Device niceties for the installed web app. Everything here fails silently: none of it may
 * ever block logging.
 */

let haptic: HTMLLabelElement | undefined

/**
 * A light tap. Safari has no vibration API, but since iOS 18 toggling an
 * `<input type="checkbox" switch>` plays the system haptic, and clicking its label from a
 * user gesture toggles it. Android uses navigator.vibrate. Elsewhere this does nothing.
 */
export function tap() {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(12)
      return
    }
    if (!haptic) {
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      input.id = 'haptic-switch'
      input.setAttribute('aria-hidden', 'true')
      input.tabIndex = -1
      input.style.cssText = 'width:1px;height:1px;margin:0'
      haptic = document.createElement('label')
      haptic.htmlFor = input.id
      haptic.setAttribute('aria-hidden', 'true')
      haptic.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;left:-10px;top:-10px'
      haptic.appendChild(input)
      document.body.appendChild(haptic)
    }
    haptic.click()
  } catch {
    // No haptics available; nothing to do.
  }
}

let wakeLock: { release: () => Promise<void> } | undefined

/** Keeps the screen on during a workout (Safari 16.4+, home-screen apps since iOS 18.4). */
export async function keepAwake(on: boolean) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      const nav = navigator as Navigator & { wakeLock: { request: (type: 'screen') => Promise<{ release: () => Promise<void>; addEventListener: (e: string, f: () => void) => void }> } }
      const lock = await nav.wakeLock.request('screen')
      lock.addEventListener('release', () => {
        if (wakeLock === lock) wakeLock = undefined
      })
      wakeLock = lock
    } else if (!on && wakeLock) {
      const lock = wakeLock
      wakeLock = undefined
      await lock.release()
    }
  } catch {
    // Denied or unsupported: the screen just sleeps as usual.
  }
}

/** True when launched from the home screen rather than a browser tab. */
export const isStandalone =
  (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  })
}

/**
 * iOS: after the keyboard closes, Safari can leave the layout shifted up, with a black band
 * under the tab bar, until the page is scrolled. A real scroll makes it re-lay out (a long
 * Coach thread gets one for free when it scrolls to its newest message). A page exactly one
 * screen tall has nothing to scroll, and a 1px nudge isn't enough there, so it briefly gets
 * room at the bottom, scrolls into it and back while the keyboard is still sliding away.
 */
const ROOM = 80
export function settleAfterKeyboard() {
  const vv = window.visualViewport
  let lastHeight = vv?.height ?? 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const typing = () => {
    const el = document.activeElement
    return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type))
  }
  const settle = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (typing()) return // moved to another field: the keyboard is still up
      const root = document.documentElement
      const y = window.scrollY
      if (root.scrollHeight - window.innerHeight < 2) {
        // Too short to scroll: add room, scroll into it, then back and remove it.
        root.style.paddingBottom = `${ROOM}px`
        window.scrollTo(0, ROOM)
        setTimeout(() => {
          window.scrollTo(0, 0)
          root.style.paddingBottom = ''
        }, 40)
        return
      }
      // A chat scrolled to its newest message should stay there.
      const atEnd = y + window.innerHeight >= root.scrollHeight - 4
      root.style.minHeight = 'calc(100% + 1px)'
      window.scrollTo(0, y + 1)
      requestAnimationFrame(() => {
        root.style.minHeight = ''
        const max = Math.max(0, root.scrollHeight - window.innerHeight)
        window.scrollTo(0, atEnd ? max : Math.min(y, max))
      })
    }, 100)
  }
  document.addEventListener('focusout', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) settle()
  })
  vv?.addEventListener('resize', () => {
    if (vv.height > lastHeight + 40) settle()
    lastHeight = vv.height
  })
}
