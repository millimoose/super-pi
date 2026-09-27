import { useEffect, useRef, useState } from 'react'
import { useRxDocument } from 'rxdb/plugins/react'
import type { SuperPiDatabase } from '@shared/store/repo'
import type { TaskDoc } from '@shared/store/schema'
import { EVENTS, STAGES } from '@shared/domain/stageMachine'
import { runAgentReview, startProducingStage, submitHumanReview } from './orchestrator'

type Frame = Record<string, unknown>

const STAGE_TO_KIND: Partial<Record<string, 'spec' | 'plan' | 'implementation'>> = {
  brainstorming: 'spec',
  planning: 'plan',
  implementing: 'implementation'
}
const AGENT_REVIEW_OF: Record<string, string> = {
  spec_agent_review: 'spec',
  plan_agent_review: 'plan',
  impl_agent_review: 'implementation'
}

export function TaskDetailView({
  db,
  task,
  onBack
}: {
  db: SuperPiDatabase
  task: TaskDoc
  onBack: () => void
}): React.JSX.Element {
  const live = useRxDocument<TaskDoc>(db.collections.tasks, task.id)
  // rxdb's RxDocument alias drops toJSON in its public type; the instance has it
  const doc = live.result as unknown as { toJSON: () => TaskDoc } | null
  const liveData = doc ? doc.toJSON() : null
  const t = liveData ?? (task as TaskDoc)

  const [frames, setFrames] = useState<Frame[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [steerText, setSteerText] = useState('')
  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const off = window.superPi.agentEvents.subscribe(task.id, (frame) => {
      setFrames((prev) => [...prev.slice(-200), frame])
    })
    unsubscribeRef.current = off
    return off
  }, [task.id])

  const runStage = async (kind: 'spec' | 'plan' | 'implementation'): Promise<void> => {
    setBusy(true)
    setError(null)
    setFrames([])
    try {
      await startProducingStage(db, task.id, kind)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const runReview = (kind: 'spec' | 'plan' | 'implementation'): Promise<void> => {
    setBusy(true)
    setError(null)
    return runAgentReview(db, task.id, kind)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const humanVerdict = async (verdict: 'approved' | 'changes_requested'): Promise<void> => {
    setBusy(true)
    setError(null)
    const kind = HUMAN_REVIEW_OF[t.stage]
    if (!kind) {
      setBusy(false)
      return
    }
    try {
      await submitHumanReview(db, task.id, kind, verdict, verdict === 'approved' ? 'approved in Super-Pi' : 'changes requested in Super-Pi', [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const steer = async (): Promise<void> => {
    if (!steerText.trim()) return
    try {
      await window.superPi.agent.steer(task.id, steerText)
      setSteerText('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const producingKind = STAGE_TO_KIND[t.stage]
  const reviewKind = AGENT_REVIEW_OF[t.stage]
  const humanKind = HUMAN_REVIEW_OF[t.stage]

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <button onClick={onBack}>← All tasks</button>
      <h1 style={{ fontSize: 20 }}>{t.title}</h1>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
        <a href={t.issueUrl} target="_blank" rel="noreferrer">
          #{t.issueId}
        </a>{' '}
        · {t.branch} · {t.worktreePath}
      </div>

      {/* stage timeline */}
      <ol style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 0, fontSize: 11, listStyle: 'none' }}>
        {STAGES.map((s) => (
          <li
            key={s}
            style={{
              padding: '2px 6px',
              borderRadius: 3,
              background: s === t.stage ? '#06c' : s === 'done' && t.stage === 'done' ? '#0a0' : '#eee',
              color: s === t.stage ? '#fff' : '#333'
            }}
          >
            {s}
          </li>
        ))}
      </ol>

      {/* stage-driven actions */}
      <div style={{ margin: '12px 0', display: 'flex', gap: 8 }}>
        {t.stage === 'intake' && (
          <button disabled={busy} onClick={() => void runStage('spec')}>
            Start brainstorming
          </button>
        )}
        {producingKind && (
          <button disabled={busy} onClick={() => void runStage(producingKind)}>
            Run {producingKind} stage
          </button>
        )}
        {reviewKind && (
          <button disabled={busy} onClick={() => void runReview(reviewKind as 'spec')}>
            Run agent review
          </button>
        )}
        {humanKind && (
          <>
            <button disabled={busy} onClick={() => void humanVerdict('approved')}>
              Approve
            </button>
            <button disabled={busy} onClick={() => void humanVerdict('changes_requested')}>
              Request changes
            </button>
          </>
        )}
      </div>

      {error && <div style={{ color: '#c00', margin: '8px 0' }}>{error}</div>}

      {/* agent event stream */}
      <fieldset style={{ marginTop: 12 }}>
        <legend>Agent stream ({frames.length} frames)</legend>
        <div style={{ maxHeight: 220, overflow: 'auto', fontSize: 12, fontFamily: 'monospace' }}>
          {frames.map((f, i) => (
            <div key={i}>{String(f['type'])}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            placeholder="Steer the agent…"
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            style={{ flex: 1 }}
          />
          <button onClick={() => void steer()}>Steer</button>
          <button
            onClick={() => {
              void window.superPi.agent.stop(task.id).catch((e: Error) => setError(e.message))
            }}
          >
            Stop
          </button>
        </div>
      </fieldset>
      <div style={{ fontSize: 10, color: '#aaa', marginTop: 4 }}>events: {EVENTS.join(', ')}</div>
    </div>
  )
}

const HUMAN_REVIEW_OF: Record<string, 'spec' | 'plan' | 'implementation'> = {
  spec_human_review: 'spec',
  plan_human_review: 'plan',
  impl_human_review: 'implementation'
}
