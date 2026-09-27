/**
 * Single-source schemas: each collection is defined once as an arktype Type;
 * the RxDB JSON-Schema is derived via Type.toJsonSchema().
 */
import type { RxJsonSchema } from 'rxdb'
import { STAGES } from '../domain/stageMachine'
import { type } from 'arktype'

const DateString = type('string').describe('ISO-8601 date string')

const StageLiteral = STAGES.map((s) => `'${s}'`).join('|')

export const Task = type({
  id: 'string <= 100',
  title: 'string',
  origin: "'prompt'|'issue'",
  'prompt?': 'string',
  repoPath: 'string',
  githubOwner: 'string',
  githubRepo: 'string',
  trackerKind: "'github'",
  issueId: 'string <= 64',
  issueTitle: 'string',
  issueUrl: 'string',
  slug: 'string <= 40',
  branch: 'string',
  'worktreePath?': 'string',
  'prNumber?': 'number',
  stage: StageLiteral,
  createdAt: DateString,
  updatedAt: DateString
})

export const Artifact = type({
  id: 'string <= 100',
  taskId: 'string <= 100',
  kind: "'spec'|'plan'|'implementation'",
  path: 'string',
  version: 'number',
  status: "'draft'|'agent_review'|'human_review'|'changes_requested'|'approved'",
  createdAt: DateString
})

export const Anchor = type({
  exact: 'string',
  prefix: 'string',
  suffix: 'string'
})

export const Review = type({
  id: 'string <= 100',
  artifactId: 'string <= 100',
  source: "'agent'|'human'",
  verdict: "'approved'|'changes_requested'",
  summary: 'string',
  createdAt: DateString
})

export const Comment = type({
  id: 'string <= 100',
  reviewId: 'string <= 100',
  anchor: Anchor.or('null'),
  body: 'string',
  'githubCommentId?': 'number',
  createdAt: DateString
})

export type TaskDoc = typeof Task.infer
export type ArtifactDoc = typeof Artifact.infer
export type ReviewDoc = typeof Review.infer
export type CommentDoc = typeof Comment.infer
export type AnchorData = typeof Anchor.infer

/**
 * Derive an RxJsonSchema from an arktype Type.
 * - injects maxLength on indexed string properties (RxDB requirement; storage bound, not domain)
 * - asserts the primary key carries maxLength (catches arktype emission changes loudly)
 */
export function rxSchema<T>(
  t: { toJsonSchema(options?: unknown): unknown },
  title: string,
  primaryKey: string,
  indexes: string[] = []
): RxJsonSchema<T> {
  const js = t.toJsonSchema({
    // insurance only: timestamps are strings, this should never fire
    fallback: { date: (ctx) => ({ ...(ctx.base as object), type: 'string', format: 'date-time' }) }
  }) as {
    $schema?: unknown
    properties: Record<string, { type?: string; enum?: unknown[]; maxLength?: number }>
  }

  delete js.$schema

  const props = js.properties
  const pk = props[primaryKey]
  if (!pk?.maxLength) {
    throw new Error(`schema "${title}": primary key "${primaryKey}" is missing maxLength (arktype emission changed?)`)
  }
  for (const index of indexes) {
    const prop = props[index]
    if (!prop) throw new Error(`schema "${title}": index "${index}" has no property`)
    // arktype emits string-literal unions as { enum: [...] } without a type
    if (Array.isArray(prop.enum)) prop.type = 'string'
    if (prop.type !== 'string') {
      throw new Error(`schema "${title}": indexed property "${index}" is not a string`)
    }
    prop.maxLength ??= 256
  }
  return { ...js, title, version: 0, primaryKey, indexes } as RxJsonSchema<T>
}

export const taskSchema = rxSchema<TaskDoc>(Task, 'tasks', 'id', ['stage'])
export const artifactSchema = rxSchema<ArtifactDoc>(Artifact, 'artifacts', 'id', ['taskId'])
export const reviewSchema = rxSchema<ReviewDoc>(Review, 'reviews', 'id', ['artifactId'])
export const commentSchema = rxSchema<CommentDoc>(Comment, 'comments', 'id', ['reviewId'])

export const COLLECTION_SCHEMAS = {
  tasks: taskSchema,
  artifacts: artifactSchema,
  reviews: reviewSchema,
  comments: commentSchema
} as const
