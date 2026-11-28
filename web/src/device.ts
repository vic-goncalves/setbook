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
 * iOS: after the keyboard closes, an installed web app can stay "short" for a while: the page
 * is where it should be, but the screen height still excludes the keyboard's toolbar, so the
 * tab bar sits high with a black band under it until something scrolls. (Seen in a screen
 * recording: about a second of band, then recovery on the next scroll.)
 *
 * So remember the full screen height while no keyboard is up. After a keyboard closes, wait
 * for the height to settle; only if it settled short, scroll by 1pt and back, which is
 * invisible and makes iOS recompute. If that doesn't take, try a few points more. If the height
 * comes back on its own, nothing happens.
 */
const NUDGES = [1, 8, 40]

export function settleAfterKeyboard() {
  let fullHeight = window.innerHeight
  let watching = false
  const typing = () => {
    const el = document.activeElement
    return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type))
  }

  window.addEventListener('resize', () => {
    if (!typing()) fullHeight = Math.max(fullHeight, window.innerHeight)
  })
  window.addEventListener('orientationchange', () => {
    setTimeout(() => (fullHeight = window.innerHeight), 600)
  })

  const nudge = (by: number) => {
    const root = document.documentElement
    const y = window.scrollY
    const short = root.scrollHeight - window.innerHeight < by
    if (short) root.style.minHeight = `calc(100% + ${by}px)`
    window.scrollTo(0, y + by)
    requestAnimationFrame(() => {
      window.scrollTo(0, y)
      if (short) root.style.minHeight = ''
    })
  }

  const afterKeyboard = () => {
    if (watching) return
    watching = true
    const started = performance.now()
    let last = -1
    let stable = 0
    let tries = 0
    const check = () => {
      const height = window.innerHeight
      const missing = fullHeight - height
      if (typing() || missing <= 1 || performance.now() - started > 3000) {
        watching = false
        return
      }
      stable = height === last ? stable + 1 : 0
      last = height
      // Settled, and short by about a toolbar (not a whole keyboard, which is still closing).
      if (stable >= 2 && missing < 160 && tries < NUDGES.length) {
        nudge(NUDGES[tries]!)
        tries++
        stable = 0
      }
      setTimeout(check, 100)
    }
    setTimeout(check, 100)
  }

  document.addEventListener('focusout', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) afterKeyboard()
  })
}
