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
 * under the tab bar, until the page is scrolled. A real scroll makes it re-lay out. This waits
 * until the keyboard has finished closing (so nothing competes with its animation), then
 * scrolls once:
 * - a page that can scroll moves by 1px and back;
 * - a page exactly one screen tall gets room at the bottom, scrolls into it while its
 *   content is shifted by the same amount (so nothing visibly moves), and undoes all three.
 */
const ROOM = 80

export function settleAfterKeyboard() {
  const vv = window.visualViewport
  let waiting = false
  const typing = () => {
    const el = document.activeElement
    return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type))
  }

  const settle = () => {
    const root = document.documentElement
    const y = window.scrollY
    if (root.scrollHeight - window.innerHeight < 2) {
      const shell = document.querySelector<HTMLElement>('main.shell')
      root.style.paddingBottom = `${ROOM}px`
      if (shell) shell.style.transform = `translateY(${ROOM}px)`
      window.scrollTo(0, ROOM)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.scrollTo(0, 0)
        root.style.paddingBottom = ''
        if (shell) shell.style.transform = ''
      }))
      return
    }
    const atEnd = y + window.innerHeight >= root.scrollHeight - 4
    root.style.minHeight = 'calc(100% + 1px)'
    window.scrollTo(0, y + 1)
    requestAnimationFrame(() => {
      root.style.minHeight = ''
      const max = Math.max(0, root.scrollHeight - window.innerHeight)
      window.scrollTo(0, atEnd ? max : Math.min(y, max))
    })
  }

  /** Once per keyboard close: watch each frame until the keyboard is gone (or ~1 s passes). */
  const afterKeyboard = () => {
    if (waiting) return
    waiting = true
    const started = performance.now()
    const check = () => {
      if (typing()) {
        waiting = false // moved to another field: the keyboard is staying up
        return
      }
      const closed = !vv || vv.height >= window.innerHeight - 2
      if (closed || performance.now() - started > 1000) {
        waiting = false
        settle()
        return
      }
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }

  document.addEventListener('focusout', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) afterKeyboard()
  })
}
