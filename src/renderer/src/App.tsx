import { useEffect, useState } from 'react'
import { DatabaseProvider } from './db/DatabaseProvider'
import { getDatabase } from './db/instance'
import type { RendererDatabase } from './db/instance'
import { TaskListView } from './tasks/TaskListView'

/** Shown when `omp` is not on PATH — task creation is blocked by design. */
function SetupScreen(): React.JSX.Element {
  return (
    <div style={{ padding: 32, fontFamily: 'system-ui', maxWidth: 640 }}>
      <h1>Super-Pi needs the OMP harness</h1>
      <p>
        The <code>omp</code> CLI was not found on your PATH. Super-Pi drives every task
        through it and never touches provider credentials itself.
      </p>
      <ol>
        <li>
          Install Oh My Pi (see its README for <code>npm i -g</code> or the installer for
          your platform).
        </li>
        <li>
          Authenticate once: <code>omp</code> uses the same provider logins as the CLI.
        </li>
        <li>Make sure <code>omp --version</code> works in a terminal, then restart Super-Pi.</li>
      </ol>
      <p style={{ color: '#888', fontSize: 13 }}>
        GitHub features additionally need <code>gh auth login</code> or{' '}
        <code>GITHUB_TOKEN</code> — but tasks cannot run without <code>omp</code>.
      </p>
    </div>
  )
}

function App(): React.JSX.Element {
  const [db, setDb] = useState<RendererDatabase | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ompState, setOmpState] = useState<'checking' | 'ok' | 'missing'>('checking')

  useEffect(() => {
    let cancelled = false
    window.superPi.agent
      .ompAvailable()
      .then((ok) => {
        if (!cancelled) setOmpState(ok ? 'ok' : 'missing')
      })
      .catch(() => {
        if (!cancelled) setOmpState('missing')
      })
    getDatabase()
      .then((d) => {
        if (!cancelled) setDb(d)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <div style={{ padding: 16, color: '#c00' }}>database error: {error}</div>
  if (ompState === 'checking') return <div style={{ padding: 16, fontFamily: 'system-ui' }}>Checking environment…</div>
  if (ompState === 'missing') return <SetupScreen />
  if (!db) return <div style={{ padding: 16, fontFamily: 'system-ui' }}>Loading…</div>
  return (
    <DatabaseProvider>
      <TaskListView db={db} />
    </DatabaseProvider>
  )
}

export default App
