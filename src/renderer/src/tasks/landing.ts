import { advanceTask, latestArtifact } from '@shared/store/repo'
import type { SuperPiDatabase } from '@shared/store/repo'

/**
 * Landing is host-owned and explicit: the user clicks Land on an
 * impl_human_review-approved task; the app marks the draft PR ready,
 * squash-merges, removes the worktree + branch, and completes the machine.
 * Bridges are injected so the flow is unit-testable without Electron.
 */

export type LandingBridges = {
  markPRReady: (args: { owner: string; repo: string; prNumber: number }) => Promise<void>
  mergePR: (args: { owner: string; repo: string; prNumber: number }) => Promise<void>
  removeWorktree: (worktreePath: string) => Promise<void>
}

export async function landTask(
  db: SuperPiDatabase,
  taskId: string,
  bridges: LandingBridges
): Promise<'done'> {
  const task = await db.collections.tasks.findOne(taskId).exec()
  if (!task) throw new Error(`unknown task ${taskId}`)
  if (task.stage !== 'impl_human_review') {
    throw new Error(`cannot land from stage "${task.stage}" (expected impl_human_review)`)
  }
  const artifact = await latestArtifact(db, taskId, 'implementation')
  if (!artifact || artifact.status !== 'approved') {
    throw new Error('implementation artifact is not approved')
  }
  if (!task.prNumber) throw new Error('task has no PR — create the draft PR first')

  await bridges.markPRReady({
    owner: task.githubOwner,
    repo: task.githubRepo,
    prNumber: task.prNumber
  })
  await bridges.mergePR({ owner: task.githubOwner, repo: task.githubRepo, prNumber: task.prNumber })
  if (task.worktreePath) {
    await bridges.removeWorktree(task.worktreePath)
  }
  await advanceTask(db, taskId, 'human_approved') // impl_human_review → landing
  await advanceTask(db, taskId, 'landed') // landing → done
  return 'done'
}
