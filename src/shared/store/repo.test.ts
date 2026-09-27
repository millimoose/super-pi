import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv'
import { createSuperPiDatabase, type SuperPiDatabase } from './database'
import {
  advanceTask,
  createTask,
  latestArtifact,
  recordArtifact,
  recordReview,
  type TaskInput
} from './repo'

function sampleTaskInput(): TaskInput {
  return {
    id: 't1',
    title: 'Add dark mode',
    origin: 'prompt',
    prompt: 'Add a dark mode toggle',
    repoPath: 'D:/Repos/some-repo',
    githubOwner: 'millimoose',
    githubRepo: 'some-repo',
    trackerKind: 'github',
    issueId: '42',
    issueTitle: 'Add dark mode',
    issueUrl: 'https://github.com/millimoose/some-repo/issues/42',
    slug: 'add-dark-mode',
    branch: 'task/42-add-dark-mode'
  }
}

describe('repo helpers over memory storage', () => {
  let db: SuperPiDatabase

  beforeEach(async () => {
    db = await createSuperPiDatabase(
      `test-${Math.random().toString(36).slice(2)}`,
      getRxStorageMemory()
    )
  })

  afterEach(async () => {
    await db.remove()
  })

  it('createTask seeds intake stage and round-trips all fields', async () => {
    const doc = await createTask(db, sampleTaskInput())
    expect(doc.stage).toBe('intake')

    const found = await db.collections.tasks.findOne('t1').exec()
    expect(found?.title).toBe('Add dark mode')
    expect(found?.trackerKind).toBe('github')
    expect(found?.issueId).toBe('42')
    expect(found?.slug).toBe('add-dark-mode')
    expect(found?.branch).toBe('task/42-add-dark-mode')
  })

  it('advanceTask returns the new stage and persists it', async () => {
    await createTask(db, sampleTaskInput())
    expect(await advanceTask(db, 't1', 'start')).toBe('brainstorming')
  })

  it('advanceTask rejects illegal transitions and unknown tasks', async () => {
    await createTask(db, sampleTaskInput())
    await expect(advanceTask(db, 't1', 'landed')).rejects.toThrow(/illegal transition/)
    await expect(advanceTask(db, 't1', 'changes_requested')).rejects.toThrow(/illegal transition/)
    await expect(advanceTask(db, 'missing', 'start')).rejects.toThrow(/unknown task/)
  })

  it('recordArtifact auto-increments version per task+kind', async () => {
    await createTask(db, sampleTaskInput())
    const first = await recordArtifact(db, {
      id: 'a1',
      taskId: 't1',
      kind: 'spec',
      path: 'docs/superpowers/42-add-dark-mode/spec.md'
    })
    const rework = await recordArtifact(db, {
      id: 'a2',
      taskId: 't1',
      kind: 'spec',
      path: 'docs/superpowers/42-add-dark-mode/spec.md'
    })
    await recordArtifact(db, { id: 'a3', taskId: 't1', kind: 'plan', path: 'p' })
    expect(first.version).toBe(1)
    expect(first.status).toBe('draft')
    expect(rework.version).toBe(2)
    expect((await latestArtifact(db, 't1', 'spec'))?.id).toBe('a2')
    expect((await latestArtifact(db, 't1', 'plan'))?.version).toBe(1)
  })

  it('recordReview maps verdict/source onto artifact status and files comments', async () => {
    await createTask(db, sampleTaskInput())
    await recordArtifact(db, { id: 'a1', taskId: 't1', kind: 'spec', path: 'p' })

    await recordReview(db, {
      id: 'r1',
      artifactId: 'a1',
      source: 'agent',
      verdict: 'approved',
      summary: 'agent says fine',
      comments: [{ anchor: null, body: 'agent note' }]
    })
    expect((await latestArtifact(db, 't1', 'spec'))?.status).toBe('human_review')

    await recordReview(db, {
      id: 'r2',
      artifactId: 'a1',
      source: 'human',
      verdict: 'changes_requested',
      summary: 'unclear success criteria',
      comments: [
        {
          anchor: { exact: 'success criteria', prefix: 'the ', suffix: ' are' },
          body: 'Define them'
        },
        { anchor: null, body: 'Overall too vague' }
      ]
    })
    expect((await latestArtifact(db, 't1', 'spec'))?.status).toBe('changes_requested')

    const comments = await db.collections.comments.find({ selector: { reviewId: 'r2' } }).exec()
    expect(comments).toHaveLength(2)
    expect(comments[0].id).toBe('r2-c0')
    expect(comments[0].anchor).toEqual({
      exact: 'success criteria',
      prefix: 'the ',
      suffix: ' are'
    })
    expect(comments[0].githubCommentId).toBeUndefined()

    await recordReview(db, {
      id: 'r3',
      artifactId: 'a1',
      source: 'human',
      verdict: 'approved',
      summary: 'addressed'
    })
    expect((await latestArtifact(db, 't1', 'spec'))?.status).toBe('approved')
  })

  it('recordReview rejects unknown artifacts', async () => {
    await createTask(db, sampleTaskInput())
    await expect(
      recordReview(db, {
        id: 'rx',
        artifactId: 'missing',
        source: 'human',
        verdict: 'approved',
        summary: 'x'
      })
    ).rejects.toThrow(/unknown artifact/)
  })

  it('walks the full pipeline to done with a rework loop', async () => {
    await createTask(db, sampleTaskInput())
    expect(await advanceTask(db, 't1', 'start')).toBe('brainstorming')
    await recordArtifact(db, { id: 's1', taskId: 't1', kind: 'spec', path: 'spec.md' })
    expect(await advanceTask(db, 't1', 'stage_complete')).toBe('spec_agent_review')
    expect(await advanceTask(db, 't1', 'agent_review_complete')).toBe('spec_human_review')
    // human requests rework: back to brainstorming
    await recordReview(db, {
      id: 'hr1',
      artifactId: 's1',
      source: 'human',
      verdict: 'changes_requested',
      summary: 'rework',
      comments: []
    })
    expect(await advanceTask(db, 't1', 'changes_requested')).toBe('brainstorming')
    // second round approved
    await recordArtifact(db, { id: 's2', taskId: 't1', kind: 'spec', path: 'spec.md' })
    expect(await advanceTask(db, 't1', 'stage_complete')).toBe('spec_agent_review')
    expect(await advanceTask(db, 't1', 'agent_review_complete')).toBe('spec_human_review')
    await recordReview(db, {
      id: 'hr2',
      artifactId: 's2',
      source: 'human',
      verdict: 'approved',
      summary: 'ok'
    })
    expect(await advanceTask(db, 't1', 'human_approved')).toBe('planning')
    // plan round
    await recordArtifact(db, { id: 'p1', taskId: 't1', kind: 'plan', path: 'plan.md' })
    expect(await advanceTask(db, 't1', 'stage_complete')).toBe('plan_agent_review')
    expect(await advanceTask(db, 't1', 'agent_review_complete')).toBe('plan_human_review')
    expect(await advanceTask(db, 't1', 'human_approved')).toBe('implementing')
    // implementation round
    expect(await advanceTask(db, 't1', 'stage_complete')).toBe('impl_agent_review')
    expect(await advanceTask(db, 't1', 'agent_review_complete')).toBe('impl_human_review')
    expect(await advanceTask(db, 't1', 'human_approved')).toBe('landing')
    expect(await advanceTask(db, 't1', 'landed')).toBe('done')
  })

  it('live query emits each stage', async () => {
    await createTask(db, sampleTaskInput())
    const seen: string[] = []
    // findOne().$ replays the current document on subscribe, so subscribing
    // before advancing guarantees the emission order
    const { promise, resolve } = Promise.withResolvers<string[]>()
    const sub = db.collections.tasks.findOne('t1').$.subscribe((t) => {
      if (!t) return
      seen.push(t.stage)
      if (seen.length === 2) {
        sub.unsubscribe()
        resolve(seen)
      }
    })
    await advanceTask(db, 't1', 'start')
    expect(await promise).toEqual(['intake', 'brainstorming'])
  })
})
describe('dev-only ajv validation wrapper', () => {
  it('rejects a document violating the arktype-derived schema', async () => {
    const db = await createSuperPiDatabase(
      `test-ajv-${Math.random().toString(36).slice(2)}`,
      wrappedValidateAjvStorage({ storage: getRxStorageMemory() })
    )
    await expect(
      db.collections.tasks.insert({
        ...sampleTaskInput(),
        stage: 'not-a-stage',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      } as never) // deliberately invalid: violates the derived stage enum
    ).rejects.toThrow()
    await db.remove()
  })
})
