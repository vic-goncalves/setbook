import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { isStandalone, registerServiceWorker } from './device'
import './styles.css'

document.documentElement.classList.toggle('standalone', isStandalone)
// iOS only applies :active press styles when the page listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true })
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
