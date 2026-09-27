import { useMemo, useState } from 'react'
import { useLiveRxQuery } from 'rxdb/plugins/react'
import type { SuperPiDatabase } from '@shared/store/repo'
import type { TaskDoc } from '@shared/store/schema'
import { STAGES } from '@shared/domain/stageMachine'
import { NewTaskDialog } from './NewTaskDialog'
import { TaskDetailView } from './TaskDetailView'

export function TaskListView({ db }: { db: SuperPiDatabase }): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [newDialogOpen, setNewDialogOpen] = useState(false)

  const { results: tasks } = useLiveRxQuery<TaskDoc>({
    collection: db.collections.tasks,
    query: { sort: [{ updatedAt: 'desc' }] }
  })

  const selectedDoc = useMemo(
    () => (tasks ?? []).find((t) => t.id === selected) ?? null,
    [tasks, selected]
  )

  if (selectedDoc) {
    return <TaskDetailView db={db} task={selectedDoc} onBack={() => setSelected(null)} />
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20 }}>Super-Pi Tasks</h1>
        <button onClick={() => setNewDialogOpen(true)}>New task</button>
      </header>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {(tasks ?? []).map((t) => (
          <li
            key={t.id}
            onClick={() => setSelected(t.id)}
            style={{
              border: '1px solid #ccc',
              borderRadius: 6,
              padding: 12,
              margin: '8px 0',
              cursor: 'pointer'
            }}
          >
            <strong>{t.title}</strong>
            <div style={{ fontSize: 12, color: '#666' }}>
              #{t.issueId} · {t.branch} · {t.stage}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>
              {STAGES.indexOf(t.stage) + 1}/{STAGES.length} stages
            </div>
          </li>
        ))}
        {tasks && tasks.length === 0 && <li style={{ color: '#888' }}>No tasks yet.</li>}
      </ul>
      {newDialogOpen && (
        <NewTaskDialog
          db={db}
          onClose={() => setNewDialogOpen(false)}
          onCreated={() => setNewDialogOpen(false)}
        />
      )}
    </div>
  )
}
