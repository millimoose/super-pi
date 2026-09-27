import { useEffect, useState } from 'react'
import { DatabaseProvider } from './db/DatabaseProvider'
import { getDatabase } from './db/instance'
import type { RendererDatabase } from './db/instance'
import { TaskListView } from './tasks/TaskListView'

function App(): React.JSX.Element {
  const [db, setDb] = useState<RendererDatabase | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
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
  if (!db) return <div style={{ padding: 16, fontFamily: 'system-ui' }}>Loading…</div>
  return (
    <DatabaseProvider>
      <TaskListView db={db} />
    </DatabaseProvider>
  )
}

export default App
