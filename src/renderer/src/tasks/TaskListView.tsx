import { useEffect, useMemo, useState } from 'react'
import { useLiveRxQuery } from 'rxdb/plugins/react'
import type { SuperPiDatabase } from '@shared/store/repo'
import type { TaskDoc } from '@shared/store/schema'
import { STAGES } from '@shared/domain/stageMachine'
import { NewTaskDialog } from './NewTaskDialog'
import { TaskDetailView } from './TaskDetailView'

export function TaskListView({ db }: { db: SuperPiDatabase }): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [hasGithubToken, setHasGithubToken] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    window.superPi.github
      .hasToken()
      .then((has) => {
        if (!cancelled) setHasGithubToken(has)
      })
      .catch(() => {
        if (!cancelled) setHasGithubToken(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

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
      {hasGithubToken === false && (
        <div
          style={{
            background: '#fff7e0',
            border: '1px solid #e0c060',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 13,
            margin: '8px 0'
          }}
        >
          Local-only mode: no GitHub token found. Tasks still run fully; issue tracking and PR
          reviews are disabled until you run <code>gh auth login</code> or set{' '}
          <code>GITHUB_TOKEN</code>.
        </div>
      )}
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
