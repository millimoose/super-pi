import { useEffect, useState } from 'react'
import { DatabaseProvider, getDatabase } from './db/database'
import type { RendererDatabase } from './db/database'
import { TaskListView } from './tasks/TaskListView'

function App(): React.JSX.Element {
  const [db, setDb] = useState<RendererDatabase | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDatabase()
      .then(setDb)
      .catch((e: Error) => setError(e.message))
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
