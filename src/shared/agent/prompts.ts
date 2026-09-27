import type { TaskDoc } from '../store/schema'

/**
 * Pure stage-prompt builders. Every prompt embeds the same contract:
 * skill directive, non-interactive mode, fixed worktree, per-issue artifact
 * path, commit discipline, structured termination.
 */

function taskContext(task: TaskDoc): string {
  const originText = task.prompt
    ? `Additional user context (do not treat as new requirements, fold into your assumptions):\n${task.prompt}`
    : ''
  return [
    `# Task: ${task.title}`,
    `Source: ${task.origin === 'issue' ? `issue ${task.issueUrl}` : 'user prompt'}`,
    `Issue: #${task.issueId} — ${task.issueTitle}`,
    originText
  ]
    .filter(Boolean)
    .join('\n\n')
}

function artifactDir(task: TaskDoc): string {
  return `docs/superpowers/${task.issueId}-${task.slug}`
}

function commonDirectives(task: TaskDoc, skill: string, artifactPath: string): string {
  return [
    taskContext(task),
    `## Workflow directives`,
    `1. Read \`skill://${skill}\` and follow it exactly.`,
    `2. You are non-interactive: batch open decisions into an "Assumptions" section; never block waiting for the human — the human reviews after you finish.`,
    `3. You are already in an isolated git worktree on branch \`${task.branch}\`; do NOT create another worktree and do NOT switch branches.`,
    `4. Write the artifact to \`${artifactPath}\` (exact path).`,
    `5. Commit your work to the branch with conventional-commit messages.`,
    `6. Termination: call the \`super_pi_stage_result\` tool (or write \`.super-pi/stage-result.json\` with the same JSON) then stop.`
  ].join('\n')
}

export function buildBrainstormPrompt(task: TaskDoc): string {
  return `${commonDirectives(task, 'brainstorming', `${artifactDir(task)}/spec.md`)}

Produce a design spec (brainstorming skill output) at the artifact path above, then report via super_pi_stage_result with status complete (or blocked, with notes).`
}

export function buildPlanPrompt(task: TaskDoc): string {
  return `${commonDirectives(task, 'writing-plans', `${artifactDir(task)}/plan.md`)}

Read the existing spec at \`${artifactDir(task)}/spec.md\` first. Produce an implementation plan (writing-plans skill output) at the artifact path above, then report via super_pi_stage_result.`
}

export function buildImplementPrompt(task: TaskDoc): string {
  return `${commonDirectives(task, 'executing-plans', `${artifactDir(task)}/plan.md`)}

Read the plan at \`${artifactDir(task)}/plan.md\` and execute its tasks in order. Do NOT invoke finishing-a-development-branch — integration is handled outside this session. Report via super_pi_stage_result when done.`
}

/**
 * Agentic review of an artifact. `filledTemplate` is a superpowers reviewer
 * prompt with placeholders already filled (see src/main/prompts/templates.ts).
 */
export function buildArtifactReviewPrompt(
  task: TaskDoc,
  filledTemplate: string,
  artifactPath: string
): string {
  return `${filledTemplate}

## Review target

Task: ${task.title} (issue #${task.issueId}). Artifact under review: \`${artifactPath}\`.

## Structured-output directive (overrides the template's reporting format)

After writing the full prose review to \`.super-pi/last-review.md\`, report your verdict via the \`super_pi_review_result\` tool (or \`.super-pi/review-result.json\`) with JSON: {"verdict":"approved"|"changes_requested", "summary": string, "comments": [{"quote": verbatim span from the artifact, "body": your comment}]}. Be read-only except for those two files under .super-pi/. Then stop.`
}

/** Rework prompt: artifact + serialized reviews + address-each-comment. */
export function buildReworkPrompt(
  task: TaskDoc,
  artifactPath: string,
  reviews: Array<{
    source: 'agent' | 'human'
    verdict: 'approved' | 'changes_requested'
    summary: string
    comments: Array<{ quote: string | null; body: string }>
  }>
): string {
  const serialized = reviews
    .map((r) => {
      const comments = r.comments
        .map((c) => `- ${c.quote ? `"${c.quote}"` : '(file-level)'}: ${c.body}`)
        .join('\n')
      return `## ${r.source} review — ${r.verdict}\n${r.summary}\n${comments}`
    })
    .join('\n\n')
  return `${taskContext(task)}

The artifact at \`${artifactPath}\` received change requests:

${serialized}

Address each comment: update the artifact accordingly, commit with a conventional-commit message, then report via super_pi_stage_result.`
}
