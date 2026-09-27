import { useEffect, useMemo, useState } from 'react'
import type { SuperPiDatabase } from '@shared/store/repo'
import { createTaskWithWorktree } from './orchestrator'

type Issue = { id: string; title: string; url: string; body: string }

function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * Issue-anchored task creation:
 *  - issue + empty prompt  → use the issue; slug = kebab(issueTitle)
 *  - issue + prompt        → prompt is extra context, no new issue
 *  - no issue + prompt     → generateTitleSlug → create issue → slug from it
 */
export function NewTaskDialog({
  db,
  onClose,
  onCreated
}: {
  db: SuperPiDatabase
  onClose: () => void
  onCreated: () => void
}): React.JSX.Element {
  const [repoPath, setRepoPath] = useState('')
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [issueSearch, setIssueSearch] = useState('')
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!repoPath) return
    let cancelled = false
    window.superPi.tracker
      .listOpenIssues(repoPath)
      .then((list) => {
        if (cancelled) return
        setSelectedIssue(null)
        setIssues(list)
        const first = list[0]
        if (first) {
          const m = /github\.com\/([^/]+)\/([^/]+)/.exec(first.url)
          if (m) {
            setOwner(m[1])
            setRepo(m[2].replace(/\.git$/, ''))
          }
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [repoPath])

  const filtered = useMemo(() => {
    const q = issueSearch.toLowerCase()
    return issues.filter((i) => q === '' || i.title.toLowerCase().includes(q) || i.id.includes(q))
  }, [issues, issueSearch])

  const pickRepo = async (): Promise<void> => {
    setError(null)
    const path = await window.superPi.dialog.pickRepo()
    if (!path) return
    setRepoPath(path)
    // owner/repo from the remote via the tracker probe (issue list doubles as validation)
    try {
      const list = await window.superPi.tracker.listOpenIssues(path)
      const url = list[0]?.url
      if (url) {
        const m = /github\.com\/([^/]+)\/([^/]+)/.exec(url)
        if (m) {
          setOwner(m[1])
          setRepo(m[2])
        }
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const submit = async (): Promise<void> => {
    setError(null)
    if (!repoPath) {
      setError('pick a repository first')
      return
    }
    if (!selectedIssue && prompt.trim() === '') {
      setError('select an issue or write a prompt')
      return
    }
    setBusy(true)
    try {
      let issue: Issue
      let slug: string
      if (selectedIssue) {
        issue = selectedIssue
        slug = kebab(selectedIssue.title)
      } else {
        const { title, slug: generated } = await window.superPi.agent.generateTitleSlug(
          prompt,
          repoPath
        )
        issue = await window.superPi.tracker.createIssue(repoPath, {
          title,
          body: `${prompt}\n\n_Created by Super-Pi._`
        })
        slug = generated
      }
      // owner/repo: parse from the issue url (works for both paths)
      const m = /github\.com\/([^/]+)\/([^/]+)/.exec(issue.url)
      if (!m) throw new Error(`cannot parse owner/repo from ${issue.url}`)

      await createTaskWithWorktree(db, {
        title: selectedIssue && prompt.trim() !== '' ? prompt.trim().slice(0, 70) : issue.title,
        origin: selectedIssue ? 'issue' : 'prompt',
        prompt: prompt.trim() === '' ? undefined : prompt,
        repoPath,
        githubOwner: m[1],
        githubRepo: m[2],
        issueId: issue.id,
        issueTitle: issue.title,
        issueUrl: issue.url,
        slug
      })
      onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 20,
          width: 560,
          maxHeight: '80vh',
          overflow: 'auto'
        }}
      >
        <h2 style={{ marginTop: 0 }}>New task</h2>

        <div style={{ marginBottom: 12 }}>
          <button onClick={pickRepo}>{repoPath || 'Pick repository…'}</button>
          {owner && repo && (
            <span style={{ marginLeft: 8, color: '#666', fontSize: 12 }}>
              {owner}/{repo}
            </span>
          )}
        </div>

        <div style={{ marginBottom: 8 }}>
          <input
            placeholder="Search open issues…"
            value={issueSearch}
            onChange={(e) => setIssueSearch(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box' }}
            disabled={!repoPath}
          />
        </div>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            maxHeight: 160,
            overflow: 'auto',
            marginBottom: 12
          }}
        >
          {filtered.map((i) => (
            <li
              key={i.id}
              onClick={() => setSelectedIssue(selectedIssue?.id === i.id ? null : i)}
              style={{
                padding: 6,
                border: selectedIssue?.id === i.id ? '2px solid #06c' : '1px solid #ddd',
                borderRadius: 4,
                cursor: 'pointer',
                marginBottom: 4
              }}
            >
              <strong>#{i.id}</strong> {i.title}
            </li>
          ))}
          {repoPath && filtered.length === 0 && <li style={{ color: '#888' }}>No open issues.</li>}
        </ul>

        <textarea
          placeholder="Prompt (optional when an issue is selected; otherwise required — becomes a new issue)"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
        />

        {error && <div style={{ color: '#c00', marginBottom: 8, fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy}>
            {busy ? 'Working…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  )
}
