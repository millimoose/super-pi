/**
 * Typed write helpers over the RxDB collections. Components never call
 * .insert/.patch directly — all writes go through here.
 */
import type { RxCollection, RxDatabase, RxDocument } from 'rxdb'
import type { Stage, StageEvent } from '../domain/stageMachine'
import { transition } from '../domain/stageMachine'
import type { ArtifactDoc, CommentDoc, ReviewDoc, TaskDoc } from './schema'

export interface SuperPiCollections {
  tasks: RxCollection<TaskDoc>
  artifacts: RxCollection<ArtifactDoc>
  reviews: RxCollection<ReviewDoc>
  comments: RxCollection<CommentDoc>
}

export type SuperPiDatabase = RxDatabase<SuperPiCollections>

export type TaskInput = Omit<TaskDoc, 'stage' | 'createdAt' | 'updatedAt'> & { stage?: Stage }

export async function createTask(db: SuperPiDatabase, input: TaskInput): Promise<RxDocument<TaskDoc>> {
  const now = new Date().toISOString()
  const doc: TaskDoc = {
    ...input,
    stage: input.stage ?? 'intake',
    createdAt: now,
    updatedAt: now
  }
  return db.collections.tasks.insert(doc)
}

export interface ArtifactInput {
  id: string
  taskId: string
  kind: ArtifactDoc['kind']
  path: string
}

export async function recordArtifact(
  db: SuperPiDatabase,
  input: ArtifactInput
): Promise<RxDocument<ArtifactDoc>> {
  const existing = await db.collections.artifacts
    .find({ selector: { taskId: input.taskId, kind: input.kind }, sort: [{ version: 'desc' }] })
    .exec()
  return db.collections.artifacts.insert({
    ...input,
    version: (existing[0]?.version ?? 0) + 1,
    status: 'draft',
    createdAt: new Date().toISOString()
  })
}

export interface ReviewInput {
  id: string
  artifactId: string
  source: ReviewDoc['source']
  verdict: ReviewDoc['verdict']
  summary: string
  /** Comment bodies with optional anchors; ids are generated as `<reviewId>-c<n>`. */
  comments?: Array<Omit<CommentDoc, 'id' | 'reviewId' | 'createdAt'>>
}

/**
 * Record a review and its comments, and update the artifact's status:
 * agent review recorded -> human_review (awaiting the human);
 * human verdict becomes the artifact's status for the round.
 */
export async function recordReview(db: SuperPiDatabase, input: ReviewInput): Promise<void> {
  const artifact = await db.collections.artifacts.findOne(input.artifactId).exec()
  if (!artifact) throw new Error(`review references unknown artifact ${input.artifactId}`)

  const now = new Date().toISOString()
  await db.collections.reviews.insert({
    id: input.id,
    artifactId: input.artifactId,
    source: input.source,
    verdict: input.verdict,
    summary: input.summary,
    createdAt: now
  })
  const comments = input.comments ?? []
  for (const [i, comment] of comments.entries()) {
    await db.collections.comments.insert({
      ...comment,
      id: `${input.id}-c${i}`,
      reviewId: input.id,
      createdAt: now
    })
  }
  const nextStatus =
    input.source === 'agent'
      ? ('human_review' as const)
      : input.verdict === 'approved'
        ? ('approved' as const)
        : ('changes_requested' as const)
  await artifact.incrementalPatch({ status: nextStatus })
}

/** Apply the stage machine to a task and persist the new stage. */
export async function advanceTask(
  db: SuperPiDatabase,
  taskId: string,
  event: StageEvent
): Promise<Stage> {
  const task = await db.collections.tasks.findOne(taskId).exec()
  if (!task) throw new Error(`unknown task ${taskId}`)
  const result = transition(task.stage, event)
  // rxdb's generic-this patch typing loses the doc type on bare literals;
  // pass a pre-typed Partial (probe-verified)
  const patch: Partial<TaskDoc> = {
    stage: result.stage,
    updatedAt: new Date().toISOString()
  }
  await task.patch(patch)
  return result.stage
}

/** Latest artifact of a kind for a task (rework bumps create new versions). */
export async function latestArtifact(
  db: SuperPiDatabase,
  taskId: string,
  kind: ArtifactDoc['kind']
): Promise<RxDocument<ArtifactDoc> | null> {
  const result = await db.collections.artifacts
    .find({ selector: { taskId, kind }, sort: [{ version: 'desc' }] })
    .exec()
  return result[0] ?? null
}
