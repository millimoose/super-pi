import { type } from 'arktype'
import { describe, expect, it } from 'vitest'
import { COLLECTION_SCHEMAS, Task } from './schema'

/** Structural view of the derived schemas — avoids RxDB's generic primaryKey typing. */
interface DerivedSchema {
  title?: string
  primaryKey: string
  indexes?: string[]
  properties: Record<string, { type?: string; enum?: unknown[]; maxLength?: number }>
}

const schemas = Object.fromEntries(
  Object.entries(COLLECTION_SCHEMAS).map(([name, schema]) => [name, schema as unknown as DerivedSchema])
) as Record<string, DerivedSchema>

describe('derived RxDB schemas', () => {
  it('carry title, version, primaryKey, indexes', () => {
    expect(schemas.tasks?.title).toBe('tasks')
    expect(COLLECTION_SCHEMAS.tasks.version).toBe(0)
    expect(schemas.tasks?.primaryKey).toBe('id')
    expect(schemas.tasks?.indexes).toEqual(['stage'])
    expect(schemas.artifacts?.indexes).toEqual(['taskId'])
    expect(schemas.reviews?.indexes).toEqual(['artifactId'])
    expect(schemas.comments?.indexes).toEqual(['reviewId'])
  })

  it('primary keys carry maxLength', () => {
    for (const [name, schema] of Object.entries(schemas)) {
      const pk = schema.properties[schema.primaryKey]
      expect(pk?.maxLength, `${name} pk maxLength`).toBeGreaterThan(0)
    }
  })

  it('indexed string properties carry maxLength', () => {
    const cases: Array<[string, DerivedSchema, string]> = [
      ['tasks', schemas.tasks!, 'stage'],
      ['artifacts', schemas.artifacts!, 'taskId'],
      ['reviews', schemas.reviews!, 'artifactId'],
      ['comments', schemas.comments!, 'reviewId']
    ]
    for (const [name, schema, index] of cases) {
      const prop = schema.properties[index]
      expect(prop?.type, `${name}.${index}`).toBe('string')
      expect(prop?.maxLength, `${name}.${index}`).toBeGreaterThan(0)
    }
  })

  it('drops the $schema keyword RxDB does not expect', () => {
    expect('$schema' in COLLECTION_SCHEMAS.tasks).toBe(false)
  })

  it('emits the stage enum for tasks', () => {
    const stage = schemas.tasks?.properties['stage']
    expect(stage?.enum).toContain('intake')
    expect(stage?.enum).toContain('done')
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
