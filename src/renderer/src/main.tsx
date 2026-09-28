import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Last-resort visibility: unhandled failures paint a banner instead of a
// blank window (renderer crashes otherwise leave no trace outside devtools).
function showFatal(kind: string, text: string): void {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;inset:auto 12px 12px 12px;z-index:99999;background:#c00;color:#fff;' +
    'font:13px/1.4 monospace;padding:10px;border-radius:6px;max-height:40vh;overflow:auto;white-space:pre-wrap'
  el.textContent = `${kind}: ${text}`
  document.body.appendChild(el)
}
window.addEventListener('unhandledrejection', (e) => {
  showFatal('unhandled rejection', String(e.reason))
})
window.addEventListener('error', (e) => {
  if (e.message) showFatal('uncaught error', `${e.message}\n${e.filename ?? ''}:${e.lineno ?? ''}`)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
