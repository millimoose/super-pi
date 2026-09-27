import { type } from 'arktype'
import { describe, expect, it } from 'vitest'
import type { RxJsonSchema } from 'rxdb'
import {
  Artifact,
  COLLECTION_SCHEMAS,
  Comment,
  Review,
  Task,
  artifactSchema,
  commentSchema,
  reviewSchema,
  taskSchema
} from './schema'

describe('derived RxDB schemas', () => {
  it('carry title, version, primaryKey, indexes', () => {
    expect(taskSchema.title).toBe('tasks')
    expect(taskSchema.version).toBe(0)
    expect(taskSchema.primaryKey).toBe('id')
    expect(taskSchema.indexes).toEqual(['stage'])
    expect(artifactSchema.indexes).toEqual(['taskId'])
    expect(reviewSchema.indexes).toEqual(['artifactId'])
    expect(commentSchema.indexes).toEqual(['reviewId'])
  })

  it('primary keys carry maxLength', () => {
    for (const [name, schema] of Object.entries(COLLECTION_SCHEMAS)) {
      const pk = schema.properties[schema.primaryKey] as { maxLength?: number }
      expect(pk.maxLength, `${name} pk maxLength`).toBeGreaterThan(0)
    }
  })

  it('indexed string properties carry maxLength', () => {
    const cases: Array<[string, RxJsonSchema<unknown>, string]> = [
      ['tasks', taskSchema, 'stage'],
      ['artifacts', artifactSchema, 'taskId'],
      ['reviews', reviewSchema, 'artifactId'],
      ['comments', commentSchema, 'reviewId']
    ]
    for (const [name, schema, index] of cases) {
      const prop = schema.properties[index] as { type?: string; maxLength?: number }
      expect(prop.type, `${name}.${index}`).toBe('string')
      expect(prop.maxLength, `${name}.${index}`).toBeGreaterThan(0)
    }
  })

  it('drops the $schema keyword RxDB does not expect', () => {
    expect('$schema' in taskSchema).toBe(false)
  })

  it('emits the stage enum for tasks', () => {
    const stage = taskSchema.properties['stage'] as { enum?: string[] }
    expect(stage.enum).toContain('intake')
    expect(stage.enum).toContain('done')
  })
})

describe('runtime validation keeps working', () => {
  it('accepts a well-formed task and rejects a bad stage', () => {
    const base = {
      id: 't1',
      title: 'Add dark mode',
      origin: 'prompt',
      repoPath: 'D:/Repos/x',
      githubOwner: 'o',
      githubRepo: 'r',
      trackerKind: 'github',
      issueId: '42',
      issueTitle: 'Add dark mode',
      issueUrl: 'https://github.com/o/r/issues/42',
      slug: 'add-dark-mode',
      branch: 'task/42-add-dark-mode',
      stage: 'intake',
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z'
    }
    expect(Task(base) instanceof type.errors).toBe(false)
    const bad = Task({ ...base, stage: 'bogus' })
    expect(bad instanceof type.errors).toBe(true)
  })
})
