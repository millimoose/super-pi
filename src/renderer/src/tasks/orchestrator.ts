import { buildBrainstormPrompt, buildPlanPrompt, buildImplementPrompt } from '@shared/agent/prompts'
import {
  advanceTask,
  createTask,
  recordArtifact,
  recordReview,
  latestArtifact
} from '@shared/store/repo'
import type { SuperPiDatabase } from '@shared/store/repo'
import type { TaskDoc } from '@shared/store/schema'
import type { StageResult, ReviewResult } from '@shared/agent/resultSchemas'

/**
 * Stage orchestration: compose prompt → agent.startStage → consume frames →
 * persist artifacts/reviews → advance the stage machine. Lives in the
 * renderer; main only runs sessions and capabilities.
 */

type StageOutcome =
  | { kind: 'stage'; result: StageResult }
  | { kind: 'review'; result: ReviewResult }
  | { kind: 'failure'; error: string; transcript: string[] }

async function runStage(task: TaskDoc, prompt: string): Promise<StageOutcome> {
  const outcome = (await window.superPi.agent.startStage({
    taskId: task.id,
    worktreePath: task.worktreePath ?? '',
    prompt
  })) as StageOutcome
  return outcome
}

/** Run a producing stage (brainstorming / planning / implementing). */
export async function startProducingStage(
  db: SuperPiDatabase,
  taskId: string,
  kind: 'spec' | 'plan' | 'implementation'
): Promise<void> {
  const task = await db.collections.tasks.findOne(taskId).exec()
  if (!task) throw new Error(`unknown task ${taskId}`)

  const prompt =
    kind === 'spec'
      ? buildBrainstormPrompt(task.toJSON() as TaskDoc)
      : kind === 'plan'
        ? buildPlanPrompt(task.toJSON() as TaskDoc)
        : buildImplementPrompt(task.toJSON() as TaskDoc)

  const outcome = await runStage(task.toJSON() as TaskDoc, prompt)
  if (outcome.kind === 'failure') throw new Error(outcome.error)
  if (outcome.kind !== 'stage') throw new Error('expected a stage result')

  if (outcome.result.status === 'blocked') {
    throw new Error(outcome.result.notes ?? 'stage blocked')
  }

  const artifactPath = outcome.result.artifactPath
  if (artifactPath) {
    await recordArtifact(db, {
      id: `${task.id}-${kind}-${Date.now()}`,
      taskId: task.id,
      kind,
      path: artifactPath
    })
  }
  await advanceTask(db, task.id, 'stage_complete')
}

/**
 * Run the agent review for the latest artifact of `kind`, record it, and
 * advance past the agent review stage.
 */
export async function runAgentReview(
  db: SuperPiDatabase,
  taskId: string,
  kind: 'spec' | 'plan' | 'implementation'
): Promise<void> {
  const task = await db.collections.tasks.findOne(taskId).exec()
  if (!task) throw new Error(`unknown task ${taskId}`)
  const artifact = await latestArtifact(db, taskId, kind)
  if (!artifact) throw new Error(`no ${kind} artifact to review`)

  const templateName =
    kind === 'spec'
      ? 'spec-document-reviewer-prompt.md'
      : kind === 'plan'
        ? 'plan-document-reviewer-prompt.md'
        : 'code-reviewer.md'

  let filled = ''
  if (kind === 'implementation') {
    const [baseSha, headSha] = await Promise.all([
      window.superPi.git.branchPoint(task.worktreePath ?? '', 'HEAD').catch(() => 'HEAD'),
      'HEAD'
    ])
    const raw = await window.superPi.prompts.loadReviewerTemplate(templateName)
    filled = raw
      .replaceAll('[DESCRIPTION]', task.title)
      .replaceAll('[PLAN_OR_REQUIREMENTS]', `docs/superpowers/${task.issueId}-${task.slug}/plan.md`)
      .replaceAll('[BASE_SHA]', baseSha)
      .replaceAll('[HEAD_SHA]', headSha)
      .replaceAll('[SHA]', headSha)
  } else {
    const raw = await window.superPi.prompts.loadReviewerTemplate(templateName)
    filled = raw
      .replaceAll('[SPEC_FILE_PATH]', `docs/superpowers/${task.issueId}-${task.slug}/spec.md`)
      .replaceAll('[PLAN_FILE_PATH]', `docs/superpowers/${task.issueId}-${task.slug}/plan.md`)
  }

  const { buildArtifactReviewPrompt } = await import('@shared/agent/prompts')
  const prompt = buildArtifactReviewPrompt(task.toJSON() as TaskDoc, filled, artifact.path)

  const outcome = await runStage(task.toJSON() as TaskDoc, prompt)
  if (outcome.kind === 'failure') throw new Error(outcome.error)
  if (outcome.kind !== 'review') {
    // some stages report via stage-result; treat complete as approved
    if (outcome.kind === 'stage' && outcome.result.status === 'complete') {
      await recordReview(db, {
        id: `${task.id}-${kind}-agent-${Date.now()}`,
        artifactId: artifact.id,
        source: 'agent',
        verdict: 'approved',
        summary: 'agent review completed without structured review result'
      })
      await advanceTask(db, task.id, 'agent_review_complete')
      return
    }
    throw new Error('expected a review result')
  }

  await recordReview(db, {
    id: `${task.id}-${kind}-agent-${Date.now()}`,
    artifactId: artifact.id,
    source: 'agent',
    verdict: outcome.result.verdict,
    summary: outcome.result.summary,
    comments: outcome.result.comments.map((c) => ({
      anchor: c.quote ? { exact: c.quote, prefix: '', suffix: '' } : null,
      body: c.body
    }))
  })
  await advanceTask(db, task.id, 'agent_review_complete')
}

/** Human review outcome → machine events + optional PR mirror + rework. */
export async function submitHumanReview(
  db: SuperPiDatabase,
  taskId: string,
  kind: 'spec' | 'plan' | 'implementation',
  verdict: 'approved' | 'changes_requested',
  summary: string,
  comments: Array<{
    anchor: { exact: string; prefix: string; suffix: string } | null
    body: string
  }>
): Promise<void> {
  const artifact = await latestArtifact(db, taskId, kind)
  if (!artifact) throw new Error(`no ${kind} artifact to review`)
  await recordReview(db, {
    id: `${taskId}-${kind}-human-${Date.now()}`,
    artifactId: artifact.id,
    source: 'human',
    verdict,
    summary,
    comments
  })
  await advanceTask(db, taskId, verdict === 'approved' ? 'human_approved' : 'changes_requested')

  // PR mirror
  const task = await db.collections.tasks.findOne(taskId).exec()
  if (task?.prNumber) {
    try {
      const mapped = [] as Array<{ path: string; line: number; body: string }>
      for (const c of comments) {
        void c // main maps anchors → diff positions (P6 wires diffPosition here)
      }
      await window.superPi.github.createReview({
        owner: task.githubOwner,
        repo: task.githubRepo,
        prNumber: task.prNumber,
        verdict,
        summary,
        comments: mapped
      })
    } catch {
      // review kept local; PR mirror is best-effort (P8 retries)
    }
  }
}

/** Create a task row + worktree once the issue is resolved. */
export async function createTaskWithWorktree(
  db: SuperPiDatabase,
  input: {
    title: string
    origin: 'prompt' | 'issue'
    prompt?: string
    repoPath: string
    githubOwner: string
    githubRepo: string
    issueId: string
    issueTitle: string
    issueUrl: string
    slug: string
  }
): Promise<string> {
  const branch = `task/${input.issueId}-${input.slug}`
  const worktreePath = await window.superPi.git.createWorktree(input.repoPath, branch)
  const doc = await createTask(db, {
    ...input,
    id: crypto.randomUUID(),
    trackerKind: 'github',
    branch,
    worktreePath
  })
  return doc.id
}
