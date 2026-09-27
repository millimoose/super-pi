import { type } from 'arktype'

/**
 * Structured results agents report per stage, via the host tools or the
 * marker files. Both channels feed these same arktype schemas.
 */

export const StageResult = type({
  stage: 'string',
  status: "'complete'|'blocked'",
  'artifactPath?': 'string',
  'notes?': 'string'
})
export type StageResult = typeof StageResult.infer

export const ReviewComment = type({
  'quote?': 'string',
  body: 'string'
})
export type ReviewComment = typeof ReviewComment.infer

export const ReviewResult = type({
  verdict: "'approved'|'changes_requested'",
  summary: 'string',
  comments: ReviewComment.array()
})
export type ReviewResult = typeof ReviewResult.infer

/** Extract the first JSON object from free-form stdout. */
export function firstJsonObject(text: string): unknown | undefined {
  const start = text.indexOf('{')
  if (start === -1) return undefined
  for (let end = text.length; end > start; end--) {
    if (text[end - 1] !== '}') continue
    try {
      return JSON.parse(text.slice(start, end))
    } catch {
      // try a shorter candidate
    }
  }
  return undefined
}
