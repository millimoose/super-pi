import { afterEach, describe, expect, it } from 'vitest'

import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { createSuperPiDatabase } from '@shared/store/database'
import type { SuperPiDatabase } from '@shared/store/repo'
import { advanceTask, createTask, recordArtifact, recordReview } from '@shared/store/repo'
import { landTask, type LandingBridges } from './landing'

// RxDB free tier caps concurrent collections; close every db after each test
const openDbs: SuperPiDatabase[] = []

async function makeDb(): Promise<SuperPiDatabase> {
  const db = await createSuperPiDatabase(
    `land-test-${Math.random().toString(36).slice(2)}`,
    getRxStorageMemory()
  )
  openDbs.push(db)
  return db
}

afterEach(async () => {
  while (openDbs.length) {
    const db = openDbs.pop() as SuperPiDatabase
    await db.remove()
  }
})

const input = {
  id: 'task-1',
  title: 'Add dark mode',
  origin: 'prompt' as const,
  repoPath: 'D:/Repos/x',
  githubOwner: 'octo',
  githubRepo: 'x',
  trackerKind: 'github' as const,
  issueId: '42',
  issueTitle: 'Add dark mode',
  issueUrl: 'https://github.com/octo/x/issues/42',
  slug: 'add-dark-mode',
  branch: 'task/42-add-dark-mode',
  worktreePath: 'D:/Repos/x-worktrees/task-42-add-dark-mode',
  prNumber: 7
}

function recordingBridges(): LandingBridges & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    markPRReady: async () => {
      calls.push('markPRReady')
    },
    mergePR: async () => {
      calls.push('mergePR')
    },
    removeWorktree: async () => {
      calls.push('removeWorktree')
    }
  }
}

/** Drive a task to impl_human_review with an approved implementation artifact. */
async function seedReadyToLand(db: SuperPiDatabase, prNumber?: number): Promise<void> {
  await createTask(db, { ...input, prNumber })
  await advanceTask(db, 'task-1', 'start')

  // spec: produce → agent review → human approval
  await recordArtifact(db, { id: 's1', taskId: 'task-1', kind: 'spec', path: 'spec.md' })
  await advanceTask(db, 'task-1', 'stage_complete') // spec_agent_review
  await recordReview(db, { id: 'r1', artifactId: 's1', source: 'agent', verdict: 'approved', summary: '' })
  await advanceTask(db, 'task-1', 'agent_review_complete') // spec_human_review
  await recordReview(db, { id: 'r2', artifactId: 's1', source: 'human', verdict: 'approved', summary: '' })
  await advanceTask(db, 'task-1', 'human_approved') // planning

  // plan: same loop
  await recordArtifact(db, { id: 'p1', taskId: 'task-1', kind: 'plan', path: 'plan.md' })
  await advanceTask(db, 'task-1', 'stage_complete') // plan_agent_review
  await recordReview(db, { id: 'r3', artifactId: 'p1', source: 'agent', verdict: 'approved', summary: '' })
  await advanceTask(db, 'task-1', 'agent_review_complete') // plan_human_review
  await recordReview(db, { id: 'r4', artifactId: 'p1', source: 'human', verdict: 'approved', summary: '' })
  await advanceTask(db, 'task-1', 'human_approved') // implementing

  // implementation: produce → agent review → human review (landing point)
  await recordArtifact(db, { id: 'i1', taskId: 'task-1', kind: 'implementation', path: '.' })
  await advanceTask(db, 'task-1', 'stage_complete') // impl_agent_review
  await recordReview(db, { id: 'r5', artifactId: 'i1', source: 'agent', verdict: 'approved', summary: '' })
  await advanceTask(db, 'task-1', 'agent_review_complete') // impl_human_review
  await recordReview(db, { id: 'r6', artifactId: 'i1', source: 'human', verdict: 'approved', summary: '' })
}

describe('landTask', () => {
  it('marks ready, merges, removes the worktree, and completes the machine', async () => {
    const db = await makeDb()
    await seedReadyToLand(db, 7)
    const bridges = recordingBridges()

    expect(await landTask(db, 'task-1', bridges)).toBe('done')
    expect(bridges.calls).toEqual(['markPRReady', 'mergePR', 'removeWorktree'])
    expect((await db.collections.tasks.findOne('task-1').exec())?.stage).toBe('done')
  })

  it('refuses to land from any other stage', async () => {
    const db = await makeDb()
    await createTask(db, input)
    const bridges = recordingBridges()
    await expect(landTask(db, 'task-1', bridges)).rejects.toThrow(/expected impl_human_review/)
    expect(bridges.calls).toEqual([])
  })

  it('refuses when the implementation artifact is not approved', async () => {
    const db = await makeDb()
    await seedReadyToLand(db, 7)
    // downgrade the impl artifact: record a fresh human changes_requested
    await recordReview(db, { id: 'r7', artifactId: 'i1', source: 'human', verdict: 'changes_requested', summary: 'no' })
    const bridges = recordingBridges()
    await expect(landTask(db, 'task-1', bridges)).rejects.toThrow(/not approved/)
    expect(bridges.calls).toEqual([])
  })

  it('refuses when the task has no PR', async () => {
    const db = await makeDb()
    await seedReadyToLand(db, undefined)
    const bridges = recordingBridges()
    await expect(landTask(db, 'task-1', bridges)).rejects.toThrow(/no PR/)
  })
})
