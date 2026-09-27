import { useEffect, useRef, useState } from 'react'
import { Editor, defaultValueCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import type { SuperPiDatabase } from '@shared/store/repo'
import { latestArtifact } from '@shared/store/repo'
import type { TaskDoc } from '@shared/store/schema'
import { createAnchor, findAnchor } from './anchor'
import { submitHumanReview } from '../tasks/orchestrator'

/**
 * Span-anchored human review of an artifact: readonly Milkdown editor,
 * selection → comment, verdict bar. Anchors are W3C text quotes; main maps
 * them to GitHub diff positions on submit.
 */

type DraftComment = {
  key: number
  anchor: { exact: string; prefix: string; suffix: string }
  body: string
}

export function ArtifactReviewView({
  db,
  task,
  kind,
  onDone
}: {
  db: SuperPiDatabase
  task: TaskDoc
  kind: 'spec' | 'plan' | 'implementation'
  onDone: () => void
}): React.JSX.Element {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [artifactPath, setArtifactPath] = useState<string | null>(null)
  const [comments, setComments] = useState<DraftComment[]>([])
  const [verdict, setVerdict] = useState<'approved' | 'changes_requested' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyRef = useRef(0)

  useEffect(() => {
    void (async () => {
      const artifact = await latestArtifact(db, task.id, kind)
      if (!artifact) {
        setError(`no ${kind} artifact recorded`)
        return
      }
      setArtifactPath(artifact.path)
      setMarkdown(await window.superPi.prompts.readTextFile(artifact.path))
    })().catch((e: Error) => setError(e.message))
  }, [db, task.id, kind])

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, markdown ?? '')
          ctx.set(editorViewOptionsCtx, {
            editable: () => false,
            attributes: { style: 'outline: none' }
          })
        })
        .use(commonmark),
    [markdown]
  )

  const addCommentFromSelection = (): void => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !markdown) return
    const text = selection.toString()
    if (!text.trim()) return
    // locate the selection within the source markdown text
    const idx = markdown.indexOf(text)
    if (idx === -1) {
      setError('selection spans rendered formatting; select plain text within one paragraph')
      return
    }
    keyRef.current += 1
    setComments((prev) => [
      ...prev,
      { key: keyRef.current, anchor: createAnchor(markdown, idx, idx + text.length), body: '' }
    ])
  }

  const submit = async (): Promise<void> => {
    if (!verdict || !artifactPath) return
    setBusy(true)
    setError(null)
    try {
      await submitHumanReview(
        db,
        task.id,
        kind,
        verdict,
        verdict === 'approved'
          ? 'Approved in Super-Pi review'
          : 'Changes requested in Super-Pi review',
        comments.map((c) => ({ anchor: c.anchor, body: c.body }))
      )
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return <div style={{ color: '#c00', margin: '8px 0' }}>{error}</div>
  }
  if (markdown === null) return <div style={{ color: '#888' }}>Loading artifact…</div>

  return (
    <fieldset style={{ marginTop: 12 }}>
      <legend>
        Review {kind} ({artifactPath})
      </legend>
      <div
        onMouseUp={addCommentFromSelection}
        style={{
          border: '1px solid #ddd',
          borderRadius: 4,
          padding: 12,
          maxHeight: 400,
          overflow: 'auto'
        }}
      >
        <MilkdownProvider>
          <Milkdown />
        </MilkdownProvider>
      </div>

      {comments.map((c, i) => (
        <div
          key={c.key}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: 8, margin: '8px 0' }}
        >
          <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
            {findAnchor(markdown, c.anchor) === 'orphaned'
              ? '⚠ orphaned'
              : `"${c.anchor.exact.slice(0, 60)}${c.anchor.exact.length > 60 ? '…' : ''}"`}{' '}
            — comment {i + 1}
          </div>
          <textarea
            placeholder="Your comment…"
            rows={2}
            value={c.body}
            onChange={(e) =>
              setComments((prev) =>
                prev.map((p) => (p.key === c.key ? { ...p, body: e.target.value } : p))
              )
            }
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <button onClick={() => setComments((prev) => prev.filter((p) => p.key !== c.key))}>
            Remove
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => setVerdict('approved')}
          style={{
            background: verdict === 'approved' ? '#0a0' : undefined,
            color: verdict === 'approved' ? '#fff' : undefined
          }}
        >
          Approve
        </button>
        <button
          onClick={() => setVerdict('changes_requested')}
          style={{
            background: verdict === 'changes_requested' ? '#c60' : undefined,
            color: verdict === 'changes_requested' ? '#fff' : undefined
          }}
        >
          Request changes
        </button>
        <button onClick={() => void submit()} disabled={busy || verdict === null}>
          {busy ? 'Submitting…' : 'Submit review'}
        </button>
      </div>
    </fieldset>
  )
}
